// Map spec material names → MaterialOverride (preset + color) so picking
// "Brass" in the spec dropdown auto-tints the mesh to a brass look.
//
// This is best-effort — the LLM may suggest material names we don't know.
// Unknown names fall back to the current preset and just update the spec
// text without touching the visual.

import type { MaterialOverride, MaterialPreset } from "./materials";

export interface MaterialMapping {
  preset: MaterialPreset;
  color: string;
}

// Lowercase substring → mapping. First match wins, so order matters
// (specific before general).
const MAP: ReadonlyArray<[string, MaterialMapping]> = [
  // Wood — specific species first
  ["dark walnut", { preset: "wood", color: "#3d2615" }],
  ["walnut", { preset: "wood", color: "#5a3a22" }],
  ["oak", { preset: "wood", color: "#c9a574" }],
  ["maple", { preset: "wood", color: "#e1c17a" }],
  ["birch", { preset: "wood", color: "#d8b87b" }],
  ["pine", { preset: "wood", color: "#d4ac6e" }],
  ["teak", { preset: "wood", color: "#8b5a2b" }],
  ["mahogany", { preset: "wood", color: "#4a1f15" }],
  ["plywood", { preset: "wood", color: "#c9a574" }],
  ["mdf", { preset: "wood", color: "#a87b4f" }],
  ["wood", { preset: "wood", color: "#a87b4f" }],

  // Metal
  ["brushed brass", { preset: "metal", color: "#b89855" }],
  ["polished brass", { preset: "metal", color: "#d4af37" }],
  ["brass", { preset: "metal", color: "#c9a967" }],
  ["antique bronze", { preset: "metal", color: "#5e4023" }],
  ["bronze", { preset: "metal", color: "#7a5a3a" }],
  ["polished chrome", { preset: "metal", color: "#e8e8e8" }],
  ["chrome", { preset: "metal", color: "#d0d0d8" }],
  ["brushed nickel", { preset: "metal", color: "#a8a8a8" }],
  ["nickel", { preset: "metal", color: "#b8b8b8" }],
  ["stainless steel", { preset: "metal", color: "#a0a0a8" }],
  ["steel", { preset: "metal", color: "#8a8a92" }],
  ["aluminum", { preset: "metal", color: "#c0c0c8" }],
  ["iron", { preset: "metal", color: "#3a3a3a" }],
  ["matte black", { preset: "metal", color: "#1a1a1a" }],
  ["metal", { preset: "metal", color: "#a0a0a8" }],

  // Stone
  ["black marble", { preset: "marble", color: "#1a1a1a" }],
  ["white marble", { preset: "marble", color: "#e8e6e0" }],
  ["marble", { preset: "marble", color: "#e8e6e0" }],
  ["granite", { preset: "marble", color: "#888888" }],

  // Upholstery / fabric
  ["leather", { preset: "leather", color: "#6b4423" }],
  ["faux leather", { preset: "leather", color: "#5a3a1d" }],
  ["velvet", { preset: "fabric", color: "#5a3a6e" }],
  ["linen", { preset: "fabric", color: "#d8d0c4" }],
  ["cotton", { preset: "fabric", color: "#e8e0d4" }],
  ["polyester knit", { preset: "fabric", color: "#cdd97a" }],
  ["polyester", { preset: "fabric", color: "#cdd97a" }],
  ["boucle", { preset: "fabric", color: "#e0d8c8" }],
  ["wool", { preset: "fabric", color: "#a89888" }],
  ["fabric", { preset: "fabric", color: "#cdd97a" }],

  // Other
  ["glass", { preset: "plastic", color: "#c8e0e8" }],
  ["plastic", { preset: "plastic", color: "#3a3a3a" }],
  ["resin", { preset: "plastic", color: "#888888" }],
  ["fiberglass", { preset: "plastic", color: "#a8a8a8" }],
  ["foam", { preset: "fabric", color: "#cdcdcd" }],
];

export function mapMaterialName(name: string | undefined | null): MaterialMapping | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [key, mapping] of MAP) {
    if (lower.includes(key)) return mapping;
  }
  return null;
}

// Apply a material name to a MaterialOverride. Returns the next override.
// If the name is unknown, returns prev unchanged.
export function applyMaterialName(
  prev: MaterialOverride,
  name: string
): MaterialOverride {
  const mapped = mapMaterialName(name);
  if (!mapped) return prev;
  return { ...prev, preset: mapped.preset, color: mapped.color };
}

// Material option lists for spec dropdowns (per category of material slot).
export const MATERIAL_OPTIONS = {
  wood: [
    "Oak",
    "Walnut",
    "Dark walnut",
    "Maple",
    "Birch",
    "Pine",
    "Teak",
    "Mahogany",
    "Plywood",
    "MDF",
  ],
  metal: [
    "Brushed brass",
    "Polished brass",
    "Antique bronze",
    "Polished chrome",
    "Brushed nickel",
    "Stainless steel",
    "Steel",
    "Aluminum",
    "Iron",
    "Matte black",
  ],
  upholstery: [
    "Velvet",
    "Linen",
    "Cotton",
    "Polyester knit",
    "Boucle",
    "Wool",
    "Leather",
    "Faux leather",
  ],
  fill: [
    "HD foam",
    "Memory foam",
    "Down",
    "Polyester fiber",
    "Spring + foam",
  ],
  finish: [
    "Matte lacquer",
    "Satin lacquer",
    "Gloss lacquer",
    "Oil",
    "Wax",
    "Stained",
    "Painted",
    "Natural",
  ],
  hardware: [
    "Brushed brass",
    "Polished brass",
    "Brushed nickel",
    "Polished chrome",
    "Matte black",
    "Antique bronze",
    "Iron",
  ],
  stone: ["White marble", "Black marble", "Granite", "Quartz"],
} as const;
