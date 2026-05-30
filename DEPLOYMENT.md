# Room-Scan Sidecar Deployment

The "Scan my room" flow has three tiers, each with different infra needs:

| Tier | UI | Backend | Hardware | License | Cost / scan |
|---|---|---|---|---|---|
| **Free** | "Photos" subtab | `/api/generate-room-from-photos` → Fal.ai (Trellis multi-image) | None | Commercial ✓ | ~$0.30 |
| **Photoreal Splat** ★ | "Video" subtab (with `SPLAT_SIDECAR_URL` → Splatfacto sidecar) | `server/python-sidecar-splat/` | RunPod RTX 4090 | Apache 2.0 / BSD / MIT ✓ | ~$0.05–0.10 + pod hours |
| Permissive walls-only | (legacy) `/api/scan-room` → COLMAP sidecar | `server/python-sidecar-colmap/` | Any 2 vCPU VPS, $5/mo | BSD / MIT ✓ | < $0.01 + droplet hours |
| Research-grade SLAM | (legacy) `/api/scan-room` → SLAM3R sidecar | `server/python-sidecar/` | GPU (RTX 3090+), RunPod | CC-BY-NC ✗ (internal only) | ~$0.01 + pod hours |

The **Free tier ships out of the box** — needs no separate sidecar.
The two premium tiers are mutually exclusive — set `SCAN_SIDECAR_URL`
to whichever you deploy. Pick the permissive one if you plan to ship
commercially.

> **For the full commercial-friendly upgrade path** — including
> furniture / door / window detection via Depth Anything V2 + OpenMask3D
> on top of the COLMAP sidecar — see [COMMERCIAL_PIPELINE.md](COMMERCIAL_PIPELINE.md).
> Everything Apache 2.0 / MIT / BSD, no license blockers.

## Local architecture

```
┌─────────────┐         ┌─────────────────┐         ┌──────────────────────┐
│  Browser    │  POST   │  Node backend   │  POST   │  Python sidecar      │
│  (React)    │ ──────▶ │  /api/scan-room │ ──────▶ │  /scan  (FastAPI)    │
│             │         │                 │         │    SLAM3R + SpatialLM│
│             │ ◀────── │                 │ ◀────── │                      │
│             │  poll   │                 │  layout │  (RunPod GPU box)    │
└─────────────┘         └─────────────────┘         └──────────────────────┘
```

The Node side just buffers the multipart upload, opens a job, forwards
the request to the sidecar in the background, then surfaces status via
`/api/scan-room/:jobId` to the polling frontend.

## Photoreal Splat tier: Nerfstudio Splatfacto on RunPod GPU ★

**This is what you actually want for the "see my real room in 3D"
feature.** Real photorealistic radiance-field reconstruction from your
phone video — like Polycam, but you own the stack and the licensing is
fully commercial-clean.

```bash
# RunPod pod template: PyTorch 2.5.1 / CUDA 12.4
# GPU: RTX 4090 (24 GB). Disk: 50 GB. Expose HTTP: 8000.
git clone <your-fork>
cd <repo>/server/python-sidecar-splat
docker build -t ariadne-splat .
docker run -d --restart=unless-stopped --gpus all -p 8000:8000 ariadne-splat

# Verify
curl https://<pod-id>-8000.proxy.runpod.net/healthz
```

In your Node `.env`:
```bash
SPLAT_SIDECAR_URL=https://<pod-id>-8000.proxy.runpod.net
# Optional — if SPLAT_SIDECAR_URL is unset, the splat endpoint falls
# back to SCAN_SIDECAR_URL (the catch-all). Useful if you only have
# one sidecar deployed.
```

Click the **Video** subtab in Scan, record / upload, get a `.splat`
back in ~10–15 min, render it in the browser via
`@mkkellogg/gaussian-splats-3d` (already installed, MIT). Walk around
your real room with your generated furniture inside.

Full details: [server/python-sidecar-splat/README.md](server/python-sidecar-splat/README.md).

## Permissive premium: COLMAP + Open3D on a cheap VPS

This is the **recommended premium tier** for shipping commercially —
no GPU, fully BSD/MIT-licensed, runs on a $5–6/month VPS.

```bash
# Hetzner CX22, DigitalOcean Basic 2GB, Linode Nanode 2GB — any of these
git clone <your-repo>
cd <your-repo>/server/python-sidecar-colmap
docker build -t ariadne-colmap .
docker run -d --restart=unless-stopped -p 8001:8001 ariadne-colmap
```

Set in your `.env`:
```bash
SCAN_SIDECAR_URL=http://<vps-ip>:8001
```

