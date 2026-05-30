// Unified room-scene model. A room is either a flat photo (becomes the
// canvas CSS background) or a procedural 3D scene rendered alongside the
// user's mesh inside the same Three.js canvas. Photo mode keeps the old
// pixel-perfect-but-flat behavior; 3D mode gives real depth, parallax,
// and natural camera orbit around the room.

import type { Room3DId } from "../components/Room3D";
import type { RoomTheme, ScannedRoomLayout } from "./api";
import type { RoomTextures } from "./textureExtractor";

export type RoomScene =
  | { kind: "photo"; url: string }
  | {
      kind: "room3d";
      id: Room3DId;
      // If set, render an AI-generated GLB room mesh for this category.
      // Otherwise fall back to the procedural primitive version.
      aiMeshUrl?: string;
    }
  | {
      // User-scanned room. Two flavors share this path:
      //   1. SLAM3R + SpatialLM via the Python sidecar (premium video)
      //   2. Claude vision over photos/frames (free tier, procedural)
      // Both emit the same SpatialLM-shaped layout JSON. The free-tier
      // path also includes a `theme` (per-surface colors) and `textures`
      // (photo crops from the user's video used as PBR baseColor maps).
      kind: "scanned";
      layout: ScannedRoomLayout;
      theme?: RoomTheme;
      textures?: RoomTextures;
    }
  | {
      // Gaussian Splatting room reconstruction (Nerfstudio Splatfacto on
      // a GPU sidecar). The .splat file is loaded by SplatViewer into
      // the live Three.js scene as a radiance field — actual photoreal
      // 3D reconstruction of the user's room, navigable from any angle.
      kind: "splat";
      splatUrl: string;
    };
