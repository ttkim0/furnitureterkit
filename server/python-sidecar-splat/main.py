"""Ariadne room-scan sidecar — Gaussian Splatting (async)."""
from __future__ import annotations
import asyncio
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

WORK_ROOT = Path(os.environ.get("WORK_ROOT", "/tmp/ariadne-splat")).resolve()
WORK_ROOT.mkdir(parents=True, exist_ok=True)
TARGET_FRAME_COUNT = int(os.environ.get("SPLAT_FRAMES_PER_VIDEO", "100"))
MAX_NUM_ITERATIONS = int(os.environ.get("SPLAT_MAX_ITERATIONS", "15000"))
FFMPEG_BIN = os.environ.get("FFMPEG_BIN", "ffmpeg")
COLMAP_BIN = os.environ.get("COLMAP_BIN", "colmap")

# In-memory job tracker. {job_id: {status, message, progress, splat_url, error, ...}}
# Lost on restart — fine for v1, the Node side re-issues jobs on failure.
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()

app = FastAPI(title="Ariadne Splat Sidecar", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def update_job(job_id: str, **fields) -> None:
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)
            JOBS[job_id]["updated_at"] = time.time()


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    cuda_ok = False
    try:
        import torch
        cuda_ok = torch.cuda.is_available()
    except Exception:
        pass
    return {
        "ok": cuda_ok and shutil.which("ns-train") is not None
              and shutil.which(COLMAP_BIN) is not None and shutil.which(FFMPEG_BIN) is not None,
        "service": "ariadne-room-scan-sidecar-splat",
        "version": "0.2.0",
        "cuda_available": cuda_ok,
        "nerfstudio": shutil.which("ns-train") is not None,
        "colmap": shutil.which(COLMAP_BIN) is not None,
        "ffmpeg": shutil.which(FFMPEG_BIN) is not None,
        "target_frames": TARGET_FRAME_COUNT,
        "max_iterations": MAX_NUM_ITERATIONS,
        "active_jobs": len([j for j in JOBS.values() if j.get("status") == "processing"]),
    }


@app.post("/scan")
async def scan(video: UploadFile = File(...)) -> JSONResponse:
    """Accept upload, kick off background processing, return job_id immediately.

    The Node backend polls /status/{job_id} for completion. This avoids
    Cloudflare's ~100s proxy timeout on the 12-18 min pipeline.
    """
    if video.content_type and "video" not in video.content_type:
        raise HTTPException(400, f"expected video upload, got {video.content_type}")

    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    # Save upload to disk FIRST (must finish before we return — the
    # UploadFile stream closes when this function returns).
    video_ext = Path(video.filename or "video.mp4").suffix or ".mp4"
    video_path = job_dir / f"input{video_ext}"
    bytes_written = 0
    with video_path.open("wb") as f:
        while chunk := await video.read(1024 * 1024):
            f.write(chunk)
            bytes_written += len(chunk)

    with JOBS_LOCK:
        JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "message": "starting",
            "created_at": time.time(),
            "updated_at": time.time(),
            "video_filename": video.filename,
            "video_bytes": bytes_written,
        }

    # Run pipeline in a daemon thread so this request returns immediately.
    threading.Thread(target=run_pipeline, args=(job_id, video_path, job_dir), daemon=True).start()

    return JSONResponse({
        "ok": True, "job_id": job_id, "status": "queued",
        "video_filename": video.filename, "video_bytes": bytes_written,
        "status_url": f"/status/{job_id}",
    }, status_code=202)


