// Convert a Model (list of primitive parts) into OpenSCAD source.
//
// Each part becomes:
//   color([r, g, b])
//   translate([px, py, pz])
//   scale([sx, sy, sz])
//     <unit primitive>
//
// We use unit primitives + scale so non-uniform sizes (squashed spheres,
// elliptical cylinders) work without per-shape special-casing. With
// --enable=lazy-union, top-level objects keep their individual colors in the
// OFF output so the preview can render per-part materials.

import type { Model, ModelPart, Shape } from "./model";
import { QUALITY_SEGMENTS, type Quality } from "./settings";

function hexToRgb01(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function fmt(n: number): string {
  // OpenSCAD parses standard decimal numbers; trim noisy floats.
  if (!isFinite(n)) return "0";
  return n.toFixed(6).replace(/\.?0+$/, "");
}

function unitPrimitive(shape: Shape, segments: number): string {
  switch (shape) {
    case "box":
      return "cube([1, 1, 1], center=true);";
    case "cylinder":
      return `cylinder(h=1, r=0.5, $fn=${segments}, center=true);`;
    case "sphere":
      return `sphere(d=1, $fn=${segments});`;
    case "cone":
      return `cylinder(h=1, r1=0.5, r2=0, $fn=${segments}, center=true);`;
  }
}

function partToScad(part: ModelPart, segments: number): string {
  const [r, g, b] = hexToRgb01(part.color);
  const sx = part.size[0] * part.scale[0];
  const sy = part.size[1] * part.scale[1];
  const sz = part.size[2] * part.scale[2];
  const tx =
    part.position[0] + (part.anchor[0] * part.size[0] * (1 - part.scale[0])) / 2;
  const ty =
    part.position[1] + (part.anchor[1] * part.size[1] * (1 - part.scale[1])) / 2;
  const tz =
    part.position[2] + (part.anchor[2] * part.size[2] * (1 - part.scale[2])) / 2;

  return `// ${part.id} (${part.label})
color([${fmt(r)}, ${fmt(g)}, ${fmt(b)}])
translate([${fmt(tx)}, ${fmt(ty)}, ${fmt(tz)}])
scale([${fmt(sx)}, ${fmt(sy)}, ${fmt(sz)}])
  ${unitPrimitive(part.shape, segments)}`;
}

export function modelToScad(model: Model, quality: Quality): string {
  const segments = QUALITY_SEGMENTS[quality];
  const header = `// Generated from Ariadne model ${model.id}
// Prompt: ${model.prompt.replace(/\n/g, " ").slice(0, 200)}
// Quality: ${quality} (${segments} segments)
// $fa/$fs are overridden per-primitive via $fn.

`;
  const body = model.parts.map((p) => partToScad(p, segments)).join("\n\n");
  return header + body + "\n";
}
