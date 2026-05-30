// Real CSG kernel via manifold-3d (Apache-2.0). Replaces the simple
// mergeGeometries path with proper boolean union → watertight solid mesh.
//
// CADAM uses OpenSCAD-WASM for the same job; we use Manifold because (a) it's
// permissively licensed, (b) the WASM blob is ~600KB instead of 8MB, (c) we
// don't need SCAD's source-language ecosystem since our model is already a
// structured part list. Functionally equivalent for primitive-CSG.

import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { BufferAttribute, BufferGeometry } from "three";
import type { Model, ModelPart, Shape } from "./model";
import { QUALITY_SEGMENTS, type Quality } from "./settings";

type ManifoldToplevel = Awaited<ReturnType<typeof Module>>;

let _manifold: ManifoldToplevel | null = null;
let _initPromise: Promise<ManifoldToplevel> | null = null;

export function isManifoldReady(): boolean {
  return _manifold !== null;
}

export async function initManifold(): Promise<ManifoldToplevel> {
  if (_manifold) return _manifold;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const wasm = await Module({ locateFile: () => wasmUrl });
    wasm.setup();
    _manifold = wasm;
    return wasm;
  })();
  return _initPromise;
}

function unitManifold(M: ManifoldToplevel, shape: Shape, segments: number) {
  const { Manifold } = M;
  switch (shape) {
    case "box":
      return Manifold.cube([1, 1, 1], true);
    case "cylinder":
      return Manifold.cylinder(1, 0.5, 0.5, segments, true);
    case "sphere":
      return Manifold.sphere(0.5, segments);
    case "cone":
      return Manifold.cylinder(1, 0.5, 0, segments, true);
  }
}

function partManifold(M: ManifoldToplevel, part: ModelPart, segments: number) {
  const u = unitManifold(M, part.shape, segments);
  const sx = part.size[0] * part.scale[0];
  const sy = part.size[1] * part.scale[1];
  const sz = part.size[2] * part.scale[2];
  const tx =
    part.position[0] + (part.anchor[0] * part.size[0] * (1 - part.scale[0])) / 2;
  const ty =
    part.position[1] + (part.anchor[1] * part.size[1] * (1 - part.scale[1])) / 2;
  const tz =
    part.position[2] + (part.anchor[2] * part.size[2] * (1 - part.scale[2])) / 2;
  return u.scale([sx, sy, sz]).translate([tx, ty, tz]);
}

export async function buildManifoldGeometry(
  model: Model,
  quality: Quality
): Promise<BufferGeometry> {
  const M = await initManifold();
  const segments = QUALITY_SEGMENTS[quality];

  if (model.parts.length === 0) {
    throw new Error("model has no parts");
  }

  const partMs = model.parts
    .map((p) => {
      try {
        return partManifold(M, p, segments);
      } catch (e) {
        console.warn(`[ariadne] skipping degenerate part ${p.id}:`, e);
        return null;
      }
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  if (partMs.length === 0) {
    throw new Error("all parts were degenerate");
  }

  const united =
    partMs.length === 1 ? partMs[0] : M.Manifold.union(partMs);
  // Dispose intermediates if union returned a new manifold
  if (partMs.length > 1) {
    for (const p of partMs) p.delete();
  }

  const mesh = united.getMesh();
  united.delete();

  const geometry = new BufferGeometry();
  let positions: Float32Array;
  if (mesh.numProp === 3) {
    positions = new Float32Array(mesh.vertProperties);
  } else {
    const numVerts = mesh.vertProperties.length / mesh.numProp;
    positions = new Float32Array(numVerts * 3);
    for (let i = 0; i < numVerts; i++) {
      positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
      positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
      positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
    }
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  geometry.computeVertexNormals();
  return geometry;
}
