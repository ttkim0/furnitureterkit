import { useEffect, useState } from "react";
import type { BufferGeometry, Group, Material, Mesh, Object3D } from "three";
import { compileSCAD } from "../lib/openscad";
import { modelToScad } from "../lib/scadGenerator";
import { parseOFFToBufferGeometry } from "../lib/offParser";
import { buildMergedGeometry } from "../lib/mesh";
import { loadGLB } from "../lib/glb";
import { applyMaterialOverride, type MaterialOverride } from "../lib/materials";
import type { Model } from "../lib/model";
import type { Quality } from "../lib/settings";
import type { ColorScheme, MaterialSettings } from "./MaterialControls";

export type MeshStatus =
  | "loading"
  | "ready-openscad"
  | "ready-merged"
  | "ready-photoreal"
  | "error";

interface MeshViewProps {
  model: Model;
  quality: Quality;
  material: MaterialSettings;
  colorScheme: ColorScheme;
  materialOverride?: MaterialOverride;
  dimensionalScale?: [number, number, number] | null;
  onStatus?: (status: MeshStatus, message?: string, polygonCount?: number) => void;
  onSceneLoaded?: (scene: Group) => void;
  onMeshBbox?: (bboxMm: { width_mm: number; height_mm: number; depth_mm: number }) => void;
}

// Real OpenSCAD-rendered mesh path. For SCAD-mode models, compiles the raw
// SCAD source directly. For mesh-url models (Hunyuan3D / Fal output), loads
// the GLB scene and preserves its PBR materials. For parts-mode models,
// builds SCAD from the part list first and then compiles.
export function MeshView({
  model,
  quality,
  material,
  colorScheme,
  materialOverride,
  dimensionalScale,
  onStatus,
  onSceneLoaded,
  onMeshBbox,
}: MeshViewProps) {
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [hasVertexColors, setHasVertexColors] = useState(false);
  const [glbScene, setGlbScene] = useState<Group | null>(null);

  // Re-apply material override whenever it changes (without re-fetching the GLB).
  useEffect(() => {
    if (glbScene && materialOverride) {
      applyMaterialOverride(glbScene, materialOverride);
    }
  }, [glbScene, materialOverride]);

  // Live-resize the GLB scene when the user edits the spec's overall
  // dimensions. dimensionalScale is computed in App as
  //   (spec.overall / originalBbox)
  // so {1,1,1} = no change, > 1 = bigger than original, < 1 = smaller.
  useEffect(() => {
    if (glbScene && dimensionalScale) {
      glbScene.scale.set(
        dimensionalScale[0],
        dimensionalScale[1],
        dimensionalScale[2]
      );
    } else if (glbScene) {
      glbScene.scale.set(1, 1, 1);
    }
  }, [glbScene, dimensionalScale]);

  useEffect(() => {
    let cancelled = false;
    onStatus?.("loading");

    (async () => {
      // Fast path: AI-generated GLB from Fal/Hunyuan3D.
      if (model.mode === "mesh-url" && model.meshUrl) {
        try {
          const { scene, triangleCount, bbox } = await loadGLB(model.meshUrl);
          if (cancelled) return;
          // Apply current material override on first load
          if (materialOverride) applyMaterialOverride(scene, materialOverride);
          setGlbScene(scene);
          setGeometry(null);
          setHasVertexColors(false);
          onSceneLoaded?.(scene);
          // Hunyuan returns mesh in meters; convert to mm for spec sheets.
          const size = bbox.getSize(new (await import("three")).Vector3());
          onMeshBbox?.({
            width_mm: size.x * 1000,
            height_mm: size.y * 1000,
            depth_mm: size.z * 1000,
          });
          onStatus?.("ready-photoreal", "AI mesh", triangleCount);
        } catch (e) {
          if (!cancelled)
            onStatus?.("error", e instanceof Error ? e.message : String(e));
        }
        return;
      }

      try {
        const scad =
          model.mode === "scad" && model.scad
            ? model.scad
            : modelToScad(model, quality);
        const { off, durationMs, stdErr } = await compileSCAD(scad, "preview");
        if (cancelled) return;
        if (!off) {
          throw new Error(
            `OpenSCAD did not produce OFF output. stderr: ${stdErr.slice(-3).join(" | ")}`
          );
        }
        const geom = parseOFFToBufferGeometry(off);
        const colored = !!geom.getAttribute("color");
        if (cancelled) {
          geom.dispose();
          return;
        }
        const triCount = (geom.getAttribute("position")?.count ?? 0) / 3;
        setGlbScene(null);
        setGeometry((prev) => {
          prev?.dispose();
          return geom;
        });
        setHasVertexColors(colored);
        onStatus?.(
          "ready-openscad",
          `${(durationMs / 1000).toFixed(2)}s`,
          Math.round(triCount)
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[ariadne] OpenSCAD compile failed:", message);
        if (model.mode === "scad") {
          if (!cancelled) onStatus?.("error", message);
          return;
        }
        try {
          const geom = buildMergedGeometry(model, quality);
          if (cancelled) {
            geom.dispose();
            return;
          }
          const triCount = (geom.getAttribute("position")?.count ?? 0) / 3;
          setGlbScene(null);
          setGeometry((prev) => {
            prev?.dispose();
            return geom;
          });
          setHasVertexColors(false);
          onStatus?.("ready-merged", message, Math.round(triCount));
        } catch (e2) {
          if (!cancelled)
            onStatus?.("error", e2 instanceof Error ? e2.message : String(e2));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // We intentionally exclude materialOverride from deps — it's applied via
    // the separate useEffect above without reloading the geometry/scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, quality, onStatus]);

  // Material/color controls
  const useColors = colorScheme === "textured" && hasVertexColors;
  const baseColor = colorScheme === "textured" ? "#ffffff" : "#bcbcbc";
  const wireframe = colorScheme === "wireframe";
  const brightness = material.brightness / 50;
  const roughness = material.roughness / 100;
  const intensity = brightness;

  // GLB scene path: render the gltf scene directly, preserves PBR materials
  // and any material overrides applied via applyMaterialOverride.
  if (glbScene) {
    const setWireframe = (on: boolean) => {
      glbScene.traverse((o: Object3D) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const mat = m.material as Material | Material[];
        if (Array.isArray(mat)) {
          mat.forEach((x) => {
            (x as Material & { wireframe?: boolean }).wireframe = on;
          });
        } else if (mat) {
          (mat as Material & { wireframe?: boolean }).wireframe = on;
        }
      });
    };
    setWireframe(wireframe);
    return (
      <>
        <ambientLight intensity={0.4 * intensity} />
        <directionalLight position={[5, 8, 5]} intensity={1.0 * intensity} />
        <primitive object={glbScene} />
      </>
    );
  }

  if (!geometry) return null;

  return (
    <>
      <ambientLight intensity={0.4 * intensity} />
      <directionalLight position={[5, 8, 5]} intensity={1.0 * intensity} />
      <mesh geometry={geometry}>
        <meshStandardMaterial
          vertexColors={useColors}
          color={baseColor}
          roughness={roughness}
          flatShading={false}
          wireframe={wireframe}
        />
      </mesh>
    </>
  );
}
