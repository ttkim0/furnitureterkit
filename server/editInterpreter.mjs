// Keyword-based fallback interpreter. Used when ANTHROPIC_API_KEY is unset
// or when the LLM call fails. Operates on a Model part — derives the "thin
// axis" from the part's actual dimensions instead of hardcoding per-id.

const MATERIALS = [
  ["dark walnut", "#3d2615"],
  ["light walnut", "#7a5634"],
  ["walnut", "#5a3a22"],
  ["light oak", "#d9b988"],
  ["oak", "#c9a574"],
  ["black marble", "#1a1a1a"],
  ["white marble", "#e8e6e0"],
  ["marble", "#e8e6e0"],
  ["chrome", "#d0d0d8"],
  ["steel", "#8a8a92"],
  ["metal", "#a0a0a8"],
  ["brass", "#c9a967"],
  ["gold", "#d4af37"],
  ["leather", "#6b4423"],
  ["leopard", "#c9a060"],
  ["matte black", "#1a1a1a"],
  ["white", "#f5f5f0"],
  ["black", "#1a1a1a"],
  ["red", "#a83232"],
  ["blue", "#3a4f6e"],
  ["green", "#3d5f3d"],
  ["gray", "#888888"],
  ["grey", "#888888"],
];

function findMaterial(text) {
  for (const [name, color] of MATERIALS) {
    if (text.includes(name)) return color;
  }
  return undefined;
}

function tint(hex, delta) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const adjust = (v) => {
    const out =
      delta < 0
        ? Math.round(v * (1 + delta))
        : Math.round(v + (255 - v) * delta);
    return Math.max(0, Math.min(255, out)).toString(16).padStart(2, "0");
  };
  return `#${adjust(r)}${adjust(g)}${adjust(b)}`;
}

// Identify which axes are the "thin" ones (smallest dim, with ties counted).
function thinAxes(size) {
  const min = Math.min(...size);
  const out = [];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(size[i] - min) < 1e-6) out.push(i);
  }
  return out;
}

export function interpretEditWithKeywords(part, prompt) {
  const text = String(prompt).toLowerCase();
  const intensity = /\b(much|very|a lot|way)\b/.test(text) ? 0.5 : 0.2;
  const inc = 1 + intensity;
  const dec = 1 - intensity;

  const scale = [...part.scale];
  const thin = thinAxes(part.size);

  if (/\b(thicker|fatter|chunkier|beefier)\b/.test(text)) {
    for (const a of thin) scale[a] *= inc;
  }
  if (/\b(thinner|slimmer|skinnier)\b/.test(text)) {
    for (const a of thin) scale[a] *= dec;
  }
  if (/\btaller\b/.test(text)) scale[1] *= inc;
  if (/\bshorter\b/.test(text)) scale[1] *= dec;
  if (/\bwider\b/.test(text)) scale[0] *= inc;
  if (/\bnarrower\b/.test(text)) scale[0] *= dec;
  if (/\b(longer|deeper)\b/.test(text)) scale[2] *= inc;
  if (/\b(bigger|larger)\b/.test(text)) {
    scale[0] *= inc;
    scale[1] *= inc;
    scale[2] *= inc;
  }
  if (/\bsmaller\b/.test(text)) {
    scale[0] *= dec;
    scale[1] *= dec;
    scale[2] *= dec;
  }

  const material = findMaterial(text);
  let color = material ?? part.color;
  if (/\bdarker\b/.test(text)) color = tint(color, -intensity);
  if (/\blighter\b/.test(text)) color = tint(color, intensity);

  return { color, scale };
}
