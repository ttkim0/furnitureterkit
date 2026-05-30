# Ariadne Room-Scan Sidecar

FastAPI service that wraps SLAM3R + SpatialLM. Lives on a GPU box and is
called by the Node backend whenever a user uploads a room video.

## API

### `GET /healthz`
Liveness probe. Returns CUDA availability + whether the SLAM3R and
SpatialLM checkouts are present.

```json
{
  "ok": true,
  "cuda_available": true,
  "slam3r_path_exists": true,
  "spatiallm_path_exists": true
}
```

### `POST /scan` (multipart)
Form field: `video` (mp4 / mov, up to ~200 MB / ~60 s recommended).

Returns the structured layout as JSON the React frontend can render
directly in Three.js — no GLB conversion needed.

```json
{
  "ok": true,
  "job_id": "a3f1c9b2e7d8",
  "video_filename": "kitchen.mp4",
  "layout": {
    "walls": [
      { "id": "wall_0", "ax": -2.5, "ay": -3.0, "az": 0, "bx": 2.5, "by": -3.0, "bz": 0, "height": 2.6, "thickness": 0.1 }
    ],
    "doors": [...],
    "windows": [...],
    "bboxes": [...]
  },
  "artifacts": {
    "point_cloud": "/artifacts/a3f1c9b2e7d8/scene.ply",
    "raw_layout": "/artifacts/a3f1c9b2e7d8/layout.txt"
  }
}
```

### `GET /artifacts/{job_id}/{filename}`
Serves per-job artifacts (raw point cloud, raw layout text) for
debugging or for the optional point-cloud overlay in the renderer.

## Local dev (NOT for Mac — CUDA required)

```bash
# On a Linux box with an RTX 3090+ and CUDA 12.4:
git clone https://github.com/PKU-VCL-3DV/SLAM3R.git /opt/SLAM3R
git clone https://github.com/manycore-research/SpatialLM.git /opt/SpatialLM
pip install -r /opt/SLAM3R/requirements.txt
cd /opt/SLAM3R/slam3r/models/curope && python setup.py build_ext --inplace
pip install -e /opt/SpatialLM
pip install flash-attn --no-build-isolation

cd /path/to/server/python-sidecar
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

## RunPod deployment

See `DEPLOYMENT.md` in the repo root for the full playbook (Docker image
build, RunPod pod template, env var wiring on the Node side).

## Environment

| Var | Default | Purpose |
|---|---|---|
| `SLAM3R_PATH` | `/opt/SLAM3R` | Where the SLAM3R checkout lives inside the container |
| `SPATIALLM_PATH` | `/opt/SpatialLM` | Where SpatialLM lives |
| `SLAM3R_NUM_POINTS` | `1500000` | Cap on saved point cloud (lower = faster, less detail) |
| `SLAM3R_KEYFRAME_STRIDE` | `4` | Take every N-th video frame; raise on long clips to speed up |
| `SPATIALLM_MODEL` | `manycore-research/SpatialLM1.1-Qwen-0.5B` | HF model id |
| `WORK_ROOT` | `/tmp/ariadne-scans` | Per-job artifact dir |

## Licenses

- **SLAM3R**: CC-BY-NC-SA 4.0 — non-commercial. **You cannot ship this
  in a paid product as-is.** Self-hosting for internal R&D is fine.
- **SpatialLM 1.1 (Qwen backbone)**: Llama 3.2 Community License (commercial
  OK <700 M MAU). The Sonata encoder weights are CC-BY-NC-4.0 — same
  non-commercial issue. SpatialLM 1.0 (SceneScript encoder) is also
  CC-BY-NC-4.0.

For a commercial path you'll need to either retrain the Sonata encoder
on a permissively-licensed dataset or switch to a fully-permissive
alternative (Apple RoomPlan on-device, hosted Polycam/Luma API).
