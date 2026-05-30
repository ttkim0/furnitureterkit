// Procedural 3D rooms for "See it in a room". One scene per category,
// built from R3F primitives so they're symmetrical and have real meter-scale
// dimensions — the user's furniture (also in meters) sits ON the floor at
// the world origin and OrbitControls give natural rotate/zoom/pan around
// the whole room.
//
// We deliberately don't try to look photoreal — these are clean, well-lit
// volumes that show scale, give context, and let the user judge how the
// real piece would feel in a similar-sized room. Each room is symmetrical,
// wide, and has a clear empty zone in the middle for the user's mesh.

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { loadGLB } from "../lib/glb";

export type Room3DId =
  | "home-3d"
  | "office-3d"
  | "restaurant-3d"
  | "hospitality-3d";

interface Room3DInfo {
  id: Room3DId;
  label: string;
  category: "home" | "office" | "restaurant" | "hospitality" | "education";
  description: string;
}

export const ROOM_3D_SCENES: Room3DInfo[] = [
  {
    id: "home-3d",
    label: "Bright empty white room",
    category: "home",
    description: "Sunlit white-walled room with oak floors — 8 × 6 m",
  },
  {
    id: "office-3d",
    label: "Sunlit private office",
    category: "office",
    description: "Wide open office with rows of desks and pendants — 14 × 10 m",
  },
  {
    id: "restaurant-3d",
    label: "Modern dining room",
    category: "restaurant",
    description: "Symmetrical dining room with round tables — 14 × 10 m",
  },
  {
    id: "hospitality-3d",
    label: "Grand lobby",
    category: "hospitality",
    description: "Large marble-floor lobby with columns — 16 × 12 m",
  },
];

// Single-source palettes per category. Soft, light, neutral so the user's
// piece reads cleanly against the walls.
interface Palette {
  floor: string;
  floorRoughness: number;
  wallBack: string;
  wallSide: string;
  ceiling: string;
  prop: string; // primary prop color (desks, tables, etc.)
  propAccent: string;
  ambient: number;
  warmKey: number;
  coolFill: number;
}

const PALETTES: Record<Room3DId, Palette> = {
  "home-3d": {
    floor: "#e7d6bf",
    floorRoughness: 0.5,
    wallBack: "#f5f1ea",
    wallSide: "#efeae0",
    ceiling: "#fbf8f1",
    prop: "#dcd2bf",
    propAccent: "#a78a6a",
    ambient: 0.65,
    warmKey: 1.2,
    coolFill: 0.3,
  },
  "office-3d": {
    floor: "#c8cdd2",
    floorRoughness: 0.7,
    wallBack: "#f0eee9",
    wallSide: "#e8e4dc",
    ceiling: "#fafaf6",
    prop: "#2a2a30",
    propAccent: "#c4a374",
    ambient: 0.7,
    warmKey: 1.1,
    coolFill: 0.5,
  },
  "restaurant-3d": {
    floor: "#6a4a32",
    floorRoughness: 0.45,
    wallBack: "#2c2620",
    wallSide: "#3a322a",
    ceiling: "#1f1b16",
    prop: "#3a2c20",
    propAccent: "#c9a86a",
    ambient: 0.35,
    warmKey: 1.4,
    coolFill: 0.15,
  },
  "hospitality-3d": {
    floor: "#e6e1d6",
    floorRoughness: 0.25,
    wallBack: "#efeae0",
    wallSide: "#e8e2d4",
    ceiling: "#fbf8f1",
    prop: "#3c342c",
    propAccent: "#c9a86a",
    ambient: 0.75,
    warmKey: 1.1,
    coolFill: 0.4,
  },
};

