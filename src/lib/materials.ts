// Material picker presets + procedural normal map generator.
//
// "Original" preserves whatever PBR materials Hunyuan baked into the GLB.
// All other presets override every mesh in the scene with a meshStandard
// material configured for that look.

import {
  CanvasTexture,
  Color,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  type Group,
  type Texture,
} from "three";

export type MaterialPreset =
  | "original"
  | "solid"
  | "fabric"
  | "leather"
  | "marble"
  | "wood"
  | "metal"
  | "plastic";

export type PatternType = "none" | "knit" | "weave" | "dots" | "noise";

export interface MaterialOverride {
  preset: MaterialPreset;
  color: string; // hex "#rrggbb"
  pattern: PatternType;
  patternIntensity: number; // 0–100
  patternScale: number; // tile repeats, 1–32
}

export const DEFAULT_MATERIAL: MaterialOverride = {
  preset: "original",
  color: "#cdd97a",
  pattern: "none",
  patternIntensity: 50,
  patternScale: 8,
};

export const PRESET_LABELS: Record<MaterialPreset, string> = {
  original: "Original (PBR from Hunyuan)",
  solid: "Solid color",
  fabric: "Fabric",
  leather: "Leather",
  marble: "Marble",
  wood: "Wood",
  metal: "Metal",
  plastic: "Plastic",
};

interface PresetParams {
  roughness: number;
  metalness: number;
}

const PRESETS: Record<Exclude<MaterialPreset, "original">, PresetParams> = {
  solid: { roughness: 0.6, metalness: 0.0 },
  fabric: { roughness: 0.95, metalness: 0.0 },
  leather: { roughness: 0.5, metalness: 0.05 },
  marble: { roughness: 0.15, metalness: 0.05 },
  wood: { roughness: 0.7, metalness: 0.0 },
  metal: { roughness: 0.25, metalness: 0.85 },
  plastic: { roughness: 0.35, metalness: 0.05 },
};

export const PATTERN_LABELS: Record<PatternType, string> = {
  none: "None",
  knit: "Knit",
  weave: "Weave",
  dots: "Dots",
  noise: "Noise",
};

// Cache patterns so flipping the pattern dropdown doesn't re-rasterize.
const _patternCache = new Map<PatternType, Texture>();

function makeNormalCanvas(pattern: PatternType): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Base normal: pointing straight up = (128, 128, 255)
  ctx.fillStyle = "rgb(128, 128, 255)";
  ctx.fillRect(0, 0, size, size);

  if (pattern === "knit") {
    // Alternating horizontal + vertical strands — fakes a knit weave by
    // tilting normals back and forth.
    const stride = 12;
    ctx.lineWidth = 5;
    for (let y = 0; y < size; y += stride) {
      ctx.strokeStyle = "rgb(160, 128, 220)";
      ctx.beginPath();
      ctx.moveTo(0, y + 2);
      ctx.lineTo(size, y + 2);
      ctx.stroke();
      ctx.strokeStyle = "rgb(96, 128, 220)";
      ctx.beginPath();
      ctx.moveTo(0, y + 6);
      ctx.lineTo(size, y + 6);
      ctx.stroke();
    }
    for (let x = 0; x < size; x += stride) {
      ctx.strokeStyle = "rgb(128, 160, 220)";
      ctx.beginPath();
      ctx.moveTo(x + 2, 0);
      ctx.lineTo(x + 2, size);
      ctx.stroke();
      ctx.strokeStyle = "rgb(128, 96, 220)";
      ctx.beginPath();
      ctx.moveTo(x + 6, 0);
      ctx.lineTo(x + 6, size);
      ctx.stroke();
    }
  } else if (pattern === "weave") {
    // Larger interlocking squares — reads as a basket weave.
    const cell = 32;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const isAlt = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
        ctx.fillStyle = isAlt ? "rgb(170, 128, 230)" : "rgb(86, 128, 230)";
        ctx.fillRect(x, y, cell - 2, cell - 2);
      }
    }
  } else if (pattern === "dots") {
    const cell = 24;
    for (let y = cell / 2; y < size; y += cell) {
      for (let x = cell / 2; x < size; x += cell) {
        const grad = ctx.createRadialGradient(x, y, 0, x, y, cell / 2.5);
        grad.addColorStop(0, "rgb(128, 128, 255)");
        grad.addColorStop(0.5, "rgb(180, 180, 200)");
        grad.addColorStop(1, "rgb(128, 128, 255)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, cell / 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === "noise") {
    // Per-pixel random nudge — granular surface like sandpaper or stucco.
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const dx = (Math.random() - 0.5) * 60;
      const dy = (Math.random() - 0.5) * 60;
      img.data[i] = Math.max(0, Math.min(255, 128 + dx));
      img.data[i + 1] = Math.max(0, Math.min(255, 128 + dy));
      img.data[i + 2] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}

export function getPatternTexture(pattern: PatternType): Texture | null {
  if (pattern === "none") return null;
  if (_patternCache.has(pattern)) return _patternCache.get(pattern)!;
  const canvas = makeNormalCanvas(pattern);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  _patternCache.set(pattern, tex);
  return tex;
}

interface SavedOriginal {
  material: MeshStandardMaterial;
}

const _originalMaterials = new WeakMap<Mesh, SavedOriginal>();

function ensureOriginalSaved(mesh: Mesh) {
  if (_originalMaterials.has(mesh)) return;
  const m = mesh.material as MeshStandardMaterial;
  _originalMaterials.set(mesh, { material: m });
}

// Apply a MaterialOverride to every mesh inside a GLTF scene. Idempotent —
// safe to call repeatedly as the picker changes.
export function applyMaterialOverride(scene: Group, override: MaterialOverride) {
  scene.traverse((obj) => {
    if (!(obj as Mesh).isMesh) return;
    const mesh = obj as Mesh;
    ensureOriginalSaved(mesh);

    if (override.preset === "original") {
      const original = _originalMaterials.get(mesh);
      if (original) mesh.material = original.material;
      return;
    }

    const params = PRESETS[override.preset];
    let mat = mesh.material as MeshStandardMaterial;
    // If the current material is the original (cached) one, swap in a fresh
    // override material so we don't stomp on the original's textures.
    const isOriginal = mat === _originalMaterials.get(mesh)?.material;
    if (isOriginal) {
      mat = new MeshStandardMaterial();
      mesh.material = mat;
    }
    mat.color = new Color(override.color);
    mat.roughness = params.roughness;
    mat.metalness = params.metalness;
    // Drop original textures when an override preset is active.
    mat.map = null;
    mat.metalnessMap = null;
    mat.roughnessMap = null;
    // Apply procedural normal pattern.
    const tex = getPatternTexture(override.pattern);
    if (tex) {
      tex.repeat.set(override.patternScale, override.patternScale);
      tex.needsUpdate = true;
      mat.normalMap = tex;
      const intensity = override.patternIntensity / 100;
      mat.normalScale.set(intensity, intensity);
    } else {
      mat.normalMap = null;
    }
    mat.needsUpdate = true;
  });
}
