// Extract N evenly-spaced JPEG frames from a video file using the
// browser's HTMLVideoElement seek + canvas API. Used by the free-tier
// scan flow so users can upload a single video and we automatically
// split it into the 8-10 frames gpt-image-1 will composite from.
//
// Why not just upload the whole video to the backend?
//   - Smaller payload (8 small JPEGs vs. a 30-50 MB clip)
//   - Reuses the existing /api/generate-room-from-photos endpoint
//   - Faster: browser seek is parallelizable, no server round-trip
//   - Privacy: full video never leaves the device unless they choose
//     the premium video path
//
// Limitations:
//   - Some browsers (Safari < 16) refuse to seek beyond what's been
//     buffered. We work around this by setting preload="auto" and
//     waiting for loadeddata.
//   - Video must have keyframes at roughly the timestamps we seek to
//     for the frames to be sharp. Modern phone-recorded mp4 / webm is
//     fine. Heavily-compressed streams (vp9 long-GOP) can show motion
//     blur. Not a blocker — gpt-image-1 handles slight blur fine.

export interface ExtractedFrame {
  blob: Blob;
  dataUrl: string;
  /** base64 without the data: prefix — ready for the ImageRef payload. */
  base64: string;
  /** Source timestamp in the video, seconds. */
  timestamp: number;
  /** 16×16 grayscale fingerprint, 256 floats — for similarity dedup. */
  fingerprint?: Float32Array;
}

export interface ExtractOptions {
  /** How many frames to extract. Default 8. Capped by backend at 10. */
  count?: number;
  /** Long-edge cap for the extracted frames, px. Default 1024. */
  maxDim?: number;
  /** JPEG quality 0..1, default 0.85. */
  quality?: number;
  /** Optional per-frame progress callback (idx, total). */
  onProgress?: (extracted: number, total: number) => void;
}

export async function extractFramesFromVideo(
  file: File | Blob,
  opts: ExtractOptions = {}
): Promise<ExtractedFrame[]> {
  const count = Math.max(2, Math.min(10, opts.count ?? 8));
  const maxDim = opts.maxDim ?? 1024;
  const quality = opts.quality ?? 0.85;

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";

  try {
    await new Promise<void>((resolve, reject) => {
      const onMeta = () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onErr);
        resolve();
      };
      const onErr = () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onErr);
        reject(new Error("failed to load video metadata"));
      };
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error", onErr);
    });

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(
        `Video has zero/unknown duration (${duration}s) — pick another file`
      );
    }

    // Compute output canvas size — fit within maxDim on the long edge
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    const cw = Math.round(vw * scale);
    const ch = Math.round(vh * scale);

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not get 2D context");

    // Evenly-spaced timestamps, skipping the very first and last frame
    // (often a fade-in or hand-on-record artifact).
    const timestamps = Array.from(
      { length: count },
      (_, i) => (duration * (i + 1)) / (count + 1)
    );

    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, cw, ch);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
          "image/jpeg",
          quality
        );
      });
      const dataUrl = await blobToDataUrl(blob);
      frames.push({
        blob,
        dataUrl,
        base64: dataUrl.split(",")[1],
        timestamp: t,
      });
      opts.onProgress?.(i + 1, timestamps.length);
    }

    return frames;
  } finally {
    URL.revokeObjectURL(url);
    // Release the decoder
    video.src = "";
    video.load();
  }
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`failed to seek to ${t}s`));
    };
    // 4 s safety timeout — some browsers stall silently on un-buffered ranges
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`seek timeout at ${t}s`));
    }, 4000);
    video.addEventListener("seeked", () => {
      clearTimeout(timeout);
      onSeeked();
    });
    video.addEventListener("error", () => {
      clearTimeout(timeout);
      onError();
    });
    video.currentTime = t;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

// ─── Diverse-frame selection ─────────────────────────────────────────────
//
// gpt-image-1's edit endpoint caps at 10 input images per request. But
// "10 evenly-spaced frames" isn't the same as "10 frames that cover
// different parts of the room" — if the user lingers on one wall for 5
// seconds, half the evenly-spaced frames are duplicates of that wall.
//
// Instead we extract a denser pool of candidates (default 40), fingerprint
// each as a tiny 16×16 grayscale thumbnail, then greedily pick the N
// frames with maximum minimum-distance to the already-selected set —
// classic max-min facility-location, gives us frames that span the visual
// diversity of the video rather than its timeline.

const FP_SIZE = 16; // 16×16 grayscale fingerprint per frame