// Shared structural pieces — floor, walls, ceiling, lighting. The user's
// mesh always sits at the origin on the floor; rooms are built around it.
function RoomShell({
  width,
  depth,
  height,
  palette,
}: {
  width: number;
  depth: number;
  height: number;
  palette: Palette;
}) {
  return (
    <group>
      {/* Floor — receive shadows so the mesh's contact reads */}
      <mesh receiveShadow position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial
          color={palette.floor}
          roughness={palette.floorRoughness}
        />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, height / 2, -depth / 2]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={palette.wallBack} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>

      {/* Left wall */}
      <mesh position={[-width / 2, height / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={palette.wallSide} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>

      {/* Right wall */}
      <mesh position={[width / 2, height / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={palette.wallSide} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>

      {/* Ceiling (subtle, doesn't block top-down lighting) */}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={palette.ceiling} roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {/* Lighting — warm key, cool fill, ambient */}
      <ambientLight intensity={palette.ambient} />
      <directionalLight
        position={[width * 0.4, height * 1.5, depth * 0.4]}
        intensity={palette.warmKey}
        color="#fff2dc"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-width / 2}
        shadow-camera-right={width / 2}
        shadow-camera-top={depth / 2}
        shadow-camera-bottom={-depth / 2}
        shadow-camera-near={0.1}
        shadow-camera-far={50}
      />
      <directionalLight
        position={[-width * 0.4, height, -depth * 0.4]}
        intensity={palette.coolFill}
        color="#d8e6ff"
      />
    </group>
  );
}

// Bright empty room — just shell, no props, big windows-via-light. Perfect
// for showing a single piece of furniture against clean white walls.
function HomeRoom() {
  const palette = PALETTES["home-3d"];
  const W = 8, D = 6, H = 3.2;
  return (
    <group>
      <RoomShell width={W} depth={D} height={H} palette={palette} />
      {/* Skirting board */}
      <mesh position={[0, 0.06, -D / 2 + 0.01]}>
        <boxGeometry args={[W, 0.12, 0.02]} />
        <meshStandardMaterial color={palette.propAccent} roughness={0.7} />
      </mesh>
      {/* Faux window light strip on back wall — bright rectangle suggesting daylight */}
      <mesh position={[0, H * 0.65, -D / 2 + 0.01]}>
        <planeGeometry args={[W * 0.55, H * 0.45]} />
        <meshStandardMaterial
          color="#fffaf0"
          emissive="#fff5e0"
          emissiveIntensity={0.45}
          roughness={1}
        />
      </mesh>
    </group>
  );
}

// Open office with two symmetrical rows of desks down the long sides,
// leaving a generous central aisle for the user's piece.
function OfficeRoom() {
  const palette = PALETTES["office-3d"];
  const W = 14, D = 10, H = 3.4;

  // Desk + chair pair (a desk is 1.4 × 0.7 × 0.74 m, chair behind it)
  const desks = useMemo(() => {
    const rows: Array<{ x: number; z: number; flip: boolean }> = [];
    const count = 4;
    const spacing = D / (count + 1);
    for (let i = 0; i < count; i++) {
      const z = -D / 2 + spacing * (i + 1);
      rows.push({ x: -W / 2 + 1.5, z, flip: false });
      rows.push({ x: W / 2 - 1.5, z, flip: true });
    }
    return rows;
  }, []);

  return (
    <group>
      <RoomShell width={W} depth={D} height={H} palette={palette} />
      {/* Faux window strip on back wall */}
      <mesh position={[0, H * 0.65, -D / 2 + 0.01]}>
        <planeGeometry args={[W * 0.7, H * 0.4]} />
        <meshStandardMaterial color="#fffaf0" emissive="#fff5e0" emissiveIntensity={0.4} roughness={1} />
      </mesh>
      {desks.map((d, i) => (
        <group key={i} position={[d.x, 0, d.z]} rotation={[0, d.flip ? Math.PI / 2 : -Math.PI / 2, 0]}>
          {/* Desk top */}
          <mesh position={[0, 0.74, 0]} castShadow>
            <boxGeometry args={[1.4, 0.04, 0.7]} />
            <meshStandardMaterial color={palette.propAccent} roughness={0.6} />
          </mesh>
          {/* Desk legs */}
          {[[-0.65, -0.3], [0.65, -0.3], [-0.65, 0.3], [0.65, 0.3]].map(([x, z], j) => (
            <mesh key={j} position={[x, 0.36, z]}>
              <boxGeometry args={[0.04, 0.72, 0.04]} />
              <meshStandardMaterial color={palette.prop} roughness={0.7} />
            </mesh>
          ))}
          {/* Office chair (simplified box) */}
          <mesh position={[0, 0.45, -0.55]} castShadow>
            <boxGeometry args={[0.55, 0.08, 0.5]} />
            <meshStandardMaterial color={palette.prop} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.75, -0.78]} castShadow>
            <boxGeometry args={[0.55, 0.6, 0.06]} />
            <meshStandardMaterial color={palette.prop} roughness={0.7} />
          </mesh>
        </group>
      ))}
      {/* Pendant lights overhead — small emissive boxes */}
      {[-W / 3, 0, W / 3].map((x, i) => (
        <mesh key={i} position={[x, H - 0.5, 0]}>
          <boxGeometry args={[0.4, 0.05, 0.4]} />
          <meshStandardMaterial color="#fffaf0" emissive="#fffaf0" emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

// Modern dining room — symmetrical grid of round dining tables with
// pendant lights, leaving the front-center clear for the user's chair.
function RestaurantRoom() {
  const palette = PALETTES["restaurant-3d"];
  const W = 14, D = 10, H = 3.6;

  // 2 × 3 grid of round dining tables along the sides
  const tables = useMemo(() => {
    const out: Array<{ x: number; z: number }> = [];
    const cols = 2; // left + right of center
    const rows = 3;
    const xs = [-W / 2 + 2.6, W / 2 - 2.6];
    for (let r = 0; r < rows; r++) {
      const z = -D / 2 + (D / (rows + 1)) * (r + 1);
      for (let c = 0; c < cols; c++) {
        out.push({ x: xs[c], z });
      }
    }
    return out;
  }, []);

  return (
    <group>
      <RoomShell width={W} depth={D} height={H} palette={palette} />
      {/* Bar / serving counter along back wall */}
      <mesh position={[0, 0.55, -D / 2 + 0.6]} castShadow>
        <boxGeometry args={[W * 0.5, 1.1, 0.55]} />
        <meshStandardMaterial color={palette.propAccent} roughness={0.4} metalness={0.1} />
      </mesh>
      {tables.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]}>
          {/* Round table top */}
          <mesh position={[0, 0.74, 0]} castShadow>
            <cylinderGeometry args={[0.7, 0.7, 0.05, 32]} />
            <meshStandardMaterial color={palette.prop} roughness={0.3} metalness={0.1} />
          </mesh>
          {/* Pedestal */}
          <mesh position={[0, 0.37, 0]}>
            <cylinderGeometry args={[0.1, 0.18, 0.74, 16]} />
            <meshStandardMaterial color="#1a1612" roughness={0.6} />
          </mesh>
          {/* Pendant light directly overhead */}
          <mesh position={[0, H - 1.2, 0]}>
            <coneGeometry args={[0.18, 0.25, 16, 1, true]} />
            <meshStandardMaterial color={palette.propAccent} roughness={0.4} metalness={0.5} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, H - 1.32, 0]}>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshStandardMaterial color="#fff8d8" emissive="#fff5c0" emissiveIntensity={1.2} />
          </mesh>
          <pointLight position={[0, H - 1.32, 0]} intensity={0.6} color="#fff0c0" distance={4} decay={2} />
        </group>
      ))}
    </group>
  );
}

