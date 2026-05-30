// Renders a scanned room layout (output of SpatialLM, parsed into JSON
// by the Python sidecar) as actual 3D geometry inside the Three.js
// canvas. Each Wall becomes a box mesh, each Door becomes a cutout
// frame, each Window becomes an emissive plane, each Bbox is a wireframe
// hint for any pre-existing furniture the scan picked up.
//
// SpatialLM's coordinate convention: z-up, walls Manhattan-aligned, all
// positions in meters. Our scene uses y-up, so we swap (y ↔ z, negate
// when needed) at the geometry level rather than rotating the whole
// group — that way the user's furniture (which is already y-up because
// glb.ts grounds it) sits flat on the floor without a manual rotation.

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Environment } from "@react-three/drei";
import type { RoomTheme, ScannedRoomLayout } from "../lib/api";
import type { RoomTextures } from "../lib/textureExtractor";

interface Props {
  layout: ScannedRoomLayout;
  // Optional theme: when present (free-tier Claude-scan), the renderer
  // colors the floor/walls/ceiling to match the user's actual room.
  // Falls back to the warm-oak default if absent (premium SLAM3R path).
  theme?: RoomTheme;
  // Optional photo textures sampled from the user's video frames in the
  // browser. When present, these get applied as PBR baseColor maps with
  // mirrored tiling — walls and floor look like the user's actual room.
  textures?: RoomTextures;
}

// Load a Three.js texture from a data: URL, configured for mirrored-
// repeat tiling with sRGB color space. Returns null until loaded.
function useTexture(dataUrl: string | undefined) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!dataUrl) {
      setTex(null);
      return;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      dataUrl,
      (t) => {
        if (cancelled) {
          t.dispose();
          return;
        }
        t.wrapS = THREE.MirroredRepeatWrapping;
        t.wrapT = THREE.MirroredRepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        setTex(t);
      },
      undefined,
      () => setTex(null)
    );
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);
  return tex;
}

// SpatialLM walls are line segments (a → b) with a height and thickness.
// We render each as an extruded box centered on the midpoint.
function WallMesh({
  ax, ay, az, bx, by, bz, height, thickness, color, texture,
}: ScannedRoomLayout["walls"][number] & {
  color: string;
  texture: THREE.Texture | null;
}) {
  const { position, rotation, scale, length } = useMemo(() => {
    // Swap z-up → y-up at point coordinates
    const a = new THREE.Vector3(ax, az, -ay); // x stays, y=az (height), z=-ay
    const b = new THREE.Vector3(bx, bz, -by);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    // The wall lies on the floor — center it vertically at height/2
    mid.y = height / 2;
    const length = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    // Rotation around Y so the wall's long axis aligns with (a→b)
    const rotY = Math.atan2(dir.x, dir.z);
    return {
      position: mid.toArray() as [number, number, number],
      rotation: [0, rotY, 0] as [number, number, number],
      scale: [thickness, height, length] as [number, number, number],
      length,
    };
  }, [ax, ay, az, bx, by, bz, height, thickness]);

  // Each wall needs its OWN texture clone so the repeat counts don't
  // collide between walls of different lengths. We clone-on-mount and
  // dispose on unmount.
  const wallTex = useMemo(() => {
    if (!texture) return null;
    const cloned = texture.clone();
    cloned.needsUpdate = true;
    // Tile the wall texture so ~2 m per tile feels natural at human scale
    cloned.repeat.set(length / 2, height / 2);
    return cloned;
  }, [texture, length, height]);
  useEffect(() => () => wallTex?.dispose(), [wallTex]);

  return (
    <mesh position={position} rotation={rotation} scale={scale} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        map={wallTex}
        color={wallTex ? "#ffffff" : color}
        roughness={0.85}
      />
    </mesh>
  );
}

// SpatialLM bbox = oriented bounding box of detected existing furniture
// (sofas, tables, etc.). We render as a wireframe outline so the user
// can see what their scan picked up without it occluding their own piece.
function BboxOutline({
  position_x, position_y, position_z,
  angle_z, scale_x, scale_y, scale_z,
  class: className,
}: ScannedRoomLayout["bboxes"][number]) {
  const colour = useMemo(() => {
    // Simple class → colour map for legibility
    const map: Record<string, string> = {
      sofa: "#ff9d6a", chair: "#ff9d6a", bed: "#ff9d6a",
      table: "#6acdff", desk: "#6acdff",
      cabinet: "#d24a8a", shelf: "#d24a8a",
    };
    return map[className.toLowerCase()] ?? "#9aa0a6";
  }, [className]);
  // SpatialLM: angle_z = rotation around vertical axis (z in their frame)
  // Our frame: rotation around Y. swap z↔y at position too.
  const position: [number, number, number] = [
    position_x,
    position_z + scale_z / 2, // sit the bbox on the floor by lifting half its height
    -position_y,
  ];
  const rotation: [number, number, number] = [0, -angle_z, 0];
  // Scale: SpatialLM's scale_x/y/z = full dimensions in each axis (their
  // x/y are horizontal, z is vertical). Swap y↔z for our frame.
  const scale: [number, number, number] = [scale_x, scale_z, scale_y];
  return (
    <group position={position} rotation={rotation}>
      <mesh scale={scale}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={colour} wireframe />
      </mesh>
    </group>
  );
}

