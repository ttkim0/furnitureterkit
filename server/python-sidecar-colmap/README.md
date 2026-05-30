# COLMAP + Open3D Room-Scan Sidecar (permissive license)

Drop-in alternative to the SLAM3R+SpatialLM sidecar that uses only
**commercial-friendly** components:

| Component | License | Role |
|---|---|---|
| **COLMAP** | New BSD ✓ | video frames → camera poses + point cloud |
| **Open3D** | MIT ✓ | RANSAC plane segmentation → floor + walls |
| **ffmpeg** | LGPL ✓ | video → keyframes |

Same API surface as the other sidecar (`POST /scan`, returns the same
`layout` JSON shape) so the React frontend doesn't care which one is
deployed.

## When to use this vs. the SLAM3R sidecar

| | This sidecar | SLAM3R+SpatialLM sidecar |
|---|---|---|
| **Hardware** | Any CPU, optional GPU | RTX 3090+ required |
| **License** | BSD / MIT — ship commercially | CC-BY-NC — internal only |
| **Wall detection** | Classical RANSAC | LLM-based, sharper |
| **Door / window detection** | ✗ (not detected) | ✓ |
| **Cluttered rooms** | Misses walls behind furniture | Handles them |
| **Cost / scan** | ~$0 on a $6/mo droplet | ~$0.01 + pod hours |

If your users will scan empty / sparsely-furnished rooms (showrooms,
new builds, redecorating) → this sidecar is fine. For cluttered
existing living spaces → the SLAM3R sidecar's LLM gives better walls.

## API

### `GET /healthz`
```json
{
  "ok": true,
  "service": "ariadne-room-scan-sidecar-colmap",
  "colmap": true,
  "ffmpeg": true,
  "open3d": true,
  "gpu_enabled": false
}
```

### `POST /scan` (multipart, field `video`)
Same shape as the other sidecar:
```json
{
  "ok": true,
  "job_id": "a3f1c9b2e7d8",
  "layout": {
    "walls": [{ "id": "wall_0", "ax": -2.5, "ay": -3.0, "az": 0, "bx": 2.5, "by": -3.0, "bz": 0, "height": 2.6, "thickness": 0.1 }],
    "doors": [],
    "windows": [],
    "bboxes": []
  },
  "artifacts": { "point_cloud": "/artifacts/a3f1c9b2e7d8/fused.ply" }
}
```

Note: doors/windows/bboxes always empty in this pipeline — classical CV
doesn't do semantic detection. The room renders as bare walls + floor,
which is honest. Frontend handles empty arrays fine.

## Run locally (Mac works for dev)

```bash
brew install colmap ffmpeg
cd server/python-sidecar-colmap
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

Then in the Node `.env`:
```bash
SCAN_SIDECAR_URL=http://localhost:8001
```

## Deploy to any cheap VPS

Hetzner, DigitalOcean, Linode — any 2 vCPU / 4 GB box runs this for $5–6/mo.

```bash
# On the VPS:
git clone <repo>
cd <repo>/server/python-sidecar-colmap
docker build -t ariadne-colmap .
docker run -d --restart=unless-stopped -p 8001:8001 ariadne-colmap
```

Then point `SCAN_SIDECAR_URL` at the public IP. Use Caddy or nginx in
front for HTTPS if exposing publicly.

## Tuning

| Env | Default | Effect |
|---|---|---|
| `COLMAP_FRAMES_PER_VIDEO` | 30 | More frames = denser cloud, slower runtime |
| `COLMAP_USE_GPU` | 0 | Set `1` if COLMAP was built with CUDA (full dense pipeline runs) |
| `WORK_ROOT` | `/tmp/ariadne-scans-colmap` | Where per-job artifacts live |

## Speed expectations

| Setup | 30-frame clip |
|---|---|
| Hetzner CX22 (2 vCPU CPU-only) | 2–5 min |
| Hetzner CX42 (8 vCPU CPU-only) | 45 s – 2 min |
| RunPod 4090 GPU (CUDA COLMAP) | 30 s |

For most furniture-preview use cases the CPU droplet is fine — users
will tolerate 2–3 min for a real reconstruction.
