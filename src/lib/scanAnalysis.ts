// Live frame + orientation analysis for the room-scan recorder.
//
// Polycam-style real-time guidance: while the user is filming, we sample
// the camera preview at ~4 Hz and:
//   - estimate scene brightness (warn if the room is too dark)
//   - estimate inter-frame motion (warn if the user is sweeping too fast,
//     which produces motion-blurred frames SLAM3R can't track)
//   - track which compass headings (via DeviceOrientationEvent) the
//     phone has pointed at, treating that as "coverage" of the room
//
// All three signals are advisory — the actual recording continues
// regardless. We just nudge the user toward a better take.

import { useEffect, useRef, useState } from "react";

// Downsample frame to a tiny canvas — pixel-perfect analysis is wasted
// effort; we just need rough averages. 80×60 is plenty for both
// brightness and inter-frame motion.
const SAMPLE_W = 80;
const SAMPLE_H = 60;
const SAMPLE_HZ = 4; // 4 ticks/sec

// Bucket the compass into 12 × 30° wedges. The user has "covered" a
// wedge whenever the heading has been pointing at it for at least one
// orientation event.
const COVERAGE_WEDGES = 12;

export interface ScanSignals {
  /** Mean luminance, 0..1. < 0.25 is dim, < 0.15 is too dark. */
  brightness: number;
  /** Mean abs pixel diff vs previous frame, 0..1. > 0.08 is too fast. */
  motion: number;
  /** Fraction of compass headings covered, 0..1. */
  coverage: number;
  /** Bool: have we ever received a DeviceOrientationEvent? */
  orientationAvailable: boolean;
}

export function useScanAnalysis(
  videoEl: HTMLVideoElement | null,
  active: boolean
): ScanSignals {
  const [brightness, setBrightness] = useState(0.5);
  const [motion, setMotion] = useState(0);
  const [coverage, setCoverage] = useState(0);
  const [orientationAvailable, setOrientationAvailable] = useState(false);
  const headingsSeen = useRef<Set<number>>(new Set());

  // ── Frame analysis loop ─────────────────────────────────────────────
  useEffect(() => {
    if (!active || !videoEl) return;
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let prev: Uint8ClampedArray | null = null;
    const tick = () => {
      if (videoEl.readyState < 2 || videoEl.videoWidth === 0) return;
      ctx.drawImage(videoEl, 0, 0, SAMPLE_W, SAMPLE_H);
      const frame = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

      // Mean luminance
      let lumSum = 0;
      let diffSum = 0;
      const px = frame.length / 4;
      for (let i = 0; i < frame.length; i += 4) {
        const r = frame[i];
        const g = frame[i + 1];
        const b = frame[i + 2];
        // Perceptual luminance (Rec. 601)
        lumSum += 0.299 * r + 0.587 * g + 0.114 * b;
        if (prev) {
          diffSum +=
            Math.abs(r - prev[i]) +
            Math.abs(g - prev[i + 1]) +
            Math.abs(b - prev[i + 2]);
        }
      }
      setBrightness(lumSum / px / 255);
      if (prev) setMotion(diffSum / px / 3 / 255);
      prev = new Uint8ClampedArray(frame); // copy so next tick can diff
    };

    const interval = window.setInterval(tick, 1000 / SAMPLE_HZ);
    tick();
    return () => window.clearInterval(interval);
  }, [active, videoEl]);

  // ── Device-orientation coverage tracker ─────────────────────────────
  useEffect(() => {
    if (!active) return;
    headingsSeen.current = new Set();
    setCoverage(0);
    setOrientationAvailable(false);

    const handler = (e: DeviceOrientationEvent) => {
      if (e.alpha == null) return;
      setOrientationAvailable(true);
      const alpha = ((e.alpha % 360) + 360) % 360;
      const wedge = Math.floor(alpha / (360 / COVERAGE_WEDGES));
      if (!headingsSeen.current.has(wedge)) {
        headingsSeen.current.add(wedge);
        setCoverage(headingsSeen.current.size / COVERAGE_WEDGES);
      }
    };

    window.addEventListener("deviceorientation", handler);
    return () => window.removeEventListener("deviceorientation", handler);
  }, [active]);

  return { brightness, motion, coverage, orientationAvailable };
}

// iOS Safari requires DeviceOrientationEvent.requestPermission() to be
// invoked from a user gesture. Other browsers permit silently. This
// helper handles both. Returns true if permission was granted.
export async function requestOrientationPermission(): Promise<boolean> {
  const w = window as unknown as {
    DeviceOrientationEvent?: {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
  };
  const requestPermission = w.DeviceOrientationEvent?.requestPermission;
  if (typeof requestPermission === "function") {
    try {
      const result = await requestPermission();
      return result === "granted";
    } catch {
      return false;
    }
  }
  // Non-iOS browser — no permission gate, orientation just works (or
  // silently doesn't, e.g. desktop without an IMU).
  return true;
}

// Static help-tip cycle, shown one at a time during recording. Keeps
// the user reminded of the basics without overwhelming the overlay.
export const SCAN_TIPS = [
  "Hold the phone horizontally",
  "Move slowly, like walking — about 1 step per second",
  "Sweep along walls and pause at each corner",
  "Capture the floor near the walls too",
  "Don't forget the ceiling line",
  "Step backwards a few feet to grab wide views",
];
