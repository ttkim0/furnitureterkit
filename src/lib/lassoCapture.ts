// Capture the rendered mesh canvas + composite the lasso polygon onto it,
// returning a base64 PNG that we can hand to OpenAI's image-edit endpoint.
//
// Requires the Canvas to be created with `gl={{ preserveDrawingBuffer: true }}`
// (set in Scene.tsx) — otherwise the WebGL drawing buffer is cleared after
// each frame and toDataURL returns a blank image.

import type { Point2D } from "./projection";

export interface LassoCapture {
  mediaType: string;
  data: string; // base64-encoded PNG (no data: prefix)
  preview: string; // data: URL (for showing in the popup)
  width: number;
  height: number;
}

// Capture just the rendered mesh — no lasso overlay. Used by Rebuild Mesh
// and the Chat refine flow so OpenAI edits the CURRENT visual instead of the
// original (often very different) reference image.
export async function captureMesh(canvas: HTMLCanvasElement): Promise<LassoCapture> {
  const meshDataUrl = canvas.toDataURL("image/png");
  const meshImage = await loadImage(meshDataUrl);
  const w = canvas.width;
  const h = canvas.height;
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("could not get 2D context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(meshImage, 0, 0, w, h);
  const composite = off.toDataURL("image/png");
  const base64 = composite.split(",")[1];
  return {
    mediaType: "image/png",
    data: base64,
    preview: composite,
    width: w,
    height: h,
  };
}

export async function captureMeshWithLasso(
  canvas: HTMLCanvasElement,
  polygon: Point2D[]
): Promise<LassoCapture> {
  // 1. Snapshot the current WebGL canvas
  const meshDataUrl = canvas.toDataURL("image/png");
  const meshImage = await loadImage(meshDataUrl);

  // 2. Create an offscreen canvas at the same pixel size and copy the mesh
  const w = canvas.width;
  const h = canvas.height;
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("could not get 2D context");

  // Background fill so OpenAI doesn't see the WebGL transparent pixels.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(meshImage, 0, 0, w, h);

  // 3. Compute scale from CSS pixels → canvas pixels (DPR handling)
  const rect = canvas.getBoundingClientRect();
  const scaleX = w / rect.width;
  const scaleY = h / rect.height;

  // 4. Draw the lasso polygon: bright translucent fill + bold outline.
  if (polygon.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(polygon[0].x * scaleX, polygon[0].y * scaleY);
    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(polygon[i].x * scaleX, polygon[i].y * scaleY);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 80, 0, 0.30)";
    ctx.fill();
    ctx.strokeStyle = "#ff5000";
    ctx.lineWidth = 8 * Math.max(scaleX, scaleY);
    ctx.stroke();
  }

  // 5. Encode as PNG, strip the "data:image/png;base64," prefix.
  const composite = off.toDataURL("image/png");
  const base64 = composite.split(",")[1];
  return {
    mediaType: "image/png",
    data: base64,
    preview: composite,
    width: w,
    height: h,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to load image"));
    img.src = src;
  });
}
