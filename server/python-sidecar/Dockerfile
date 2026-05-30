# Ariadne room-scan sidecar image. Built for RunPod / Lambda Labs PyTorch
# CUDA 12.4 base. Tested target: NVIDIA RTX 4090 (24 GB) or A40 (48 GB).
# A 3090 (24 GB) is the practical minimum for SLAM3R; SpatialLM 0.5B Qwen
# needs only ~6 GB.

FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

# System deps: git for cloning the upstream repos, ffmpeg for video I/O,
# libgl for OpenCV.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ffmpeg libgl1 libglib2.0-0 build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

# ── SLAM3R (CC-BY-NC-SA 4.0 — non-commercial) ────────────────────────────
# Clone + install. SLAM3R needs a CUDA RoPE kernel built in-tree.
RUN git clone --depth 1 https://github.com/PKU-VCL-3DV/SLAM3R.git /opt/SLAM3R \
    && pip install --upgrade pip \
    && pip install -r /opt/SLAM3R/requirements.txt \
    # xformers is optional but recommended for speed; pin to match torch 2.5
    && pip install xformers==0.0.28.post3 || true \
    # Build the custom RoPE kernel — REQUIRES nvcc + matching CUDA in
    # the base image. If this fails the rest of SLAM3R still works but
    # slower.
    && cd /opt/SLAM3R/slam3r/models/curope && python setup.py build_ext --inplace

# ── SpatialLM (Llama 3.2 Community License + CC-BY-NC encoder) ───────────
RUN git clone --depth 1 https://github.com/manycore-research/SpatialLM.git /opt/SpatialLM \
    && pip install -e /opt/SpatialLM \
    # flash-attn for the Sonata encoder — REQUIRED for SpatialLM 1.1
    && pip install flash-attn --no-build-isolation || true

# ── Sidecar app ──────────────────────────────────────────────────────────
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY main.py .

EXPOSE 8000

# Env defaults — override at runtime
ENV SLAM3R_PATH=/opt/SLAM3R \
    SPATIALLM_PATH=/opt/SpatialLM \
    WORK_ROOT=/tmp/ariadne-scans \
    SLAM3R_NUM_POINTS=1500000 \
    SLAM3R_KEYFRAME_STRIDE=4

# Pre-download SpatialLM weights at build time so the first request isn't
# slow (HF download ~1 GB). Comment this out if you want a smaller image.
# RUN python -c "from huggingface_hub import snapshot_download; \
#     snapshot_download('manycore-research/SpatialLM1.1-Qwen-0.5B')"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