async function fingerprintBlob(blob: Blob): Promise<Float32Array> {
  // Render the frame onto a tiny canvas, read out luminance per pixel.
  // OffscreenCanvas if available (workers, modern browsers); fall back to
  // a regular canvas otherwise.
  const bitmap = await createImageBitmap(blob);
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  let imageData: ImageData;
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(FP_SIZE, FP_SIZE);
    const cctx = c.getContext("2d", { willReadFrequently: true });
    if (!cctx) throw new Error("no 2d ctx for fingerprint");
    ctx = cctx;
    ctx.drawImage(bitmap, 0, 0, FP_SIZE, FP_SIZE);
    imageData = ctx.getImageData(0, 0, FP_SIZE, FP_SIZE);
  } else {
    const c = document.createElement("canvas");
    c.width = FP_SIZE;
    c.height = FP_SIZE;
    const cctx = c.getContext("2d", { willReadFrequently: true });
    if (!cctx) throw new Error("no 2d ctx for fingerprint");
    ctx = cctx;
    ctx.drawImage(bitmap, 0, 0, FP_SIZE, FP_SIZE);
    imageData = ctx.getImageData(0, 0, FP_SIZE, FP_SIZE);
  }
  bitmap.close?.();
  const px = imageData.data;
  const fp = new Float32Array(FP_SIZE * FP_SIZE);
  for (let i = 0; i < fp.length; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    fp[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  return fp;
}

function fpDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Greedy max-min selection: start with the first candidate, then repeatedly
 * add the candidate that's MAX(min_distance_to_already_selected). Produces
 * a subset that spans the visual diversity of the input pool.
 */
export function selectDiverseFrames(
  candidates: ExtractedFrame[],
  n: number
): ExtractedFrame[] {
  if (candidates.length <= n) return candidates;
  const hasFp = candidates.every((c) => c.fingerprint);
  if (!hasFp) {
    throw new Error(
      "selectDiverseFrames requires fingerprints — call extractDiverseFramesFromVideo"
    );
  }
  const selected: ExtractedFrame[] = [candidates[0]];
  const remaining = candidates.slice(1);
  while (selected.length < n && remaining.length > 0) {
    let bestIdx = 0;
    let bestMinDist = -1;
    for (let i = 0; i < remaining.length; i++) {
      let minDist = Infinity;
      for (const s of selected) {
        const d = fpDistance(remaining[i].fingerprint!, s.fingerprint!);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestIdx = i;
      }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  // Return in temporal order so the LLM sees a coherent walk-through
  return selected.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * One-shot: extract a dense pool of candidate frames, fingerprint each,
 * pick the N most-diverse via max-min selection. Returns the selected
 * frames in temporal order (oldest first).
 *
 * Use this for the free-tier scan flow.
 *
 * The hard limit is 50 selected frames because that's the safety cap on
 * what Claude vision can comfortably consume in one request (the actual
 * API limit is 100, but at 50 images per request the response stays
 * fast). gpt-image-1 only sees the top 10 of those 50 — the rest inform
 * Claude's structured room description.
 */
export async function extractDiverseFramesFromVideo(
  file: File | Blob,
  opts: {
    /** Number of frames sent downstream (Claude vision + gpt-image-1). 50 cap. */
    target?: number;
    /** Candidate pool size. 200 cap. More = better selection, longer extraction. */
    pool?: number;
    maxDim?: number;
    quality?: number;
    onProgress?: (stage: "extract" | "fingerprint" | "select", done: number, total: number) => void;
  } = {}
): Promise<ExtractedFrame[]> {
  const target = Math.max(2, Math.min(50, opts.target ?? 30));
  const pool = Math.max(target, Math.min(200, opts.pool ?? 120));
  // 1. Extract dense pool of candidates
  const candidates = await extractFramesFromVideo(file, {
    count: pool,
    maxDim: opts.maxDim,
    quality: opts.quality,
    onProgress: (done, total) => opts.onProgress?.("extract", done, total),
  });
  // 2. Fingerprint each
  for (let i = 0; i < candidates.length; i++) {
    candidates[i].fingerprint = await fingerprintBlob(candidates[i].blob);
    opts.onProgress?.("fingerprint", i + 1, candidates.length);
  }
  // 3. Greedy max-min selection
  opts.onProgress?.("select", 0, target);
  const diverse = selectDiverseFrames(candidates, target);
  opts.onProgress?.("select", target, target);
  return diverse;
}

// Cap is intentionally exposed so the UI can clamp opts
extractDiverseFramesFromVideo.MAX_TARGET = 50;
extractDiverseFramesFromVideo.MAX_POOL = 200;
