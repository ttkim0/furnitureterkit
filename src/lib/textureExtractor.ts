// Sample wall / floor / ceiling photo textures from the user's video
// frames, entirely in the browser. The cropped patches are applied as
// baseColor maps in RoomLayout3D so the rendered room shows the user's
// actual surfaces (real wall paint color + grain, real floor texture,
// real ceiling) instead of flat colors or hallucinated Hunyuan meshes.
//
// Algorithm per surface (top/middle/bottom of the frame):
//   1. For every input frame, sample the relevant vertical third
//   2. Compute color variance — lower variance = more uniform region
//      = cleaner "this is just a wall/floor/ceiling shot" frame
//   3. Pick the frame with the LOWEST variance in that region
//   4. Crop a square patch from the center of that region
//   5. Return as a data URL ready for THREE.TextureLoader
//
// Why variance: real interior shots have furniture / doors / lots of
// edges in the middle third (walls), uniform colors at top (ceiling)
// and bottom (floor). The shot that has the most uniform wall slice
// is the one with the camera pointed at a plain wall section, perfect
// for a tileable texture.

import type { ExtractedFrame } from "./videoFrames";

export interface RoomTextures {
  /** data: URL for the floor map (PBR baseColor) */
  floorTextureUrl?: string;
  /** data: URL for the wall map */
  wallTextureUrl?: string;
  /** data: URL for the ceiling map */
  ceilingTextureUrl?: string;
  /** Source frame timestamps so we can debug-explain which frame each came from. */
  sources?: { floor?: number; wall?: number; ceiling?: number };
}

const PATCH_SIZE = 512; // output texture is 512×512 — plenty for tiled rendering
const REGION_HEIGHT_FRACTION = 0.5; // sample 50% of each third's height

export async function extractRoomTextures(
  frames: ExtractedFrame[]
): Promise<RoomTextures> {
  if (frames.length === 0) return {};

  // Score every frame in all three regions in one pass — cheaper than
  // loading each bitmap three times.
  const scored: Array<{
    frame: ExtractedFrame;
    bitmap: ImageBitmap;
    topVar: number;
    middleVar: number;
    bottomVar: number;
  }> = [];
  for (const frame of frames) {
    try {
      const bitmap = await createImageBitmap(frame.blob);
      const stats = computeRegionVariances(bitmap);
      scored.push({ frame, bitmap, ...stats });
    } catch {
      // skip frames we can't decode (rare)
    }
  }
  if (scored.length === 0) return {};

  // Pick lowest-variance frame per region
  const pickLowest = (key: "topVar" | "middleVar" | "bottomVar") =>
    scored.reduce((best, cur) => (cur[key] < best[key] ? cur : best));

  const ceilingPick = pickLowest("topVar");
  const wallPick = pickLowest("middleVar");
  const floorPick = pickLowest("bottomVar");

  const [ceilingTextureUrl, wallTextureUrl, floorTextureUrl] = await Promise.all([
    cropPatch(ceilingPick.bitmap, "top"),
    cropPatch(wallPick.bitmap, "middle"),
    cropPatch(floorPick.bitmap, "bottom"),
  ]);

  // Release bitmaps
  for (const s of scored) s.bitmap.close?.();

  return {
    floorTextureUrl,
    wallTextureUrl,
    ceilingTextureUrl,
    sources: {
      floor: floorPick.frame.timestamp,
      wall: wallPick.frame.timestamp,
      ceiling: ceilingPick.frame.timestamp,
    },
  };
}

// ─── Region scoring ────────────────────────────────────────────────────

function computeRegionVariances(bitmap: ImageBitmap): {
  topVar: number;
  middleVar: number;
  bottomVar: number;
} {
  // Downsample to a smaller canvas for the variance pass — saves a ton
  // of pixel reads with no real loss of signal.
  const sampleW = 200;
  const sampleH = 200;
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(sampleW, sampleH)
      : (() => {
          const c = document.createElement("canvas");
          c.width = sampleW;
          c.height = sampleH;
          return c;
        })();
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return { topVar: Infinity, middleVar: Infinity, bottomVar: Infinity };
  ctx.drawImage(bitmap, 0, 0, sampleW, sampleH);
  const third = Math.floor(sampleH / 3);
  const topData = ctx.getImageData(0, 0, sampleW, third).data;
  const middleData = ctx.getImageData(0, third, sampleW, third).data;
  const bottomData = ctx.getImageData(0, 2 * third, sampleW, sampleH - 2 * third).data;
  return {
    topVar: colorVariance(topData),
    middleVar: colorVariance(middleData),
    bottomVar: colorVariance(bottomData),
  };
}

function colorVariance(data: Uint8ClampedArray): number {
  const n = data.length / 4;
  if (n === 0) return 0;
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < data.length; i += 4) {
    mr += data[i];
    mg += data[i + 1];
    mb += data[i + 2];
  }
  mr /= n;
  mg /= n;
  mb /= n;
  let v = 0;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - mr;
    const dg = data[i + 1] - mg;
    const db = data[i + 2] - mb;
    v += dr * dr + dg * dg + db * db;
  }
  return v / n;
}

// ─── Cropping ──────────────────────────────────────────────────────────

async function cropPatch(
  bitmap: ImageBitmap,
  region: "top" | "middle" | "bottom"
): Promise<string> {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(PATCH_SIZE, PATCH_SIZE)
      : (() => {
          const c = document.createElement("canvas");
          c.width = PATCH_SIZE;
          c.height = PATCH_SIZE;
          return c;
        })();
  const ctx = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("no 2D context for cropPatch");

  const w = bitmap.width;
  const h = bitmap.height;
  const thirdH = h / 3;
  const cropH = Math.floor(thirdH * REGION_HEIGHT_FRACTION);
  const cropW = Math.min(cropH, w); // square-ish
  // Vertical center of each region
  let cy: number;
  if (region === "top") cy = thirdH * 0.5;
  else if (region === "middle") cy = thirdH * 1.5;
  else cy = thirdH * 2.5;
  const srcY = Math.max(0, Math.floor(cy - cropH / 2));
  const srcX = Math.max(0, Math.floor((w - cropW) / 2));
  ctx.drawImage(bitmap, srcX, srcY, cropW, cropH, 0, 0, PATCH_SIZE, PATCH_SIZE);

  // Convert canvas → data URL
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.9,
    });
    return await blobToDataUrl(blob);
  } else {
    return canvas.toDataURL("image/jpeg", 0.9);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
