# Permissive (BSD/MIT) room-scan sidecar.
#
# Runs anywhere — no GPU required for the default CPU-only pipeline
# (sparse SfM only; visually rougher but still extracts the room
# shape). Add `--gpus all` + the CUDA COLMAP build for the dense path.
#
# Tested on a $6/month Hetzner CX22 (2 vCPU / 4 GB) — handles a 30 s
# clip in 2-5 minutes. For paid scale, bump to a CX42 (8 vCPU / 16 GB)
# at ~$30/mo or a single GPU droplet for sub-minute runs.

FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

# COLMAP and ffmpeg are system binaries. Debian's apt has both.
RUN apt-get update && apt-get install -y --no-install-recommends \
      colmap ffmpeg libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY main.py pipeline.py ./

EXPOSE 8001

ENV COLMAP_BIN=colmap \
    FFMPEG_BIN=ffmpeg \
    COLMAP_USE_GPU=0 \
    COLMAP_FRAMES_PER_VIDEO=30 \
    WORK_ROOT=/tmp/ariadne-scans-colmap

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