@app.get("/status/{job_id}")
def status(job_id: str) -> JSONResponse:
    """Poll job status. Returns full job state including splat_url when done."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, f"no such job: {job_id}")
    return JSONResponse(job)


@app.get("/artifacts/{job_id}/{filename}")
def get_artifact(job_id: str, filename: str):
    safe = Path(filename).name
    p = WORK_ROOT / job_id / safe
    if not p.exists():
        raise HTTPException(404, f"artifact not found: {safe}")
    media = "model/splat" if safe.endswith(".splat") else "application/octet-stream"
    return FileResponse(p, media_type=media)


def run_pipeline(job_id: str, video_path: Path, job_dir: Path) -> None:
    """Synchronous pipeline runner — called from a daemon thread."""
    try:
        update_job(job_id, status="processing", message="1/4 extracting frames", progress=0.05)
        print(f"[splat-sidecar] {job_id}: 1/4 extracting frames", flush=True)
        frames_dir = extract_frames(video_path, job_dir, TARGET_FRAME_COUNT)

        update_job(job_id, message="2/4 COLMAP poses", progress=0.15)
        print(f"[splat-sidecar] {job_id}: 2/4 COLMAP", flush=True)
        processed_dir = ns_process_data(frames_dir, job_dir)

        update_job(job_id, message="3/4 training splatfacto", progress=0.30)
        print(f"[splat-sidecar] {job_id}: 3/4 splatfacto", flush=True)
        ckpt_dir = ns_train_splatfacto(processed_dir, job_dir, MAX_NUM_ITERATIONS)

        update_job(job_id, message="4/4 exporting .splat", progress=0.90)
        print(f"[splat-sidecar] {job_id}: 4/4 export", flush=True)
        splat_path = ns_export_splat(ckpt_dir, job_dir)

        update_job(
            job_id,
            status="done",
            message="ready",
            progress=1.0,
            splat_url=f"/artifacts/{job_id}/scene.splat",
            file_size=splat_path.stat().st_size,
            format="splat",
        )
        print(f"[splat-sidecar] {job_id}: DONE ({splat_path.stat().st_size / 1024 / 1024:.1f} MB)", flush=True)
    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or b"").decode("utf-8", errors="replace")[:2000]
        update_job(job_id, status="error", error=f"{e.cmd[0] if e.cmd else '?'}: {err}")
        print(f"[splat-sidecar] {job_id}: FAILED {err}", flush=True)
    except Exception as e:
        update_job(job_id, status="error", error=str(e))
        print(f"[splat-sidecar] {job_id}: FAILED {e}", flush=True)


def extract_frames(video: Path, job_dir: Path, n: int) -> Path:
    frames_dir = job_dir / "frames"; frames_dir.mkdir(exist_ok=True)
    probe = subprocess.run([FFMPEG_BIN.replace("ffmpeg", "ffprobe"), "-v", "error",
        "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(video)],
        check=True, capture_output=True, text=True)
    duration = float(probe.stdout.strip())
    fps = max(0.5, n / duration)
    subprocess.run([FFMPEG_BIN, "-y", "-i", str(video), "-vf", f"fps={fps}", "-q:v", "2",
        str(frames_dir / "frame_%04d.jpg")], check=True, capture_output=True)
    extracted = sorted(frames_dir.glob("frame_*.jpg"))
    if len(extracted) < 5:
        raise RuntimeError(f"only extracted {len(extracted)} frames")
    return frames_dir


def ns_process_data(frames_dir: Path, job_dir: Path) -> Path:
    out_dir = job_dir / "processed"; out_dir.mkdir(exist_ok=True)
    subprocess.run(["ns-process-data", "images", "--data", str(frames_dir),
        "--output-dir", str(out_dir)], check=True, capture_output=True)
    if not (out_dir / "transforms.json").exists():
        raise RuntimeError("ns-process-data produced no transforms.json")
    return out_dir


def ns_train_splatfacto(processed_dir: Path, job_dir: Path, max_iter: int) -> Path:
    runs_dir = job_dir / "runs"; runs_dir.mkdir(exist_ok=True)
    subprocess.run(["ns-train", "splatfacto", "--data", str(processed_dir),
        "--output-dir", str(runs_dir), "--max-num-iterations", str(max_iter),
        "--vis", "tensorboard", "--steps-per-save", str(max_iter),
        "--logging.steps-per-log", "500"], check=True, capture_output=True)
    configs = list(runs_dir.rglob("config.yml"))
    if not configs:
        raise RuntimeError("ns-train produced no config.yml")
    return configs[-1].parent


def ns_export_splat(ckpt_dir: Path, job_dir: Path) -> Path:
    out_path = job_dir / "scene.splat"
    subprocess.run(["ns-export", "gaussian-splat", "--load-config", str(ckpt_dir / "config.yml"),
        "--output-dir", str(job_dir)], check=True, capture_output=True)
    if out_path.exists():
        return out_path
    candidates = list(job_dir.glob("*.ply"))
    if not candidates:
        raise RuntimeError("ns-export produced no .ply")
    convert_ply_to_splat(candidates[0], out_path)
    return out_path


def convert_ply_to_splat(ply_path: Path, splat_path: Path) -> None:
    import numpy as np
    from plyfile import PlyData
    ply = PlyData.read(str(ply_path))
    verts = ply["vertex"].data
    n = len(verts)
    out = bytearray(n * 32)
    for i, v in enumerate(verts):
        off = i * 32
        out[off:off+12] = np.array([v["x"], v["y"], v["z"]], dtype=np.float32).tobytes()
        sx, sy, sz = float(np.exp(v["scale_0"])), float(np.exp(v["scale_1"])), float(np.exp(v["scale_2"]))
        out[off+12:off+24] = np.array([sx, sy, sz], dtype=np.float32).tobytes()
        r = int(max(0, min(255, (v["f_dc_0"] * 0.28 + 0.5) * 255)))
        g = int(max(0, min(255, (v["f_dc_1"] * 0.28 + 0.5) * 255)))
        b = int(max(0, min(255, (v["f_dc_2"] * 0.28 + 0.5) * 255)))
        op = int(max(0, min(255, (1.0 / (1.0 + np.exp(-v["opacity"]))) * 255)))
        out[off+24] = r; out[off+25] = g; out[off+26] = b; out[off+27] = op
        q = np.array([v["rot_0"], v["rot_1"], v["rot_2"], v["rot_3"]], dtype=np.float32)
        q /= np.linalg.norm(q) + 1e-8
        out[off+28] = int(round((q[0]*0.5+0.5)*255))
        out[off+29] = int(round((q[1]*0.5+0.5)*255))
        out[off+30] = int(round((q[2]*0.5+0.5)*255))
        out[off+31] = int(round((q[3]*0.5+0.5)*255))
    with splat_path.open("wb") as f:
        f.write(out)
