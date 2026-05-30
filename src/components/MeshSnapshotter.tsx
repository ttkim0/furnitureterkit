// Mesh → PNG snapshot for the auto-photo / video pipeline.
//
// The auto-photo + auto-video pipelines need an INPUT IMAGE to compose
// lifestyle scenes around. Previously we passed the Hunyuan source image
// (the gpt-image-1-generated white-bg photo that PRODUCED the mesh) —
// but that's an AI image of an AI-imagined piece, so the outputs felt
// "AI-generated." By rendering the ACTUAL GLB mesh and using that PNG as
// the input, the outputs depict the EXACT 3D geometry the user is buying.
//
// The component mounts a tiny hidden R3F canvas (1024×1024), loads the
// GLB with studio lighting, waits for a stable render, snapshots the
// canvas via `gl.domElement.toDataURL('image/png')`, then calls the
// onSnapshot callback with the data URL.
//
// We render meshes ONE AT A TIME from a queue to avoid WebGL context
// limits (browsers cap concurrent contexts at ~8–16).

import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bounds, Environment, useBounds, useGLTF } from "@react-three/drei";

interface MeshSnapshotterProps {
  meshUrl: string;
  size?: number;
  onSnapshot: (dataUrl: string) => void;
  onError?: (msg: string) => void;
}

/** Hidden offscreen 1024×1024 canvas. Renders the GLB once, snapshots,
 *  calls back. Component then unmounts. */
export function MeshSnapshotter({
  meshUrl,
  size = 1024,
  onSnapshot,
  onError,
}: MeshSnapshotterProps) {
  return (
    <div
      style={{
        position: "fixed",
        left: -99999,
        top: -99999,
        width: size,
        height: size,
        pointerEvents: "none",
        opacity: 0,
      }}
      aria-hidden="true"
    >
      <Canvas
        gl={{
          preserveDrawingBuffer: true, // required so toDataURL() works
          alpha: false,
          antialias: true,
        }}
        camera={{ position: [3.5, 2.4, 3.5], fov: 32 }}
        style={{ width: size, height: size, background: "#f4ede1" }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          // Off-white warm studio background — gives gpt-image-1.edit() a
          // clean canvas with predictable color reference.
          gl.setClearColor(0xf4ede1, 1);
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[6, 9, 4]} intensity={1.4} castShadow />
        <directionalLight position={[-5, 4, -3]} intensity={0.7} />
        <directionalLight position={[0, 2, -6]} intensity={0.45} />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.15}>
            <SnapshotMesh
              url={meshUrl}
              onReady={onSnapshot}
              onError={onError}
            />
          </Bounds>
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  );
}

function SnapshotMesh({
  url,
  onReady,
  onError,
}: {
  url: string;
  onReady: (dataUrl: string) => void;
  onError?: (msg: string) => void;
}) {
  const { gl, scene, camera } = useThree();
  const bounds = useBounds();
  const fired = useRef(false);
  const errorFired = useRef(false);

  let gltf: { scene: import("three").Object3D } | null = null;
  try {
    gltf = useGLTF(url) as unknown as { scene: import("three").Object3D };
  } catch (e) {
    if (!errorFired.current && onError) {
      errorFired.current = true;
      onError(e instanceof Error ? e.message : String(e));
    }
    return null;
  }

  // Once the GLB is loaded:
  //   1. Fit Bounds to the mesh
  //   2. Wait 1.5s for materials + textures + camera positioning to settle
  //   3. Force a render
  //   4. Snapshot via toDataURL
  //
  // Hard timeout at 8s — if snapshot hasn't fired by then, we report empty.
  useEffect(() => {
    if (!gltf?.scene || fired.current) return;
    bounds.refresh(gltf.scene).fit();
    const snapshotTimer = setTimeout(() => {
      if (fired.current) return;
      fired.current = true;
      try {
        gl.render(scene, camera);
        const dataUrl = gl.domElement.toDataURL("image/png");
        // toDataURL on an empty/black canvas returns a very short string.
        // A real 1024x1024 PNG is typically 100KB+ → base64 ~130KB+.
        if (!dataUrl || dataUrl === "data:," || dataUrl.length < 10_000) {
          if (onError) onError(`snapshot too small (${dataUrl?.length ?? 0} chars) — mesh may not have rendered`);
          return;
        }
        onReady(dataUrl);
      } catch (e) {
        if (onError) onError(e instanceof Error ? e.message : String(e));
      }
    }, 1500);
    const failsafeTimer = setTimeout(() => {
      if (fired.current) return;
      fired.current = true;
      if (onError) onError("snapshot timed out at 8s");
    }, 8000);
    return () => {
      clearTimeout(snapshotTimer);
      clearTimeout(failsafeTimer);
    };
  }, [gltf?.scene, bounds, gl, scene, camera, onReady, onError]);

  // Drive the render loop so the canvas actually paints (R3F is normally
  // demand-driven and won't render frames on a hidden offscreen canvas).
  useFrame(() => {});

  return <primitive object={gltf.scene} />;
}
