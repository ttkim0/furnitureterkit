"""
Ariadne room-scan sidecar.

A small FastAPI service that wraps the SLAM3R + SpatialLM pipeline so the
Node backend can stay JavaScript-only. Designed to run on a GPU box
(RunPod, Lambda Labs, or any RTX 3090/4090+ host).

End-to-end flow:
  POST /scan  (multipart: video=...)
    1. Save the uploaded video to a per-job tempdir
    2. Run SLAM3R: video → colored point cloud (.ply)
    3. Pre-process the .ply: Manhattan-align (z-up) + metric-rescale (assume
       walls = 2.5 m as per SpatialLM/EXAMPLE.md)
    4. Run SpatialLM: .ply → structured layout (.txt of Wall/Door/Window/Bbox)
    5. Parse the .txt into JSON the frontend can consume directly
    6. Return { job_id, layout, point_cloud_url (optional) }

The frontend builds the actual 3D walls/doors/windows in Three.js from the
layout JSON — keeps the Python side simple and lets the existing R3F
material/lighting story handle the room render.

This service is intentionally STATELESS — every request gets a fresh
tempdir and the result is returned synchronously. The Node backend in
front of it handles queuing, retries, and caching.

Run locally (won't work on Mac, CUDA required):
  uvicorn main:app --host 0.0.0.0 --port 8000

Health: GET /healthz
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── Configuration ────────────────────────────────────────────────────────
# Locations of the SLAM3R + SpatialLM checkouts. Set via env vars when
# deploying; defaults assume both repos cloned next to the sidecar dir.
SLAM3R_PATH = Path(os.environ.get("SLAM3R_PATH", "/opt/SLAM3R")).resolve()
SPATIALLM_PATH = Path(
    os.environ.get("SPATIALLM_PATH", "/opt/SpatialLM")
).resolve()
SLAM3R_PYTHON = os.environ.get("SLAM3R_PYTHON", sys.executable)
SPATIALLM_PYTHON = os.environ.get("SPATIALLM_PYTHON", sys.executable)

# SLAM3R inference defaults — tweak via env if you have a smaller GPU
NUM_POINTS_SAVE = int(os.environ.get("SLAM3R_NUM_POINTS", "1500000"))
SLAM3R_KEYFRAME_STRIDE = int(os.environ.get("SLAM3R_KEYFRAME_STRIDE", "4"))

# SpatialLM model — Qwen 0.5B is the smallest, fits in <8GB VRAM
SPATIALLM_MODEL = os.environ.get(
    "SPATIALLM_MODEL", "manycore-research/SpatialLM1.1-Qwen-0.5B"
)

# Where job artifacts live (point clouds, layouts) — bounded retention
WORK_ROOT = Path(os.environ.get("WORK_ROOT", "/tmp/ariadne-scans")).resolve()
WORK_ROOT.mkdir(parents=True, exist_ok=True)

# ── App ───────────────────────────────────────────────────────────────────

app = FastAPI(title="Ariadne Room Scan Sidecar", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    """Liveness probe. Reports model paths and CUDA availability."""
    cuda_ok = False
    try:
        import torch

        cuda_ok = torch.cuda.is_available()
    except Exception:
        pass
    return {
        "ok": True,
        "service": "ariadne-room-scan-sidecar",
        "cuda_available": cuda_ok,
        "slam3r_path_exists": SLAM3R_PATH.exists(),
        "spatiallm_path_exists": SPATIALLM_PATH.exists(),
        "slam3r_path": str(SLAM3R_PATH),
        "spatiallm_path": str(SPATIALLM_PATH),
    }


@app.post("/scan")
async def scan(video: UploadFile = File(...)) -> JSONResponse:
    """
    Process an uploaded room video through the full SLAM3R → SpatialLM
    pipeline and return the structured layout as JSON.

    Synchronous: blocks for the entire pipeline (~30–60 s on a 4090 for a
    30-second clip). Node frontend handles long-poll / status updates.
    """
    if video.content_type and "video" not in video.content_type:
        raise HTTPException(400, f"expected a video upload, got {video.content_type}")

    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    video_path = job_dir / f"input{Path(video.filename or 'video.mp4').suffix or '.mp4'}"

    # Stream upload to disk — videos can be tens of MB, don't load to memory
    with video_path.open("wb") as f:
        shutil.copyfileobj(video.file, f)

    try:
        ply_path = run_slam3r(video_path, job_dir)
        aligned_ply_path = align_ply(ply_path, job_dir)
        layout_path = run_spatiallm(aligned_ply_path, job_dir)
        layout_json = parse_layout(layout_path)
        return JSONResponse(
            {
                "ok": True,
                "job_id": job_id,
                "video_filename": video.filename,
                "layout": layout_json,
                "artifacts": {
                    # Optional — frontend can request the raw PLY for
                    # debugging or to render the colored point cloud.
                    "point_cloud": f"/artifacts/{job_id}/scene.ply",
                    "raw_layout": f"/artifacts/{job_id}/layout.txt",
                },
            }
        )
    except subprocess.CalledProcessError as e:
        raise HTTPException(
            500,
            f"pipeline failed at step {e.cmd[0] if e.cmd else '?'}: "
            f"{(e.stderr or e.stdout or b'').decode('utf-8', errors='replace')[:2000]}",
        )


@app.get("/artifacts/{job_id}/{filename}")
def get_artifact(job_id: str, filename: str):
    """Serve a per-job artifact (point cloud, raw layout txt)."""
    from fastapi.responses import FileResponse

    safe_filename = Path(filename).name  # strip any path traversal
    artifact = WORK_ROOT / job_id / safe_filename
    if not artifact.exists():
        raise HTTPException(404, f"artifact not found: {safe_filename}")
    return FileResponse(artifact)


# ── Pipeline steps ────────────────────────────────────────────────────────


def run_slam3r(video: Path, job_dir: Path) -> Path:
    """
    Run SLAM3R's recon.py on the uploaded video. Returns the path to the
    generated point cloud (.ply) inside job_dir/slam3r_out/.

    SLAM3R writes to `results/<test_name>/<scene_id>_recon.ply` by default
    (see recon.py:25,75). We point its working dir at job_dir so artifacts
    don't bleed across requests.
    """
    out_dir = job_dir / "slam3r_out"
    out_dir.mkdir(exist_ok=True)
    cmd = [
        SLAM3R_PYTHON,
        str(SLAM3R_PATH / "recon.py"),
        "--dataset",
        str(video),
        "--test_name",
        "scene",
        "--save_dir",
        str(out_dir),
        "--num_points_save",
        str(NUM_POINTS_SAVE),
        "--keyframe_stride",
        str(SLAM3R_KEYFRAME_STRIDE),
    ]
    print(f"[sidecar] running SLAM3R: {' '.join(cmd)}", flush=True)
    proc = subprocess.run(
        cmd,
        cwd=str(SLAM3R_PATH),
        check=True,
        capture_output=True,
    )
    print(proc.stdout.decode("utf-8", errors="replace"), flush=True)

    # SLAM3R names the output as <scene_id>_recon.ply under save_dir/test_name
    # Find the .ply it produced.
    candidates = list(out_dir.rglob("*_recon.ply"))
    if not candidates:
        raise RuntimeError(
            f"SLAM3R completed but no _recon.ply found under {out_dir}"
        )
    ply_path = candidates[0]
    # Stash a stable copy at the well-known path so /artifacts can serve it
    shutil.copyfile(ply_path, job_dir / "scene.ply")
    return ply_path


def align_ply(ply_in: Path, job_dir: Path) -> Path:
    """
    Manhattan-align + metric-rescale the point cloud so SpatialLM has
    z-up coordinates and walls at the expected ~2.5 m height. See
    SpatialLM-main/EXAMPLE.md §3 — they leave alignment as an exercise
    ("choose your way") so we do it here.

    Heuristic: estimate the dominant horizontal plane (floor) via simple
    PCA on the lowest 10% of points, rotate so its normal is +z, then
    rescale so the 99th-percentile point height = 2.5 m.
    """
    import numpy as np

    try:
        from plyfile import PlyData, PlyElement
    except ImportError as e:
        raise RuntimeError(
            "plyfile not installed — pip install plyfile"
        ) from e

    ply = PlyData.read(str(ply_in))
    verts = ply["vertex"].data
    xyz = np.stack([verts["x"], verts["y"], verts["z"]], axis=1).astype(np.float32)

    # 1. Floor detection — bottom 10% of points by Y (SLAM3R outputs roughly
    #    y-down or y-up depending on the input video orientation; we pick
    #    whichever axis has the largest spread to detect "vertical")
    centered = xyz - xyz.mean(axis=0)
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    # Vertical axis = smallest eigenvalue (least spread = floor↔ceiling)
    vertical = eigvecs[:, np.argmin(eigvals)]
    if vertical[2] < 0:
        vertical = -vertical
    # 2. Build a rotation that maps `vertical` to +z
    z = np.array([0.0, 0.0, 1.0])
    axis = np.cross(vertical, z)
    angle = np.arccos(np.clip(np.dot(vertical, z), -1.0, 1.0))
    if np.linalg.norm(axis) < 1e-6:
        R = np.eye(3)
    else:
        axis /= np.linalg.norm(axis)
        K = np.array(
            [[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]]
        )
        R = np.eye(3) + np.sin(angle) * K + (1 - np.cos(angle)) * K @ K
    xyz_aligned = centered @ R.T
    # 3. Re-ground at z = 0 (10th percentile = floor)
    z_floor = np.percentile(xyz_aligned[:, 2], 10)
    xyz_aligned[:, 2] -= z_floor
    # 4. Metric rescale: assume top 99th-percentile = ceiling ≈ 2.5 m
    z_ceiling = np.percentile(xyz_aligned[:, 2], 99)
    if z_ceiling > 0.1:
        scale = 2.5 / z_ceiling
        xyz_aligned *= scale

    # Write back to a new PLY
    new_verts = verts.copy()
    new_verts["x"] = xyz_aligned[:, 0]
    new_verts["y"] = xyz_aligned[:, 1]
    new_verts["z"] = xyz_aligned[:, 2]
    out_path = job_dir / "scene_aligned.ply"
    PlyData([PlyElement.describe(new_verts, "vertex")], text=False).write(
        str(out_path)
    )
    return out_path


def run_spatiallm(ply_in: Path, job_dir: Path) -> Path:
    """
    Run SpatialLM's inference.py on the aligned point cloud. Returns the
    path to the generated layout .txt.
    """
    out_path = job_dir / "layout.txt"
    cmd = [
        SPATIALLM_PYTHON,
        str(SPATIALLM_PATH / "inference.py"),
        "--point_cloud",
        str(ply_in),
        "--output",
        str(out_path),
        "--model_path",
        SPATIALLM_MODEL,
    ]
    print(f"[sidecar] running SpatialLM: {' '.join(cmd)}", flush=True)
    proc = subprocess.run(
        cmd,
        cwd=str(SPATIALLM_PATH),
        check=True,
        capture_output=True,
    )
    print(proc.stdout.decode("utf-8", errors="replace"), flush=True)
    if not out_path.exists():
        raise RuntimeError(f"SpatialLM ran but produced no output at {out_path}")
    return out_path


def parse_layout(layout_path: Path) -> dict[str, Any]:
    """
    Parse SpatialLM's `Wall(...)/Door(...)/Window(...)/Bbox(...)` script
    output (see SpatialLM-main/code_template.txt) into a clean JSON
    structure the frontend can render in Three.js.

    Format from SpatialLM:
      wall_0=Wall(ax,ay,az,bx,by,bz,height,thickness)
      door_0=Door(wall_id,position_x,position_y,position_z,width,height)
      window_0=Window(wall_id,position_x,position_y,position_z,width,height)
      bbox_0=Bbox(class,position_x,position_y,position_z,angle_z,scale_x,scale_y,scale_z)
    """
    import re

    walls: list[dict] = []
    doors: list[dict] = []
    windows: list[dict] = []
    bboxes: list[dict] = []

    text = layout_path.read_text(encoding="utf-8", errors="replace")
    # Strip leading variable assignment, keep only the constructor call
    pattern = re.compile(r"(\w+)\s*=\s*(Wall|Door|Window|Bbox)\s*\(([^)]*)\)")
    for m in pattern.finditer(text):
        ident = m.group(1)
        kind = m.group(2)
        args_str = m.group(3)
        # Args may be positional or keyword; handle both
        positional: list[str] = []
        keyword: dict[str, str] = {}
        for tok in [t.strip() for t in args_str.split(",") if t.strip()]:
            if "=" in tok:
                k, v = tok.split("=", 1)
                keyword[k.strip()] = v.strip().strip("'\"")
            else:
                positional.append(tok.strip().strip("'\""))

        def f(name: str, idx: int) -> float:
            v = keyword.get(name)
            if v is None and idx < len(positional):
                v = positional[idx]
            try:
                return float(v) if v is not None else 0.0
            except ValueError:
                return 0.0

        def s(name: str, idx: int) -> str:
            v = keyword.get(name)
            if v is None and idx < len(positional):
                v = positional[idx]
            return v or ""

        if kind == "Wall":
            walls.append(
                {
                    "id": ident,
                    "ax": f("ax", 0),
                    "ay": f("ay", 1),
                    "az": f("az", 2),
                    "bx": f("bx", 3),
                    "by": f("by", 4),
                    "bz": f("bz", 5),
                    "height": f("height", 6),
                    "thickness": f("thickness", 7),
                }
            )
        elif kind == "Door":
            doors.append(
                {
                    "id": ident,
                    "wall_id": s("wall_id", 0),
                    "position_x": f("position_x", 1),
                    "position_y": f("position_y", 2),
                    "position_z": f("position_z", 3),
                    "width": f("width", 4),
                    "height": f("height", 5),
                }
            )
        elif kind == "Window":
            windows.append(
                {
                    "id": ident,
                    "wall_id": s("wall_id", 0),
                    "position_x": f("position_x", 1),
                    "position_y": f("position_y", 2),
                    "position_z": f("position_z", 3),
                    "width": f("width", 4),
                    "height": f("height", 5),
                }
            )
        elif kind == "Bbox":
            bboxes.append(
                {
                    "id": ident,
                    "class": s("class", 0),
                    "position_x": f("position_x", 1),
                    "position_y": f("position_y", 2),
                    "position_z": f("position_z", 3),
                    "angle_z": f("angle_z", 4),
                    "scale_x": f("scale_x", 5),
                    "scale_y": f("scale_y", 6),
                    "scale_z": f("scale_z", 7),
                }
            )

    return {
        "walls": walls,
        "doors": doors,
        "windows": windows,
        "bboxes": bboxes,
    }