// Grand lobby — large open space with two columns flanking the center,
// reception counter at the back, marble-feel floor. Lots of clear floor.
function HospitalityRoom() {
  const palette = PALETTES["hospitality-3d"];
  const W = 16, D = 12, H = 5;
  return (
    <group>
      <RoomShell width={W} depth={D} height={H} palette={palette} />
      {/* Reception counter at back */}
      <mesh position={[0, 0.55, -D / 2 + 0.8]} castShadow>
        <boxGeometry args={[6, 1.1, 0.8]} />
        <meshStandardMaterial color={palette.prop} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.15, -D / 2 + 0.8]} castShadow>
        <boxGeometry args={[6.3, 0.05, 0.95]} />
        <meshStandardMaterial color={palette.propAccent} roughness={0.3} metalness={0.2} />
      </mesh>
      {/* Two columns flanking the central area */}
      {[-W / 4, W / 4].map((x, i) => (
        <mesh key={i} position={[x, H / 2, 0]} castShadow>
          <cylinderGeometry args={[0.35, 0.35, H, 24]} />
          <meshStandardMaterial color={palette.ceiling} roughness={0.6} />
        </mesh>
      ))}
      {/* Big atrium-style ceiling light */}
      <mesh position={[0, H - 0.1, 0]}>
        <planeGeometry args={[W * 0.4, D * 0.3]} />
        <meshStandardMaterial color="#fffaf0" emissive="#fff5e0" emissiveIntensity={0.5} />
      </mesh>
      <pointLight position={[0, H - 0.5, 0]} intensity={0.8} color="#fff2dc" distance={20} decay={1.5} />
    </group>
  );
}

