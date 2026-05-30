# Commercial-Friendly Room-Scan Pipeline (Heavy Mode)

The free tier (`/api/generate-room-from-photos` → gpt-image-1 + Hunyuan) is
what ships today. This document covers the **higher-fidelity, fully
commercial-licensed alternative** for when you want real geometry + real
furniture / door / window detection from a video scan — like Polycam.

## Why a separate doc

The fastest research-grade pipeline is **SLAM3R + SpatialLM** — already
wired in [`server/python-sidecar/`](server/python-sidecar/). But both
have **non-commercial license restrictions** (CC-BY-NC on SLAM3R, on
SpatialLM's encoder weights). Fine for R&D, blocks shipping in a paid
product.

The pipeline below uses only **permissive licenses (BSD / MIT / Apache 2.0)**.
Every component can be deployed in a closed-source paid SaaS.

## Architecture

```
┌─────────────┐    ┌──────────────────────┐    ┌─────────────────┐    ┌──────────────────┐    ┌────────────┐
│  Phone      │───▶│  RTAB-Map or COLMAP  │───▶│ Depth Anything  │───▶│  OpenMask3D      │───▶│  Open3D    │───▶ layout.json
│  video      │    │  → posed RGB frames  │    │ (monocular      │    │  open-vocab 3D   │    │  RANSAC    │     {walls,
│  (30 s)     │    │  + sparse cloud      │    │  depth)         │    │  instance seg    │    │  for walls │      doors,
└─────────────┘    └──────────────────────┘    └─────────────────┘    └──────────────────┘    └────────────┘      windows,
                            BSD-3                Apache 2.0              MIT                     MIT              furniture
                                                                                                                  bboxes}
```

Output JSON has the same `{ walls, doors, windows, bboxes }` shape the
existing [`RoomLayout3D`](src/components/RoomLayout3D.tsx) React component
already renders, so the frontend doesn't change — you swap the sidecar
binary and everything else just works.

## Component-by-component

### 1. SLAM / SfM — choose ONE of these

| Tool | License | Strengths | Weaknesses |
|---|---|---|---|
| **COLMAP** | New BSD ✓ | Most mature, great docs, ships in apt | Slow on CPU (5+ min/clip) without CUDA build |
| **RTAB-Map** | BSD-3 ✓ | Real-time, designed for RGB-D and SLAM | Higher install complexity, originally ROS-flavored |
| **OpenMVG + OpenMVS** | MPL-2.0 + AGPL ⚠ | OpenMVS is AGPL — viral, problematic for closed-source SaaS | Avoid OpenMVS for commercial closed-source |

**Recommendation:** start with COLMAP (already wired in
[`server/python-sidecar-colmap/`](server/python-sidecar-colmap/)). RTAB-Map
is the upgrade path when CPU-only COLMAP is too slow.

### 2. Depth estimation (needed by OpenMask3D)

OpenMask3D wants posed RGB-**D** frames. From a phone video you don't get
depth directly. Options:

| Tool | License | Notes |
|---|---|---|
| **Depth Anything V2** | Apache 2.0 ✓ | State-of-the-art monocular depth. ~700MB checkpoint. CPU works (slow), GPU fast. |
| **MiDaS v3.1** | MIT ✓ | Older but very fast. Lower accuracy than Depth Anything. |
| **COLMAP MVS depth** | New BSD ✓ | If you have CUDA COLMAP, dense reconstruction outputs depth maps natively — no extra model needed. |
| **iPhone Pro LiDAR** | n/a | If your user has it, ARKit gives real depth for free. Requires native iOS app. |

**Recommendation:** Depth Anything V2 unless you already have CUDA COLMAP
running (in which case skip — its MVS outputs are good enough).

### 3. Furniture / object instance segmentation

| Tool | License | Notes |
|---|---|---|
| **OpenMask3D** | MIT ✓ | Open-vocab 3D instance seg. Query any class ("sofa", "lamp", "table"). Needs RGB-D + camera poses. ~3GB weights. |
| **Mask2Former** | MIT ✓ | 2D-only instance seg, then re-project to 3D with camera poses. Lighter than OpenMask3D. |
| **Detectron2** | Apache 2.0 ✓ | 2D-only. Mature framework, many model zoo options. |
| **YOLO v8/v11** | AGPL ✗ | AGPL is viral — DO NOT use in closed-source SaaS. Use YOLOX (Apache) or RTMDet (Apache) instead. |

**Recommendation:** OpenMask3D for the full 3D bbox output. If GPU/RAM
becomes a problem, fall back to Mask2Former 2D + re-projection.

### 4. Wall / floor / ceiling extraction

| Tool | License | Notes |
|---|---|---|
| **Open3D RANSAC** | MIT ✓ | Already wired in `python-sidecar-colmap/pipeline.py`. Finds the largest planes — perfect for floors and walls in rectilinear rooms. |
| **Floor-SP** | varies | Research code for floor-plan extraction from point clouds — most are MIT/Apache. |

**Recommendation:** Open3D RANSAC is plenty for residential / office.
Floor-SP only if your users are scanning weirdly-shaped non-rectilinear
spaces.

### 5. Door / window detection

This is the hardest piece — there's no off-the-shelf "find me the doors
and windows in this point cloud" model with a clean license.

Three pragmatic approaches:

**(a) 2D detection on the source RGB frames → re-project to 3D**
- Run a 2D detector (Detectron2 / Mask2Former) trained on a dataset that
  includes "door" and "window" classes (ADE20K, Hypersim).
- Use the COLMAP camera poses to back-project the 2D detections onto the
  3D wall planes.
- Place a SpatialLM-shape `Door`/`Window` entry on the matching wall.

**(b) Hole detection in the point cloud**
- After Open3D plane fits, look for "holes" in the wall planes (regions
  where the point cloud is sparse but the plane fit predicts there should
  be points). Holes = openings = candidate doors/windows.
- Cheap, but no semantic label — every hole becomes "an opening".

**(c) LLM-vision call (the simplest)**
- Take 2-3 of the best COLMAP frames + the wall-extracted layout, send
  to Claude Sonnet vision with a prompt: "Mark on this wall layout where
  the doors and windows are. Return JSON."
- ~$0.01 per scan, no extra infrastructure, but adds 5-10 s of latency.

**Recommendation:** Ship (c) first — it's a 30-line addition to the
existing sidecar that gets you 80% of SpatialLM's quality at $0.01/scan
on a fully permissive stack. Move to (a) only if quality demands it.

## Deployment recipe

Once you've decided the components, the deployment is:

```dockerfile
# Pseudocode — full Dockerfile would be ~150 lines
FROM python:3.11-slim
RUN apt-get install -y colmap ffmpeg
RUN pip install open3d torch torchvision
RUN git clone https://github.com/OpenMask3D/openmask3d /opt/openmask3d
RUN git clone https://github.com/DepthAnything/Depth-Anything-V2 /opt/depth-anything
RUN download model weights …
COPY main.py pipeline.py /app/
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

Hardware: a 16 GB GPU box on RunPod or Lambda for ~$0.40/hr handles end-to-end
in ~60 s per scan. CPU-only works but takes 5-10 min per scan.

## What's already done

The plumbing is in place:
- [`server/python-sidecar-colmap/`](server/python-sidecar-colmap/) — already
  does COLMAP → Open3D walls, with a Docker image that runs anywhere.
- [`src/components/RoomLayout3D.tsx`](src/components/RoomLayout3D.tsx) —
  already renders `{ walls, doors, windows, bboxes }` JSON in 3D.

The remaining work is wiring **Depth Anything + OpenMask3D** into the
COLMAP sidecar and (optionally) adding LLM-vision door/window detection
on top.

## What's NOT done yet

- Depth Anything + OpenMask3D integration into the COLMAP sidecar (this
  is the next milestone). About a week of build time.
- Door/window detection. Defer until OpenMask3D output is in production.
- Frontend rendering of OpenMask3D bbox labels (currently the
  [RoomLayout3D](src/components/RoomLayout3D.tsx) component renders
  wireframe bboxes but doesn't label them — easy add).

## Cost / latency reality check

| Pipeline | Per-scan cost | Latency | License |
|---|---|---|---|
| **Free tier (today)** — gpt-image-1 + Hunyuan | ~$0.40 | 80 s | Commercial ✓ |
| **COLMAP + Open3D (today)** — walls only | <$0.01 + $6/mo droplet | 2-5 min CPU, 30 s GPU | BSD/MIT ✓ |
| **+ Depth Anything + OpenMask3D** (future) | ~$0.01 + GPU pod | 60-120 s on a 4090 | Apache/MIT ✓ |
| **SLAM3R + SpatialLM** | ~$0.01 + GPU pod | 30-60 s on a 4090 | CC-BY-NC ✗ |

The free tier is the right place to start. COLMAP is the right next
upgrade for "I want real geometry, not Hunyuan hallucination". Depth
Anything + OpenMask3D is the right upgrade for "I want labeled
furniture and doors".
