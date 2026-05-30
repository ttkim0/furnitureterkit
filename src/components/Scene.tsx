import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Bounds } from "@react-three/drei";
import * as THREE from "three";
import { ModelView } from "./Model";
import { MeshView, type MeshStatus } from "./MeshView";
import { CameraExporter, type CameraInfo } from "./CameraExporter";
import { Room3D } from "./Room3D";
import { RoomLayout3D } from "./RoomLayout3D";
import { SplatViewer } from "./SplatViewer";
import type { Model } from "../lib/model";
import type { Quality } from "../lib/settings";
import type { ColorScheme, MaterialSettings } from "./MaterialControls";
import type { MaterialOverride } from "../lib/materials";
import type { RoomScene } from "../lib/roomScene";

export type ViewMode = "parts" | "mesh";

interface SceneProps {
  model: Model;
  selected: string | null;
  onSelect: (id: string | null) => void;
  quality: Quality;
  viewMode: ViewMode;
  cameraRef: React.MutableRefObject<CameraInfo | null>;
  orbitEnabled: boolean;
  material: MaterialSettings;
  colorScheme: ColorScheme;
  materialOverride?: MaterialOverride;
  dimensionalScale?: [number, number, number] | null;
  // When set, the room photo becomes the canvas background and the WebGL
  // canvas renders transparent on top — same pixel-perfect mesh, real-room
  // context. No AI redraw.
  roomBackground?: string | null;
  // 3D room scene (procedural geometry) rendered alongside the user's mesh.
  // Takes priority over roomBackground when set — they're mutually exclusive.
  roomScene?: RoomScene | null;
  // World-space offset (in meters) for the user's mesh inside a 3D room.
  // Driven by the on-canvas controller pad so the user can place the piece
  // anywhere on the floor without needing to drag camera-pan.
  meshOffset?: [number, number, number];
  // Rotation around the Y axis (radians) — lets the user turn the piece to
  // face different directions in the room.
  meshRotationY?: number;
  onMeshStatus?: (
    status: MeshStatus,
    message?: string,
    polygonCount?: number
  ) => void;
  onMeshBbox?: (bboxMm: { width_mm: number; height_mm: number; depth_mm: number }) => void;
}

