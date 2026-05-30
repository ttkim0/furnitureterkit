# Ariadne Room-Scan Sidecar — Gaussian Splatting (commercial-friendly)

THE pipeline that actually produces photorealistic 3D room reconstruction
from phone video. Built on Apache 2.0 / BSD / MIT components only —
ship in a paid product without license worry.

## Pipeline

```
phone video (.mp4)
  ↓ ffmpeg (LGPL)
~100 JPEG frames
  ↓ COLMAP (BSD)
camera poses + sparse point cloud + transforms.json
  ↓ ns-process-data → Nerfstudio dataset
  ↓ ns-train splatfacto (Apache 2.0)
trained Gaussian Splatting checkpoint
  ↓ ns-export gaussian-splat (Apache 2.0)
.ply → .splat (browser-streamable binary)
  ↓ HTTP
@mkkellogg/gaussian-splats-3d (MIT) renders in the user's browser
```

## Why Splatfacto from Nerfstudio (not the Inria reference)

The original 3D Gaussian Splatting paper (Kerbl et al., Inria) ships
under CC-BY-NC — **non-commercial**, blocks shipping in a paid product.

`gsplat` and `Splatfacto` from the Nerfstudio team are a clean-room
Apache 2.0 re-implementation that exists specifically to enable commercial
use. None of the original Inria code touches our stack.

## API

### `GET /healthz`
```json
{
  "ok": true,
  "cuda_available": true,
  "nerfstudio": true,
  "colmap": true,
  "ffmpeg": true,
  "target_frames": 100,
  "max_iterations": 15000
}
```

### `POST /scan` (multipart, field `video`)
Returns:
```json
{
  "ok": true,
  "job_id": "a3f1c9b2e7d8",
  "splat_url": "/artifacts/a3f1c9b2e7d8/scene.splat",
  "file_size": 28471552,
  "format": "splat"
}
```

The Node backend fetches `splat_url`, downloads the file, and serves it
locally so the browser viewer (@mkkellogg/gaussian-splats-3d) can stream
it without CORS complications.

## RunPod deployment

```bash
# Pod template: PyTorch 2.5.1 / CUDA 12.4
# GPU: RTX 4090 (24 GB) — sweet spot. 3090 works.
# Disk: 50 GB
# Expose HTTP: 8000

git clone <your-fork>
cd <repo>/server/python-sidecar-splat
docker build -t ariadne-splat .
docker run -d --restart=unless-stopped --gpus all -p 8000:8000 ariadne-splat

# Verify
curl https://<pod-id>-8000.proxy.runpod.net/healthz
```

Then in your Node `.env`:
```bash
SCAN_SIDECAR_URL=https://<pod-id>-8000.proxy.runpod.net
```

## Cost / latency

| GPU | Frames | Iters | Time | Cost |
|---|---|---|---|---|
| RTX 4090 (spot $0.17/hr) | 100 | 7000 (preview quality) | ~6 min | $0.02 |
| RTX 4090 (spot $0.17/hr) | 100 | 15000 (default) | ~12 min | $0.04 |
| RTX 4090 (spot $0.17/hr) | 150 | 30000 (high quality) | ~25 min | $0.07 |

Production estimate: **$0.05–0.10 per scan, ~10–15 min**. Order of
magnitude cheaper than Polycam's commercial API and you own the stack.

## Tunables

| Env var | Default | What it does |
|---|---|---|
| `SPLAT_FRAMES_PER_VIDEO` | 100 | More frames = better COLMAP poses = better splat |
| `SPLAT_MAX_ITERATIONS` | 15000 | Splatfacto iters. 7K = fast preview, 30K = production |
| `WORK_ROOT` | `/tmp/ariadne-splat` | Per-job artifact dir |

## Local dev

CUDA-only — won't run on Mac. Use RunPod's "Connect to Jupyter / SSH"
during development:

```bash
# inside the pod
cd /app
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## What this isn't

- Not real-time. Splatfacto needs minutes per scan. For real-time, use
  Apple RoomPlan (iOS LiDAR) — but that needs a native app.
- Not a closed mesh. Gaussian Splatting is a point-based radiance field,
  not triangles. Renders gorgeously but you can't export to STL.
- Not a furniture detector. The splat captures the room AS-IS; if the
  user wants to identify "sofa here, table there", run a separate
  detection pass on the same input frames (OpenMask3D or Mask2Former).
