// Geometry assembly + STL export.
//
// Two paths:
//   - downloadSTL: prefers OpenSCAD-WASM (real CAD with per-part colors and
//     watertight CSG via the manifold backend); falls back to a simple
//     BufferGeometryUtils merge if OpenSCAD compile fails.
//   - buildMergedGeometry: the simple merge, kept around as the fallback
//     path used by MeshView when OpenSCAD errors.

import * as THREE from "three";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Matrix4,
  SphereGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import type { Model, ModelPart, Shape } from "./model";
import { QUALITY_SEGMENTS, type Quality } from "./settings";
import { compileSCAD } from "./openscad";
import { modelToScad } from "./scadGenerator";
import { loadGLB, sceneToMergedGeometry } from "./glb";

function unitGeometry(shape: Shape, segments: number) {
  switch (shape) {
    case "box":
      return new BoxGeometry(1, 1, 1);
    case "cylinder":
      return new CylinderGeometry(0.5, 0.5, 1, segments);
    case "sphere":
      return new SphereGeometry(0.5, segments, Math.max(8, segments / 2));
    case "cone":
      return new ConeGeometry(0.5, 1, segments);
  }
}

function partTransform(part: ModelPart): Matrix4 {
  const scale: [number, number, number] = [
    part.size[0] * part.scale[0],
    part.size[1] * part.scale[1],
    part.size[2] * part.scale[2],
  ];
  const adjPos: [number, number, number] = [
    part.position[0] + (part.anchor[0] * part.size[0] * (1 - part.scale[0])) / 2,
    part.position[1] + (part.anchor[1] * part.size[1] * (1 - part.scale[1])) / 2,
    part.position[2] + (part.anchor[2] * part.size[2] * (1 - part.scale[2])) / 2,
  ];
  return new Matrix4()
    .makeScale(scale[0], scale[1], scale[2])
    .premultiply(new Matrix4().makeTranslation(adjPos[0], adjPos[1], adjPos[2]));
}

export function buildMergedGeometry(model: Model, quality: Quality) {
  const segments = QUALITY_SEGMENTS[quality];
  const transformed = model.parts.map((p) => {
    const g = unitGeometry(p.shape, segments);
    g.applyMatrix4(partTransform(p));
    return g;
  });
  const merged = mergeGeometries(transformed, false);
  transformed.forEach((g) => g.dispose());
  if (!merged) throw new Error("mergeGeometries returned null");
  return merged;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFilename(model: Model, quality: Quality, kind: string) {
  const safePrompt = (model.prompt || "model")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${safePrompt || "model"}-${quality}-${kind}.stl`;
}

export async function downloadSTL(model: Model, quality: Quality) {
  // Path A0: AI-generated mesh (Hunyuan3D / Fal). Convert the GLB scene into
  // a merged geometry, export as ASCII STL.
  if (model.mode === "mesh-url" && model.meshUrl) {
    try {
      const { scene } = await loadGLB(model.meshUrl);
      const geometry = sceneToMergedGeometry(scene);
      const mesh = new THREE.Mesh(geometry);
      const exporter = new STLExporter();
      const stl = exporter.parse(mesh, { binary: false });
      geometry.dispose();
      const blob = new Blob([stl as string], { type: "model/stl" });
      downloadBlob(blob, safeFilename(model, quality, "hunyuan"));
      return;
    } catch (e) {
      console.warn("[ariadne] GLB STL export failed:", e);
      throw e;
    }
  }
  // Path A: real OpenSCAD-WASM binary STL. Watertight per top-level union and
  // the canonical export path most slicers expect.
  try {
    const scad = modelToScad(model, quality);
    const { stl } = await compileSCAD(scad, "stl");
    const blob = new Blob([stl as BlobPart], { type: "model/stl" });
    downloadBlob(blob, safeFilename(model, quality, "openscad"));
    return;
  } catch (e) {
    console.warn("[ariadne] OpenSCAD STL failed, falling back to merge:", e);
  }
  // Path B: ASCII STL from a simple BufferGeometry merge. Not watertight
  // for overlapping parts — last-resort path so the user still gets a file.
  const geometry = buildMergedGeometry(model, quality);
  const mesh = new THREE.Mesh(geometry);
  const exporter = new STLExporter();
  const stl = exporter.parse(mesh, { binary: false });
  geometry.dispose();
  const blob = new Blob([stl as string], { type: "model/stl" });
  downloadBlob(blob, safeFilename(model, quality, "merged-fallback"));
}
