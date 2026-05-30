// "Scan your room" — two paths:
//
//  1. PHOTOS (free tier, default): user uploads 1-4 photos of their actual
//     room. gpt-image-1 composites them into a dollhouse-style render →
//     Hunyuan3D meshes it → loads as a GLB room. ~$0.40, ~80 s, no GPU.
//     Quality: single-view inference (Hunyuan hallucinates unseen sides)
//     but captures the user's actual wall colors, windows, floor.
//
//  2. VIDEO (premium tier): full SLAM3R + SpatialLM multi-view
//     reconstruction via a GPU sidecar. Real geometry, no hallucination.
//     Requires the SCAN_SIDECAR_URL env var on the Node backend to point
//     at a deployed sidecar (see DEPLOYMENT.md). Falls back to a clear
//     "premium not configured" message if not deployed.

import { useEffect, useRef, useState } from "react";
import {
  getScanRoomStatus,
  scanRoomFromPhotos,
  uploadRoomScanSplat,
  type ImageRef,
  type ScannedRoomLayout,
} from "../lib/api";
import {
  SCAN_TIPS,
  requestOrientationPermission,
  useScanAnalysis,
} from "../lib/scanAnalysis";
import { extractDiverseFramesFromVideo } from "../lib/videoFrames";

interface Props {
  // Free tier (Photos): Trellis multi-image-to-3D returns a GLB URL.
  // Loaded by Room3D via the AI-mesh URL path, same as our cached AI rooms.
  onScannedMesh: (meshUrl: string) => void;
  // Premium tier (Video, Gaussian Splatting sidecar on RunPod):
  // Splatfacto returns a .splat file that renders as a photoreal
  // radiance field via SplatViewer.
  onScannedSplat: (splatUrl: string) => void;
  // Legacy SLAM3R path (kept for the structured-layout case).
  onScannedLayout: (layout: ScannedRoomLayout) => void;
  setError: (e: string | null) => void;
}

type SubTab = "photos" | "video";

const MAX_RECORD_MS = 60 * 1000;
const TIP_ROTATE_MS = 4000;
const DARK_THRESHOLD = 0.18;
const FAST_THRESHOLD = 0.075;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 50; // backend cap = Claude vision's per-request budget
// Free-tier video pipeline:
//   1. Sample a DENSE pool of candidates (120 frames)
//   2. Fingerprint each (16×16 grayscale, ~5ms each in browser)
//   3. Greedy max-min selection → 30 most-different frames
//   4. Backend: Claude vision over all 30 → structured room description
//   5. gpt-image-1 composite: best 10 + Claude description as ground truth
//   6. Hunyuan meshes the composite
//
// More frames inform the room understanding; the image-generation model
// only sees the top 10 (its hard cap) but with Claude's analysis as
// explicit text guidance so every observation makes it into the result.
const VIDEO_TARGET_FRAMES = 30; // sent to Claude vision for analysis
const VIDEO_CANDIDATE_POOL = 120; // bigger pool = better diversity

export function ScanRoomFlow({
  onScannedMesh,
  onScannedSplat,
  onScannedLayout: _onScannedLayout,
  setError,
}: Props) {
  const [sub, setSub] = useState<SubTab>("photos");
  void _onScannedLayout; // SLAM3R path retained for future use
  return (
    <div className="scan-room-flow">
      <div className="scan-room-subtabs" role="tablist">
        <button
          role="tab"
          aria-selected={sub === "photos"}
          className={`scan-room-subtab ${sub === "photos" ? "active" : ""}`}
          onClick={() => setSub("photos")}
        >
          Photos <span className="scan-room-tier-badge">Free</span>
        </button>
        <button
          role="tab"
          aria-selected={sub === "video"}
          className={`scan-room-subtab ${sub === "video" ? "active" : ""}`}
          onClick={() => setSub("video")}
        >
          Video <span className="scan-room-tier-badge premium">Photoreal</span>
        </button>
      </div>
      {sub === "photos" ? (
        <PhotoScan onScanned={onScannedMesh} setError={setError} />
      ) : (
        <SplatScan onScanned={onScannedSplat} setError={setError} />
      )}
    </div>
  );
}