Speed: ~2–5 min per scan on a 2 vCPU box, ~45 s on 8 vCPU. Quality: walls
+ floor only (classical CV doesn't detect doors/windows/furniture). See
`server/python-sidecar-colmap/README.md` for details.

## Research-grade premium: SLAM3R + SpatialLM on RunPod GPU

### 1. Create a pod

- Template: **PyTorch 2.5.1 / CUDA 12.4** (search "pytorch" in templates)
- GPU: **RTX 4090 (24 GB)** is the sweet spot. RTX 3090 also works.
  A40 / A6000 (48 GB) give headroom for longer clips.
- Disk: 50 GB minimum (CUDA libs + model weights)
- Expose HTTP port: **8000**
- Cost as of 2026-05: $0.34–0.69/hr on-demand, $0.17–0.39/hr spot

### 2. Inside the pod, clone the upstream repos + this sidecar

```bash
# SLAM3R (CC-BY-NC-SA 4.0)
git clone https://github.com/PKU-VCL-3DV/SLAM3R.git /opt/SLAM3R
pip install -r /opt/SLAM3R/requirements.txt
pip install xformers==0.0.28.post3
cd /opt/SLAM3R/slam3r/models/curope && python setup.py build_ext --inplace

# SpatialLM (Llama 3.2 Community License + CC-BY-NC encoder)
git clone https://github.com/manycore-research/SpatialLM.git /opt/SpatialLM
pip install -e /opt/SpatialLM
pip install flash-attn --no-build-isolation

# This sidecar
git clone <your-fork-of-ariadne> /opt/ariadne
cd /opt/ariadne/server/python-sidecar
pip install -r requirements.txt
```

### 3. Pre-download the SpatialLM weights (avoids cold-start latency)

```bash
python -c "from huggingface_hub import snapshot_download; \
  snapshot_download('manycore-research/SpatialLM1.1-Qwen-0.5B')"
```

### 4. Run the sidecar

```bash
cd /opt/ariadne/server/python-sidecar
SLAM3R_PATH=/opt/SLAM3R \
SPATIALLM_PATH=/opt/SpatialLM \
uvicorn main:app --host 0.0.0.0 --port 8000
```

Check it's alive from your laptop:

```bash
curl https://<pod-id>-8000.proxy.runpod.net/healthz
# → { "ok": true, "cuda_available": true, "slam3r_path_exists": true, … }
```

### 5. Point the Node backend at it

In your `.env`:

```bash
SCAN_SIDECAR_URL=https://<pod-id>-8000.proxy.runpod.net
```

Restart `npm run dev` and the "Scan my room" tab in the editor is now
live end-to-end.

## Docker (alternative to manual install)

```bash
cd server/python-sidecar
docker build -t ariadne-scan-sidecar .
docker run --rm -p 8000:8000 --gpus all ariadne-scan-sidecar
```

Push to a registry (Docker Hub / GHCR) and deploy as a custom RunPod
template if you want a one-click rebuild.

## Costs

| Step | Time on 4090 | Cost |
|---|---|---|
| 30 s clip upload (50 MB) | a few seconds | bandwidth (RunPod free egress to public) |
| SLAM3R | ~25–45 s | ~$0.005 |
| SpatialLM | ~3–8 s | ~$0.001 |
| Pipeline total | ~30–60 s | < $0.01 per scan + pod-hour |

If you keep the pod running 24/7 (~$8–17/day) and scans average 1/min
during peak hours, you're at fractions of a cent per scan in marginal
cost. For low-volume use, stop the pod between sessions or use spot
pricing.

## Production hardening checklist (not done in v1)

- [ ] Persist `roomScanJobs` to Redis instead of in-memory Map
- [ ] Auth the sidecar (currently `*` CORS, no token check)
- [ ] Retry-on-cold-start when the pod was paused
- [ ] Add a download endpoint to fetch the raw point cloud (.ply)
      so the user can re-render it later without re-running SLAM3R
- [ ] Replace the Sonata encoder weights with a permissively-licensed
      retrain before shipping commercially (current licenses are
      CC-BY-NC — see sidecar README for details)
- [ ] Stream upload directly from browser → sidecar via signed URL to
      skip the Node hop for very large files

## Local dev without a GPU

The Node side still runs fine without the sidecar — the "Scan my room"
tab just shows a generic error when you try to upload (because the
`SCAN_SIDECAR_URL` defaults to `http://localhost:8000` and there's
nothing there). Everything else in the editor works as before. Stand
up the RunPod sidecar before testing scan end-to-end.
