// Gaussian Splatting viewer for user-scanned rooms.
//
// Loads a .splat file (output by the Nerfstudio Splatfacto sidecar) into
// the active Three.js scene via @mkkellogg/gaussian-splats-3d (MIT). The
// splat renders as a photoreal radiance field — actual photos of the
// user's room reconstructed in 3D, navigable from any angle.
//
// Architecture note: the @mkkellogg viewer manages its own renderer +
// scene by default, but we use the `selfDrivenMode: false` flag so it
// drops its splat mesh into OUR R3F scene instead of opening a separate
// canvas. That keeps the user's furniture (rendered in the same scene
// by MeshView) coexisting with the splat in the same render loop.

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
// @ts-expect-error — no published types
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";

interface Props {
  splatUrl: string;
}

export function SplatViewer({ splatUrl }: Props) {
  const { scene, camera, gl } = useThree();
  const viewerRef = useRef<unknown>(null);

  useEffect(() => {
    if (!splatUrl) return;
    // Construct a viewer that doesn't drive its own renderer; we'll let
    // it inject into our scene/camera/renderer.
    const viewer = new (GaussianSplats3D as { Viewer: new (opts: object) => unknown }).Viewer({
      selfDrivenMode: false,
      useBuiltInControls: false,
      renderer: gl,
      threeScene: scene,
      camera,
      sharedMemoryForWorkers: false, // safer in iframe-y dev environments
    });
    viewerRef.current = viewer;
    let cancelled = false;
    (viewer as { addSplatScene: (url: string, opts: object) => Promise<void> })
      .addSplatScene(splatUrl, {
        showLoadingUI: false,
        splatAlphaRemovalThreshold: 5,
        // Splatfacto outputs at world scale ~1m; tweak if our coord
        // system disagrees. Centered at origin.
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      })
      .catch((e: unknown) => {
        if (!cancelled) console.error("[SplatViewer] addSplatScene failed:", e);
      });
    return () => {
      cancelled = true;
      try {
        (viewer as { dispose?: () => void }).dispose?.();
      } catch {
        // viewer may not have dispose in all versions; best-effort cleanup
      }
      viewerRef.current = null;
    };
  }, [splatUrl, scene, camera, gl]);

  // The viewer modifies the scene directly. We don't render anything
  // ourselves through React.
  return null;
}

// Suppress an unused-import warning when THREE isn't directly used —
// keeping the import explicit clarifies the integration intent.
void THREE;
void useMemo;
