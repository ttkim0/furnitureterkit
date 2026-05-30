// Load a GLB (binary glTF) URL and return the GLTF scene + a merged geometry.
//
// We keep the raw scene around so the user-visible mesh preserves Hunyuan's
// PBR materials (baseColor, normal, metallicRoughness maps if PBR was
// enabled at generation time). The merged geometry is also computed so the
// STL exporter can produce a single-solid file.

import { Box3, BufferGeometry, Group, Mesh, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface GLBLoadResult {
  scene: Group;
  triangleCount: number;
  bbox: Box3;
}

export async function loadGLB(url: string): Promise<GLBLoadResult> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene as Group;

  let triangleCount = 0;
  scene.traverse((obj: Object3D) => {
    if ((obj as Mesh).isMesh) {
      const m = obj as Mesh;
      const g = m.geometry as BufferGeometry;
      const idx = g.getIndex();
      const count = (idx?.count ?? g.getAttribute("position")?.count ?? 0) / 3;
      triangleCount += count;
    }
  });

  // Ground + center: shift the GLB so its bbox bottom rests on y=0 and is
  // centered on (x=0, z=0). Hunyuan returns meshes with arbitrary origins;
  // grounding here makes the mesh sit correctly on the floor in 3D room
  // mode (and is harmless for empty-grid mode since Bounds.fit re-centers
  // the camera around it anyway).
  const preBbox = new Box3().setFromObject(scene);
  const min = preBbox.min;
  const max = preBbox.max;
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  scene.position.set(-cx, -min.y, -cz);
  scene.updateMatrixWorld(true);

  // Recompute bbox after grounding so the caller sees the final extents
  const bbox = new Box3().setFromObject(scene);
  // sanity: bbox.getSize is the same as before, just bbox.min.y == 0 now
  const _ = new Vector3();
  bbox.getSize(_);
  return { scene, triangleCount: Math.round(triangleCount), bbox };
}

// For STL export — collect every mesh's geometry, bake its world-matrix into
// vertex positions, strip non-position attributes, and union into one
// BufferGeometry.
export function sceneToMergedGeometry(scene: Group): BufferGeometry {
  const geometries: BufferGeometry[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((obj: Object3D) => {
    if ((obj as Mesh).isMesh) {
      const mesh = obj as Mesh;
      const g = (mesh.geometry as BufferGeometry).clone();
      g.applyMatrix4(mesh.matrixWorld);
      const stripped = new BufferGeometry();
      const pos = g.getAttribute("position");
      if (pos) stripped.setAttribute("position", pos);
      const idx = g.getIndex();
      if (idx) stripped.setIndex(idx);
      geometries.push(stripped);
      g.dispose();
    }
  });
  if (geometries.length === 0) {
    throw new Error("scene contained no meshes");
  }
  const merged =
    geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
  if (!merged) throw new Error("scene merge failed");
  if (geometries.length > 1) geometries.forEach((g) => g.dispose());
  merged.computeVertexNormals();
  return merged;
}