// ─── Free tier: photo-based scan ─────────────────────────────────────────

function PhotoScan({
  onScanned,
  setError,
}: {
  onScanned: (meshUrl: string) => void;
  setError: (e: string | null) => void;
}) {
  const [photos, setPhotos] = useState<
    Array<{ ref: ImageRef; preview: string; name: string }>
  >([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    const i = setInterval(() => {
      setElapsed(performance.now() - startRef.current);
    }, 250);
    return () => clearInterval(i);
  }, [busy]);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const slots = MAX_PHOTOS - photos.length;
    const accepted = Array.from(files).slice(0, slots);
    for (const f of accepted) {
      if (!f.type.match(/^image\/(png|jpe?g|gif|webp)$/)) {
        setError(`${f.name}: not a supported image type`);
        continue;
      }
      if (f.size > MAX_PHOTO_BYTES) {
        setError(
          `${f.name}: too large (${(f.size / 1024 / 1024).toFixed(1)} MB, max 8)`
        );
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const [meta, b64] = dataUrl.split(",");
        const m = /data:([^;]+);base64/.exec(meta);
        const mediaType = m?.[1] || f.type || "image/png";
        setPhotos((prev) => [
          ...prev,
          { ref: { mediaType, data: b64 }, preview: dataUrl, name: f.name },
        ]);
      };
      reader.onerror = () => setError(`Failed to read ${f.name}`);
      reader.readAsDataURL(f);
    }
  };

  // Upload a video → seek + canvas-extract VIDEO_FRAME_COUNT evenly-spaced
  // JPEG frames in the browser → drop them into the same photo state
  // the manual picker fills. Reuses the existing /api/generate-room-from-photos
  // endpoint, so the backend is identical.
  const ingestVideo = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError(`Not a video: ${file.type || "unknown type"}`);
      return;
    }
    setError(null);
    setBusy(true);
    setBusyStage(`Reading video…`);
    startRef.current = performance.now();
    setElapsed(0);
    try {
      // Extract VIDEO_CANDIDATE_POOL candidates, dedup to VIDEO_TARGET_FRAMES
      // most-different. The user sees live progress per stage so they
      // know we're doing real work (not just hanging).
      const frames = await extractDiverseFramesFromVideo(file, {
        target: VIDEO_TARGET_FRAMES,
        pool: VIDEO_CANDIDATE_POOL,
        maxDim: 1024,
        quality: 0.85,
        onProgress: (stage, done, total) => {
          if (stage === "extract") {
            setBusyStage(
              `Extracting frame ${done}/${total} from video`
            );
          } else if (stage === "fingerprint") {
            setBusyStage(
              `Analyzing frame similarity (${done}/${total})`
            );
          } else if (stage === "select") {
            setBusyStage(
              `Picked ${done}/${total} most-different frames`
            );
          }
        },
      });
      const newPhotos = frames.map((f, i) => ({
        ref: { mediaType: "image/jpeg", data: f.base64 } as ImageRef,
        preview: f.dataUrl,
        name: `frame-${i + 1}-at-${f.timestamp.toFixed(1)}s.jpg`,
      }));
      setPhotos(newPhotos);
      setBusy(false);
      setBusyStage("");
    } catch (e) {
      setBusy(false);
      setBusyStage("");
      setError(
        `Could not extract frames: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const removePhoto = (idx: number) =>
    setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (photos.length === 0) return;
    setBusy(true);
    setBusyStage(
      `Sending ${Math.min(photos.length, 10)} frames to Trellis multi-image-to-3D`
    );
    setError(null);
    startRef.current = performance.now();
    setElapsed(0);
    try {
      const result = await scanRoomFromPhotos(
        photos.map((p) => p.ref),
        description.trim() || undefined
      );
      onScanned(result.mesh_url);
    } catch (e) {
      setError(
        `Photo scan failed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setBusy(false);
      setBusyStage("");
    }
  };

  return (
    <>
      {!busy && (
        <>
          <div className="scan-room-onboard">
            <div className="scan-room-onboard-title">
              Two ways to scan
            </div>
            <ul className="scan-room-onboard-steps">
              <li>
                <b>📹 Upload a video</b> (recommended) — we sample{" "}
                {VIDEO_CANDIDATE_POOL} frames, pick the{" "}
                {VIDEO_TARGET_FRAMES} most-different views. Claude
                Sonnet vision reads all of them to write a detailed
                room spec, then gpt-image-1 renders a clean dollhouse
                cutaway from that spec — same pipeline as our cached
                AI rooms. Hunyuan3D meshes it. Photoreal GLB room.
              </li>
              <li>
                <b>🖼 Or upload up to 50 photos</b> — same pipeline,
                just skipping the auto-extract step.
              </li>
              <li>
                <b>Turn on the lights</b> before recording / shooting —
                Claude reads wall colors and materials directly from
                your photos.
              </li>
            </ul>
          </div>

          {photos.length > 0 && (
            <div className="photo-scan-thumbs">
              {photos.map((p, i) => (
                <div key={i} className="photo-scan-thumb">
                  <img src={p.preview} alt={p.name} />
                  <button
                    className="photo-scan-thumb-remove"
                    onClick={() => removePhoto(i)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  className="photo-scan-thumb add"
                  onClick={() => fileInputRef.current?.click()}
                  title="Add another photo"
                >
                  +
                </button>
              )}
            </div>
          )}

          {photos.length === 0 && (
            <div className="scan-room-actions">
              <button
                className="room-modal-primary"
                onClick={() => videoInputRef.current?.click()}
              >
                📹 Upload a video
              </button>
              <button
                className="room-modal-secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                🖼 Upload photos
              </button>
            </div>
          )}

          {photos.length > 0 && (
            <>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional — describe anything that's not obvious from the photos (e.g. 'L-shaped, about 4 × 6 meters, oak floors')"
                rows={2}
                className="room-modal-describe"
              />
              <button
                className="room-modal-primary"
                onClick={submit}
                disabled={photos.length === 0}
              >
                Build room from {photos.length}{" "}
                {photos.length === 1 ? "image" : "images"} (~$0.55, ~80 s)
              </button>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) ingestVideo(f);
              e.target.value = "";
            }}
          />
        </>
      )}

      {busy && (
        <div className="scan-room-progress">
          <div className="scan-room-progress-label">
            {busyStage || "Working…"} ({(elapsed / 1000).toFixed(1)}s)
          </div>
          <div className="scan-room-progress-bar indeterminate" />
          <p className="scan-room-tip">
            Step 1 (Claude Sonnet vision): read your photos →
            structured room description with dimensions, wall colors,
            doors, windows, lighting (~15–20 s). Step 2 (gpt-image-1
            GENERATE): render a clean dollhouse cutaway from that
            description — same call that built our cached AI rooms
            (~15 s). Step 3 (Hunyuan3D): mesh the render into a
            photoreal GLB (~45 s).
          </p>
        </div>
      )}
    </>
  );
}