export function RoomLayout3D({ layout, theme, textures }: Props) {
  // Theme-derived material colors, with warm-oak defaults for scans that
  // don't have a theme (the SLAM3R sidecar path doesn't emit one).
  const floorColor = theme?.floorColor || "#e7d6bf";
  const wallColor = theme?.wallColor || "#f3eee4";
  const ceilingColor = theme?.ceilingColor || "#fbf8f1";
  const floorTexture = useTexture(textures?.floorTextureUrl);
  const wallTexture = useTexture(textures?.wallTextureUrl);
  const ceilingTexture = useTexture(textures?.ceilingTextureUrl);
  // Compute room extent from walls so we can drop in a generous floor /
  // ceiling that always covers the whole scan, even if SpatialLM missed
  // some perimeter walls.
  const extent = useMemo(() => {
    if (layout.walls.length === 0) {
      return { minX: -5, maxX: 5, minZ: -5, maxZ: 5, ceiling: 2.7 };
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, ceiling = 0;
    for (const w of layout.walls) {
      minX = Math.min(minX, w.ax, w.bx);
      maxX = Math.max(maxX, w.ax, w.bx);
      // z-up → -y in our frame
      minZ = Math.min(minZ, -w.ay, -w.by);
      maxZ = Math.max(maxZ, -w.ay, -w.by);
      ceiling = Math.max(ceiling, w.height);
    }
    // Pad a bit so the floor extends past the wall thickness
    return {
      minX: minX - 0.5, maxX: maxX + 0.5,
      minZ: minZ - 0.5, maxZ: maxZ + 0.5,
      ceiling: ceiling || 2.7,
    };
  }, [layout]);

  const floorWidth = extent.maxX - extent.minX;
  const floorDepth = extent.maxZ - extent.minZ;
  const floorCenter: [number, number, number] = [
    (extent.minX + extent.maxX) / 2,
    0,
    (extent.minZ + extent.maxZ) / 2,
  ];

  // Per-surface texture clones with proper repeat counts so floor / ceiling
  // tile naturally across their planes. Each surface gets its own clone
  // because the repeat() setting is per-Texture.
  const floorMap = useMemo(() => {
    if (!floorTexture) return null;
    const t = floorTexture.clone();
    t.needsUpdate = true;
    t.repeat.set(floorWidth / 2, floorDepth / 2);
    return t;
  }, [floorTexture, floorWidth, floorDepth]);
  useEffect(() => () => floorMap?.dispose(), [floorMap]);

  const ceilingMap = useMemo(() => {
    if (!ceilingTexture) return null;
    const t = ceilingTexture.clone();
    t.needsUpdate = true;
    t.repeat.set(floorWidth / 2, floorDepth / 2);
    return t;
  }, [ceilingTexture, floorWidth, floorDepth]);
  useEffect(() => () => ceilingMap?.dispose(), [ceilingMap]);

  return (
    <group>
      {/* IBL (image-based lighting) — drei's "apartment" preset gives
          warm interior-style reflections that make PBR materials read as
          photoreal. Cheap, no extra HDR file. */}
      <Environment preset="apartment" />

      {/* Direct lights for shadows + key/fill modeling. Ambient kept low
          because Environment already handles diffuse fill. */}
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[3, 5, 2]}
        intensity={0.6}
        color="#fff2dc"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-2, 4, -2]} intensity={0.2} color="#d8e6ff" />
      <pointLight position={[0, 2.5, 0]} intensity={0.3} color="#fff2dc" distance={12} decay={1.5} />

      {/* Floor — photo texture if we have one, otherwise solid color */}
      <mesh
        position={floorCenter}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[floorWidth, floorDepth]} />
        <meshStandardMaterial
          map={floorMap}
          color={floorMap ? "#ffffff" : floorColor}
          roughness={0.65}
        />
      </mesh>

      {/* Ceiling — DoubleSide so it shows from inside the room */}
      <mesh
        position={[floorCenter[0], extent.ceiling, floorCenter[2]]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[floorWidth, floorDepth]} />
        <meshStandardMaterial
          map={ceilingMap}
          color={ceilingMap ? "#ffffff" : ceilingColor}
          roughness={1}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Walls — themed color + photo texture when available */}
      {layout.walls.map((w) => (
        <WallMesh key={w.id} {...w} color={wallColor} texture={wallTexture} />
      ))}

      {/* Doors — emissive cutouts on the wall plane. We don't actually
          subtract from the wall (CSG is expensive); a glowing rectangle
          reads clearly as "door here" against the warm wall colour. */}
      {layout.doors.map((d) => (
        <mesh
          key={d.id}
          position={[d.position_x, d.position_z + d.height / 2, -d.position_y]}
        >
          <planeGeometry args={[d.width, d.height]} />
          <meshStandardMaterial
            color="#3a2a1c"
            emissive="#1a0f08"
            emissiveIntensity={0.2}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Windows — bright emissive panels so they read as daylight openings */}
      {layout.windows.map((w) => (
        <mesh
          key={w.id}
          position={[w.position_x, w.position_z + w.height / 2, -w.position_y]}
        >
          <planeGeometry args={[w.width, w.height]} />
          <meshStandardMaterial
            color="#fff5e0"
            emissive="#fff5e0"
            emissiveIntensity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Existing-furniture bbox hints (wireframe) */}
      {layout.bboxes.map((b) => (
        <BboxOutline key={b.id} {...b} />
      ))}
    </group>
  );
}