export function Scene({
  model,
  selected,
  onSelect,
  quality,
  viewMode,
  cameraRef,
  orbitEnabled,
  material,
  colorScheme,
  materialOverride,
  dimensionalScale,
  roomBackground,
  roomScene,
  meshOffset,
  meshRotationY,
  onMeshStatus,
  onMeshBbox,
}: SceneProps) {
  const is3DRoom = roomScene?.kind === "room3d";
  const isScannedRoom = roomScene?.kind === "scanned";
  const isSplatRoom = roomScene?.kind === "splat";
  const isPhotoRoom =
    !!roomBackground && !is3DRoom && !isScannedRoom && !isSplatRoom;
  const inRoomMode = is3DRoom || isPhotoRoom || isScannedRoom || isSplatRoom;
  // 3D-style rooms (procedural / AI / scanned / splat) all want camera-
  // inside behavior — full orbit, no wheel-resize hijack, shadows on.
  const isImmersiveRoom = is3DRoom || isScannedRoom || isSplatRoom;
  const partsLighting = (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 5]} intensity={1} castShadow />
    </>
  );
  // Key the Canvas on room mode so it remounts and re-applies the camera
  // prop when the user transitions between empty-grid / photo-backdrop /
  // 3D-room. Without this, the camera position from initial mount sticks
  // and OrbitControls keeps the old target — so a fresh 3D room looks like
  // we're inside a wall.
  const canvasKey = is3DRoom
    ? `3d-${roomScene?.kind === "room3d" ? roomScene.id : ""}`
    : isSplatRoom
      ? `splat-${roomScene?.kind === "splat" ? roomScene.splatUrl : ""}`
      : isScannedRoom
        ? "scanned"
        : isPhotoRoom
          ? "photo"
          : "normal";
  // Camera distance scales with room width so a 5m living room and an 18m
  // grand lobby both frame nicely. Matches the TARGET_WIDTHS_M table in
  // Room3D.tsx (kept in sync manually — small enough table that it's fine).
  // Camera positions: inside each room but ELEVATED so the user gets a
  // bird's-eye view of the whole space rather than a chest-height eye
  // line that only sees the near third. Y values sit just below ceiling
  // height, Z is pulled back past the near wall so the entire floorplan
  // is in frame. The OrbitControls target stays at sofa-height so tilting
  // works naturally — drag-down looks at the sofa, drag-up looks at the
  // ceiling.
  const ROOM_CAMERA_POSITIONS: Record<string, [number, number, number]> = {
    "home-3d": [0, 2.4, 4.0],          // 5 m × 4.7 m living room
    "office-3d": [0, 3.5, 7.5],        // 12 m office bay
    "restaurant-3d": [0, 4.0, 8.5],    // 14 m dining room
    "hospitality-3d": [0, 5.0, 10.0],  // 18 m grand lobby
  };
  // Scanned rooms have variable footprints — start at a generic elevated
  // position. The user can orbit/zoom to frame it after load.
  const SCANNED_ROOM_CAM_POS: [number, number, number] = [0, 3.0, 6.0];
  const room3dCamPos: [number, number, number] = isScannedRoom
    ? SCANNED_ROOM_CAM_POS
    : (roomScene?.kind === "room3d" &&
        ROOM_CAMERA_POSITIONS[roomScene.id]) ||
      [6, 3.5, 8];
  // Use the broader "is3DRoom OR scanned" flag wherever camera-inside
  // behavior matters
  const useImmersiveCamera = isImmersiveRoom;
  return (
    <Canvas
      key={canvasKey}
      camera={
        useImmersiveCamera
          ? { position: room3dCamPos, fov: 70 }
          : { position: [4, 3, 5], fov: 45 }
      }
      shadows={useImmersiveCamera}
      onPointerMissed={() => onSelect(null)}
      // preserveDrawingBuffer so we can capture the rendered mesh as a PNG
      // for the lasso → OpenAI image-edit → Hunyuan refine flow.
      // alpha so the photo-mode CSS background shows through; in 3D-room
      // mode the room itself fills the canvas so alpha doesn't matter.
      gl={{ preserveDrawingBuffer: true, alpha: true }}
      style={
        isPhotoRoom && roomBackground
          ? {
              background: `url(${roomBackground}) center / cover no-repeat`,
            }
          : undefined
      }
    >
      <CameraExporter exportRef={cameraRef} />
      {viewMode === "parts" && !is3DRoom && partsLighting}
      {viewMode === "mesh" && isPhotoRoom && (
        <>
          {/* Lighting tuned for a real-room composite — softer than the
              empty-grid view so the mesh blends with photo lighting */}
          <ambientLight intensity={0.55} />
          <directionalLight position={[3, 5, 2]} intensity={0.9} />
          <directionalLight position={[-2, 2, -1]} intensity={0.25} />
        </>
      )}

      {/* 3D room: build the room around the mesh. The mesh sits on the
          floor at the world origin, offset horizontally by the controller
          pad. OrbitControls let the user rotate/zoom/pan the whole scene
          naturally — no CSS background, no flat composite. */}
      {is3DRoom && roomScene?.kind === "room3d" && (
        <Room3D scene={roomScene.id} aiMeshUrl={roomScene.aiMeshUrl} />
      )}
      {isScannedRoom && roomScene?.kind === "scanned" && (
        <RoomLayout3D
          layout={roomScene.layout}
          theme={roomScene.theme}
          textures={roomScene.textures}
        />
      )}
      {isSplatRoom && roomScene?.kind === "splat" && (
        <SplatViewer splatUrl={roomScene.splatUrl} />
      )}

      {/* Bounds: `fit` runs ONCE at mount to center the camera on the mesh.
          We deliberately do NOT pass `observe`, which would refit on every
          mesh/scale change — that was making the Size slider snap-back AND
          undoing the user's rotate/pan as soon as they let go (because any
          re-render kicked off a refit). With `fit` only, the camera settles
          on the mesh first time and then OrbitControls owns it. */}
      {inRoomMode ? (
        <group
          position={meshOffset ?? [0, 0, 0]}
          rotation={[0, meshRotationY ?? 0, 0]}
        >
          {viewMode === "parts" ? (
            <ModelView
              model={model}
              selected={selected}
              onSelect={(id) => onSelect(id)}
              quality={quality}
            />
          ) : (
            <MeshView
              model={model}
              quality={quality}
              material={material}
              colorScheme={colorScheme}
              materialOverride={materialOverride}
              dimensionalScale={dimensionalScale}
              onStatus={onMeshStatus}
              onMeshBbox={onMeshBbox}
            />
          )}
        </group>
      ) : (
        <Bounds fit clip margin={1.4}>
          {viewMode === "parts" ? (
            <ModelView
              model={model}
              selected={selected}
              onSelect={(id) => onSelect(id)}
              quality={quality}
            />
          ) : (
            <MeshView
              model={model}
              quality={quality}
              material={material}
              colorScheme={colorScheme}
              materialOverride={materialOverride}
              dimensionalScale={dimensionalScale}
              onStatus={onMeshStatus}
              onMeshBbox={onMeshBbox}
            />
          )}
        </Bounds>
      )}
      {!inRoomMode && (
        <Grid
          args={[20, 20]}
          cellColor="#444"
          sectionColor="#666"
          position={[0, 0, 0]}
          infiniteGrid
          fadeDistance={20}
        />
      )}
      {/* Room modes (both photo + 3D): full orbit. LEFT rotates the camera
          around the scene, RIGHT pans, wheel zoom is enabled in 3D mode so
          the user can dolly in/out of the room. */}
      {inRoomMode ? (
        <OrbitControls
          makeDefault
          enabled={orbitEnabled}
          enableRotate={true}
          // Wheel = camera dolly in immersive (3D / scanned) rooms.
          // In photo mode wheel is hijacked to resize the spec.
          enableZoom={useImmersiveCamera}
          enablePan={true}
          screenSpacePanning={!useImmersiveCamera}
          minDistance={0.5}
          maxDistance={30}
          maxPolarAngle={useImmersiveCamera ? Math.PI * 0.95 : Math.PI}
          target={useImmersiveCamera ? [0, 0.5, 0] : undefined}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />
      ) : (
        <OrbitControls
          makeDefault
          enabled={orbitEnabled}
          enableRotate={true}
          enableZoom={true}
          enablePan={true}
          screenSpacePanning={true}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />
      )}
    </Canvas>
  );
}