// ─── Premium tier: Gaussian Splatting via GPU sidecar ───────────────────
//
// Real photorealistic 3D reconstruction via Nerfstudio Splatfacto running
// on a RunPod 4090. Returns a .splat file that the browser viewer renders
// as a radiance field — actual photos of the user's room reconstructed
// in 3D, navigable from any angle. ~$0.05/scan, ~10-15 min, fully Apache
// 2.0 / BSD / MIT (commercial-ready).
function SplatScan({
  onScanned,
  setError,
}: {
  onScanned: (splatUrl: string) => void;
  setError: (e: string | null) => void;
}) {
  type Mode = "idle" | "recording" | "uploading" | "processing" | "done" | "error";
  const [mode, setMode] = useState<Mode>("idle");
  const [progress, setProgress] = useState(0);
  const [recordingMs, setRecordingMs] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [tipIdx, setTipIdx] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const pollRef = useRef<number | null>(null);

  const signals = useScanAnalysis(
    previewVideoRef.current,
    mode === "recording"
  );

  useEffect(() => {
    if (mode !== "recording") return;
    const i = setInterval(() => {
      const e = performance.now() - recordStartRef.current;
      setRecordingMs(e);
      if (e >= MAX_RECORD_MS) stopRecording();
    }, 200);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "recording") return;
    const i = setInterval(
      () => setTipIdx((n) => (n + 1) % SCAN_TIPS.length),
      TIP_ROTATE_MS
    );
    return () => clearInterval(i);
  }, [mode]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const startRecording = async () => {
    setError(null);
    setStatusMsg(null);
    recordedChunksRef.current = [];
    setTipIdx(0);
    try {
      requestOrientationPermission().catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        await previewVideoRef.current.play().catch(() => {});
      }
      const mime = MediaRecorder.isTypeSupported("video/mp4")
        ? "video/mp4"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mime });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
        if (blob.size === 0) {
          setError("Recorded video was empty — try again");
          setMode("idle");
          return;
        }
        upload(blob, `room-${Date.now()}.${mime.includes("mp4") ? "mp4" : "webm"}`);
      };
      rec.start(1000);
      recordStartRef.current = performance.now();
      setRecordingMs(0);
      setMode("recording");
    } catch (e) {
      setError(`Could not access camera: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  const upload = async (blob: Blob, filename: string) => {
    setError(null);
    setMode("uploading");
    setProgress(0);
    try {
      const { jobId } = await uploadRoomScanSplat(blob, filename, (loaded, total) =>
        setProgress(loaded / total)
      );
      setMode("processing");
      setStatusMsg(
        "Running Splatfacto on the GPU sidecar… (~10–15 min)"
      );
      const poll = async () => {
        try {
          const s = await getScanRoomStatus(jobId);
          const splatUrl =
            (s.result as { local_splat_url?: string; splat_url?: string } | null | undefined)
              ?.local_splat_url ||
            (s.result as { local_splat_url?: string; splat_url?: string } | null | undefined)
              ?.splat_url;
          if (s.status === "done" && splatUrl) {
            window.clearInterval(pollRef.current!);
            pollRef.current = null;
            setMode("done");
            setStatusMsg(null);
            onScanned(splatUrl);
          } else if (s.status === "error") {
            window.clearInterval(pollRef.current!);
            pollRef.current = null;
            setMode("error");
            setError(`Scan failed: ${s.error || "unknown error"}`);
          } else {
            setStatusMsg(s.message || s.status);
          }
        } catch (e) {
          window.clearInterval(pollRef.current!);
          pollRef.current = null;
          setMode("error");
          setError(
            `Status poll failed: ${e instanceof Error ? e.message : String(e)} — is the GPU sidecar deployed at SCAN_SIDECAR_URL?`
          );
        }
      };
      pollRef.current = window.setInterval(poll, 3000);
      poll();
    } catch (e) {
      setMode("error");
      setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError(`Not a video: ${file.type || "unknown type"}`);
      return;
    }
    upload(file, file.name);
  };

  const recordingSeconds = Math.floor(recordingMs / 1000);
  const recordingMaxSeconds = Math.floor(MAX_RECORD_MS / 1000);
  const recordingPct = recordingMs / MAX_RECORD_MS;

  const warning = (() => {
    if (signals.brightness < DARK_THRESHOLD) {
      return { kind: "dark", text: "Too dark — turn on the lights or open a window" };
    }
    if (signals.motion > FAST_THRESHOLD) {
      return { kind: "fast", text: "Slow down — fast pans blur the frames" };
    }
    return null;
  })();

  return (
    <>
      {mode === "idle" && (
        <>
          <div className="scan-room-onboard">
            <div className="scan-room-onboard-title">
              Photoreal Gaussian Splatting
            </div>
            <p className="scan-room-tip">
              Actual photoreal 3D reconstruction of your room — Nerfstudio
              Splatfacto on a GPU sidecar (Apache 2.0, commercial-safe).
              Walk around the result like Polycam. Requires deployed
              sidecar — see DEPLOYMENT.md → splat tier.
            </p>
            <ol className="scan-room-onboard-steps">
              <li><b>Turn on the lights.</b> Even, bright light only.</li>
              <li><b>Hold phone horizontally</b>, back camera at the room.</li>
              <li><b>Walk slowly</b> — one step per second. Don't whip-pan.</li>
              <li><b>Aim at walls and corners</b>, not just the floor.</li>
              <li><b>20–60 seconds</b> max. Recorder auto-stops at 60 s.</li>
            </ol>
          </div>
          <div className="scan-room-actions">
            <button className="room-modal-primary" onClick={startRecording}>
              📹 Start recording
            </button>
            <button
              className="room-modal-secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload existing video
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </>
      )}

      {mode === "recording" && (
        <>
          <div className="scan-room-preview-wrap">
            <video ref={previewVideoRef} className="scan-room-preview" playsInline muted />
            <div className="scan-room-overlay-top">
              <span className="scan-room-rec-dot" />
              <span className="scan-room-rec-label">REC</span>
              <span className="scan-room-rec-time">
                {recordingSeconds}s / {recordingMaxSeconds}s
              </span>
            </div>
            <div className="scan-room-overlay-bottom">
              {signals.orientationAvailable ? (
                <div className="scan-room-coverage">
                  <span className="scan-room-coverage-label">Coverage</span>
                  <div className="scan-room-coverage-dots">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <span
                        key={i}
                        className={`scan-coverage-dot ${
                          i < Math.round(signals.coverage * 12) ? "filled" : ""
                        }`}
                      />
                    ))}
                  </div>
                  <span className="scan-room-coverage-pct">
                    {Math.round(signals.coverage * 100)}%
                  </span>
                </div>
              ) : (
                <div className="scan-room-coverage">
                  <span className="scan-room-coverage-label">
                    Frames captured
                  </span>
                  <span className="scan-room-coverage-pct">
                    {Math.round(recordingPct * 100)}%
                  </span>
                </div>
              )}
              <div className="scan-room-tip-live">{SCAN_TIPS[tipIdx]}</div>
            </div>
            {warning && (
              <div className={`scan-room-warning warn-${warning.kind}`}>
                ⚠ {warning.text}
              </div>
            )}
          </div>
          <div className="scan-room-time-bar">
            <div
              className="scan-room-time-fill"
              style={{ width: `${Math.min(100, recordingPct * 100)}%` }}
            />
          </div>
          <button className="room-modal-primary" onClick={stopRecording}>
            Stop & process
          </button>
        </>
      )}

      {mode === "uploading" && (
        <div className="scan-room-progress">
          <div className="scan-room-progress-label">
            Uploading… {Math.round(progress * 100)}%
          </div>
          <div className="scan-room-progress-bar">
            <div
              className="scan-room-progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {mode === "processing" && (
        <div className="scan-room-progress">
          <div className="scan-room-progress-label">
            {statusMsg || "Processing…"}
          </div>
          <div className="scan-room-progress-bar indeterminate" />
          <p className="scan-room-tip">
            Running on the GPU sidecar. Typical clip: 30–90 s.
          </p>
        </div>
      )}

      {mode === "done" && (
        <div className="scan-room-progress">
          <div className="scan-room-progress-label">
            ✓ Reconstructed — switching you into the room
          </div>
        </div>
      )}

      {mode === "error" && (
        <button
          className="room-modal-secondary"
          onClick={() => {
            setMode("idle");
            setError(null);
          }}
        >
          Try again
        </button>
      )}
    </>
  );
}
