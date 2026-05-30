"""
Ariadne room-scan sidecar — permissive (BSD/MIT) version.

Same API surface as the SLAM3R+SpatialLM sidecar (POST /scan returns a
SpatialLM-shaped layout JSON) but built entirely from commercial-friendly
components:

  - COLMAP (New BSD)  : video frames → camera poses + sparse + dense
                        point cloud. Industry-standard, mature, battle-
                        tested. CPU works; GPU optional via CUDA build.
  - Open3D (MIT)      : RANSAC plane segmentation → walls / floor /
                        ceiling. Pure-Python wrapper around the C++
                        kernel; runs on CPU.
  - ffmpeg (LGPL)     : video → image frames for COLMAP. System binary.

End-to-end flow:
  POST /scan  (multipart: video=...)
    1. Save the uploaded video, extract ~30 keyframes via ffmpeg
    2. Run COLMAP SfM (sparse) → patch-match stereo (dense) → fused PLY
    3. Manhattan-align the point cloud (PCA on the vertical axis)
    4. Open3D RANSAC: extract floor plane (largest horizontal plane near
       z = min), then walls (largest vertical planes)
    5. Convert plane geometry into Wall/Door/Window-shaped JSON the
       existing RoomLayout3D React component already knows how to render
    6. Return layout JSON

This pipeline is "good enough" for clean rectilinear rooms (residential,
office). Less accurate than SLAM3R+SpatialLM on cluttered scenes, but it
runs on a $5/mo CPU droplet with no license blockers — fine for shipping.

Local dev:
  pip install -r requirements.txt
  brew install colmap ffmpeg   # (or apt-get install on Linux)
  uvicorn main:app --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from pipeline import (
    extract_frames,
    run_colmap_sparse,
    run_colmap_dense,
    fused_ply_to_layout,
)

# ── Configuration ────────────────────────────────────────────────────────
WORK_ROOT = Path(os.environ.get("WORK_ROOT", "/tmp/ariadne-scans-colmap")).resolve()
WORK_ROOT.mkdir(parents=True, exist_ok=True)
FRAMES_PER_VIDEO = int(os.environ.get("COLMAP_FRAMES_PER_VIDEO", "30"))
COLMAP_BIN = os.environ.get("COLMAP_BIN", "colmap")
FFMPEG_BIN = os.environ.get("FFMPEG_BIN", "ffmpeg")
USE_GPU = os.environ.get("COLMAP_USE_GPU", "0") == "1"

app = FastAPI(title="Ariadne Room Scan Sidecar (COLMAP+Open3D)", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    """Liveness probe. Reports tool availability."""
    colmap_ok = shutil.which(COLMAP_BIN) is not None
    ffmpeg_ok = shutil.which(FFMPEG_BIN) is not None
    open3d_ok = False
    try:
        import open3d  # noqa: F401

        open3d_ok = True
    except ImportError:
        pass
    return {
        "ok": colmap_ok and ffmpeg_ok and open3d_ok,
        "service": "ariadne-room-scan-sidecar-colmap",
        "colmap": colmap_ok,
        "ffmpeg": ffmpeg_ok,
        "open3d": open3d_ok,
        "gpu_enabled": USE_GPU,
        "frames_per_video": FRAMES_PER_VIDEO,
    }


@app.post("/scan")
async def scan(video: UploadFile = File(...)) -> JSONResponse:
    """
    Process a room video through COLMAP → Open3D and return the layout
    JSON in the same shape as the SLAM3R+SpatialLM sidecar so the
    frontend renderer doesn't have to branch.

    Blocking call — typical runtime on a 4-core CPU droplet: ~2-5 min
    per 30-second clip. Add a GPU + CUDA-built COLMAP to drop to ~30 s.
    """
    if video.content_type and "video" not in video.content_type:
        raise HTTPException(400, f"expected a video upload, got {video.content_type}")

    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    video_ext = Path(video.filename or "video.mp4").suffix or ".mp4"
    video_path = job_dir / f"input{video_ext}"
    with video_path.open("wb") as f:
        shutil.copyfileobj(video.file, f)

    try:
        print(f"[colmap-sidecar] job {job_id}: extracting frames", flush=True)
        frames_dir = extract_frames(video_path, job_dir, FRAMES_PER_VIDEO, FFMPEG_BIN)

        print(f"[colmap-sidecar] job {job_id}: COLMAP SfM (sparse)", flush=True)
        sparse_dir = run_colmap_sparse(frames_dir, job_dir, COLMAP_BIN, USE_GPU)

        print(f"[colmap-sidecar] job {job_id}: COLMAP dense (patch-match)", flush=True)
        fused_ply = run_colmap_dense(
            frames_dir, sparse_dir, job_dir, COLMAP_BIN, USE_GPU
        )

        print(f"[colmap-sidecar] job {job_id}: Open3D plane segmentation", flush=True)
        layout = fused_ply_to_layout(fused_ply)

        return JSONResponse(
            {
                "ok": True,
                "job_id": job_id,
                "video_filename": video.filename,
                "layout": layout,
                "artifacts": {
                    "point_cloud": f"/artifacts/{job_id}/fused.ply",
                },
            }
        )
    except subprocess.CalledProcessError as e:
        raise HTTPException(
            500,
            f"COLMAP step failed: {e.cmd}: "
            f"{(e.stderr or e.stdout or b'').decode('utf-8', errors='replace')[:2000]}",
        )
    except Exception as e:
        raise HTTPException(500, f"pipeline error: {e}")


@app.get("/artifacts/{job_id}/{filename}")
def get_artifact(job_id: str, filename: str):
    """Serve a per-job artifact (point cloud PLY, etc.)."""
    from fastapi.responses import FileResponse

    safe = Path(filename).name
    p = WORK_ROOT / job_id / safe
    if not p.exists():
        raise HTTPException(404, f"artifact not found: {safe}")
    return FileResponse(p)
