# Gaussian Splatting room-scan sidecar — fully Apache 2.0 / BSD / MIT.
# Built for RunPod / Lambda Labs PyTorch CUDA 12.4 base.
# Tested target: NVIDIA RTX 4090 (24 GB). 3090 works. A40/A6000 give
# headroom for longer clips / higher iteration counts.

FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    CUDA_HOME=/usr/local/cuda \
    PATH=/usr/local/cuda/bin:$PATH \
    LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH

# System deps: COLMAP for SfM, ffmpeg for video, git for installs
RUN apt-get update && apt-get install -y --no-install-recommends \
      colmap ffmpeg git curl build-essential \
      libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

# Nerfstudio + gsplat (Apache 2.0)
# Install gsplat first — has the CUDA kernel that needs torch CUDA matched.
RUN pip install --upgrade pip \
 && pip install ninja \
 && pip install nerfstudio

# Sidecar app
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY main.py .

EXPOSE 8000

ENV WORK_ROOT=/tmp/ariadne-splat \
    SPLAT_FRAMES_PER_VIDEO=100 \
    SPLAT_MAX_ITERATIONS=15000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