// AI-generated 3D room: load a GLB from the URL the backend produced via
// gpt-image-1 → Hunyuan3D, ground it on the floor at y=0, and auto-scale
// it so its widest dim ≈ 10 m (Hunyuan returns meshes in arbitrary scale).
// While the GLB streams in we fall back to the procedural room so the user
// doesn't see a blank canvas.
function AIGeneratedRoom({
  meshUrl,
  fallbackScene,
}: {
  meshUrl: string;
  fallbackScene: Room3DId;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScene(null);
    setError(null);
    loadGLB(meshUrl)
      .then(({ scene: loaded, bbox }) => {
        if (cancelled) return;
        // Hunyuan returns meshes at arbitrary scale. Normalize the room
        // to a REAL-WORLD target width based on which category this is —
        // a living room is ~5 m wide, a lobby is ~16 m wide, etc. — so a
        // 1.2 m sofa reads at the right human-scale fraction of the room.
        const TARGET_WIDTHS_M: Record<Room3DId, number> = {
          "home-3d": 5,         // small living room
          "office-3d": 12,      // open office bay
          "restaurant-3d": 14,  // mid-size restaurant
          "hospitality-3d": 18, // grand lobby
        };
        const targetWidth = TARGET_WIDTHS_M[fallbackScene] ?? 6;
        const size = bbox.getSize(new THREE.Vector3());
        const widest = Math.max(size.x, size.z);
        if (widest > 0) {
          const factor = targetWidth / widest;
          loaded.scale.setScalar(factor);
        }
        // Floor detection via RAY-CAST from above world center, straight
        // down. Hunyuan rooms include geometry BELOW the visible floor
        // (foundations, dollhouse undersides, shadow planes), so naively
        // grounding bbox.min.y to 0 left the actual floor floating above
        // y=0 → user's sofa (also at y=0) sank into the foundation.
        //
        // Raycasting from (0, big, 0) downward: the topmost surface the
        // ray hits at center is the floor (the dollhouse cutaway leaves
        // the center open above), or worst case the ceiling — in which
        // case the SECOND hit is the floor. Anything below either is
        // foundation/underside and gets shifted out of view.
        loaded.updateMatrixWorld(true);
        const postBbox = new THREE.Box3().setFromObject(loaded);
        const raycaster = new THREE.Raycaster();
        // Sample 5 ray positions across the room footprint and median the
        // results — protects against a single ray hitting a stray piece of
        // furniture/prop instead of the actual floor.
        const footprintR =
          Math.min(postBbox.max.x - postBbox.min.x, postBbox.max.z - postBbox.min.z) *
          0.2;
        const samplePoints: Array<[number, number]> = [
          [0, 0],
          [footprintR, footprintR],
          [-footprintR, footprintR],
          [footprintR, -footprintR],
          [-footprintR, -footprintR],
        ];
        const detectedFloorYs: number[] = [];
        const rayOrigin = new THREE.Vector3();
        const rayDown = new THREE.Vector3(0, -1, 0);
        for (const [x, z] of samplePoints) {
          rayOrigin.set(x, postBbox.max.y + 5, z);
          raycaster.set(rayOrigin, rayDown);
          const hits = raycaster.intersectObject(loaded, true);
          if (hits.length === 0) continue;
          // Filter out hits within 5cm of bbox.min.y (foundation/underside)
          // and within 30cm of bbox.max.y (ceiling).
          const usable = hits.filter(
            (h) =>
              h.point.y > postBbox.min.y + 0.05 &&
              h.point.y < postBbox.max.y - 0.3
          );
          if (usable.length > 0) {
            // The LOWEST usable hit is the floor. We filter out the
            // foundation/underside (within 5 cm of bbox.min.y) AND the
            // top portion (above bbox.max.y - 0.3) — but the office room
            // has a thin closed ceiling well below bbox.max.y, so we
            // can't just pick "first usable" (that'd be the ceiling). The
            // floor is always the lowest non-foundation hit.
            detectedFloorYs.push(usable[usable.length - 1].point.y);
          } else if (hits.length > 0) {
            // No "interior" hits — likely an open dollhouse, use last hit
            detectedFloorYs.push(hits[hits.length - 1].point.y);
          }
        }
        // Median for robustness against outliers
        let floorY = postBbox.min.y;
        if (detectedFloorYs.length > 0) {
          detectedFloorYs.sort((a, b) => a - b);
          floorY = detectedFloorYs[Math.floor(detectedFloorYs.length / 2)];
        }
        loaded.position.y -= floorY;
        loaded.updateMatrixWorld(true);
        const finalBbox = new THREE.Box3().setFromObject(loaded);
        const finalSize = finalBbox.getSize(new THREE.Vector3());
        console.log(
          `[Room3D ${fallbackScene}] floor detected at y=${floorY.toFixed(3)} ` +
            `(via ${detectedFloorYs.length} ray hits). ` +
            `Post-shift bbox: min y=${finalBbox.min.y.toFixed(2)}, max y=${finalBbox.max.y.toFixed(2)}, size: ${finalSize.x.toFixed(1)}×${finalSize.y.toFixed(1)}×${finalSize.z.toFixed(1)} m`
        );
        // Make room walls cast/receive shadows for the user's piece
        loaded.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = obj as THREE.Mesh;
            m.castShadow = false;
            m.receiveShadow = true;
            // Force materials to render both sides so a thin generated wall
            // doesn't disappear when the camera goes "through" it
            const mat = m.material as
              | THREE.Material
              | THREE.Material[]
              | undefined;
            if (Array.isArray(mat)) {
              mat.forEach((mm) => (mm.side = THREE.DoubleSide));
            } else if (mat) {
              mat.side = THREE.DoubleSide;
            }
          }
        });
        setScene(loaded);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : String(e))
      );
    return () => {
      cancelled = true;
    };
  }, [meshUrl, fallbackScene]);

  return (
    <group>
      {/* Interior-mode lighting: punchier ambient so enclosed-room views
          aren't muddy, plus a warm key + cool fill to give the walls
          dimension. The user is INSIDE the room so we can't rely on the
          sun lighting from outside the way an exterior shot would. */}
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 4, 2]} intensity={0.7} color="#fff2dc" />
      <directionalLight position={[-2, 3, -2]} intensity={0.35} color="#d8e6ff" />
      <pointLight position={[0, 2.5, 0]} intensity={0.4} color="#fff2dc" distance={10} decay={1.5} />
      {scene ? (
        <primitive object={scene} />
      ) : error ? (
        // Failed to load — fall back to procedural so something is on screen
        <Room3DProcedural scene={fallbackScene} />
      ) : (
        // Still loading — show procedural underneath so the canvas isn't blank
        <Room3DProcedural scene={fallbackScene} />
      )}
    </group>
  );
}

function Room3DProcedural({ scene }: { scene: Room3DId }) {
  switch (scene) {
    case "home-3d":
      return <HomeRoom />;
    case "office-3d":
      return <OfficeRoom />;
    case "restaurant-3d":
      return <RestaurantRoom />;
    case "hospitality-3d":
      return <HospitalityRoom />;
    default:
      return null;
  }
}

export function Room3D({
  scene,
  aiMeshUrl,
}: {
  scene: Room3DId;
  // If set, render the AI-generated GLB room. Falls back to the procedural
  // version for the same category while the GLB loads or if it fails.
  aiMeshUrl?: string | null;
}) {
  if (aiMeshUrl) {
    return <AIGeneratedRoom meshUrl={aiMeshUrl} fallbackScene={scene} />;
  }
  return <Room3DProcedural scene={scene} />;
}
