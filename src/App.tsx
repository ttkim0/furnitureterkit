import { useCallback, useEffect, useRef, useState } from "react";
import { Scene, type ViewMode } from "./components/Scene";
import type { MeshStatus } from "./components/MeshView";
import { EditPanel } from "./components/EditPanel";
import { EntryScreen } from "./components/EntryScreen";
import { SettingsBar } from "./components/SettingsBar";
import { LassoOverlay } from "./components/LassoOverlay";
import { LassoPopup } from "./components/LassoPopup";
import { MeshLassoPopup } from "./components/MeshLassoPopup";
import {
  captureMesh,
  captureMeshWithLasso,
  type LassoCapture,
} from "./lib/lassoCapture";
import { ChatPanel, type ChatMessage } from "./components/ChatPanel";
import { diffSpec } from "./lib/specDiff";
import { RoomViewModal } from "./components/RoomViewModal";
import { RoomController } from "./components/RoomController";
import type { RoomScene } from "./lib/roomScene";
import {
  MaterialControls,
  type ColorScheme,
  type MaterialSettings,
} from "./components/MaterialControls";
import { MaterialPicker } from "./components/MaterialPicker";
import { DEFAULT_MATERIAL, type MaterialOverride } from "./lib/materials";
import { applyMaterialName } from "./lib/materialMapping";
import { SpecPanel } from "./components/SpecPanel";
import type { FurnitureSpec } from "./lib/spec";
import { generateSpec as apiGenerateSpec } from "./lib/api";

import type { CameraInfo } from "./components/CameraExporter";
import type { EditCommand } from "./types";
import type { Model, ModelPart, QualityPreset } from "./lib/model";
import {
  generateModel,
  getHealth,
  getModel,
  postEdit,
  clearSessionOnServer,
  type HealthResponse,
  type ImageRef,
} from "./lib/api";
import { clearSessionId, getOrCreateSessionId } from "./lib/session";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";
import { downloadSTL } from "./lib/mesh";
import {
  partCenterWorld,
  pointInPolygon,
  polygonCentroid,
  projectToScreen,
  type Point2D,
} from "./lib/projection";

interface HistoryItem {
  cmd: EditCommand;
  source: string;
}

interface LassoSelection {
  parts: ModelPart[];
  position: Point2D;
}

export default function App() {
  const [sessionId] = useState(() => getOrCreateSessionId());
  const [model, setModel] = useState<Model | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [genSource, setGenSource] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [viewMode, setViewMode] = useState<ViewMode>("parts");
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // Lasso state
  const [lassoMode, setLassoMode] = useState(false);
  const [lassoSelection, setLassoSelection] = useState<LassoSelection | null>(null);
  const [lassoBusy, setLassoBusy] = useState(false);
  const [lassoProgress, setLassoProgress] = useState({ done: 0, total: 0 });
  // Mesh-mode lasso (image-edit + remesh refine flow)
  const [meshLasso, setMeshLasso] = useState<{
    capture: LassoCapture;
    position: { x: number; y: number };
  } | null>(null);
  const [meshLassoBusy, setMeshLassoBusy] = useState(false);
  const [meshLassoStart, setMeshLassoStart] = useState<number | null>(null);
  const [meshLassoElapsed, setMeshLassoElapsed] = useState(0);
  useEffect(() => {
    if (meshLassoStart === null) return;
    const i = setInterval(() => setMeshLassoElapsed(performance.now() - meshLassoStart), 200);
    return () => clearInterval(i);
  }, [meshLassoStart]);
  const cameraInfoRef = useRef<CameraInfo | null>(null);

  // Mesh-build state
  const [meshStatus, setMeshStatus] = useState<MeshStatus | null>(null);
  const [meshMessage, setMeshMessage] = useState<string | null>(null);
  const [polygonCount, setPolygonCount] = useState<number | null>(null);
  const [compileStart, setCompileStart] = useState<number | null>(null);
  const [compileElapsed, setCompileElapsed] = useState(0);
  // Stable handler so MeshView's useEffect doesn't re-fire on every render
  // (which would queue a new OpenSCAD compile on every compile-timer tick).
  const handleMeshStatus = useCallback(
    (status: MeshStatus, message?: string, polys?: number) => {
      setMeshStatus(status);
      setMeshMessage(message ?? null);
      if (polys !== undefined) setPolygonCount(polys);
      if (status === "loading") {
        setCompileStart(performance.now());
        setCompileElapsed(0);
      } else {
        setCompileStart(null);
      }
    },
    []
  );

  // Tick the compile timer while compiling
  useEffect(() => {
    if (compileStart === null) return;
    const interval = setInterval(() => {
      setCompileElapsed(performance.now() - compileStart);
    }, 100);
    return () => clearInterval(interval);
  }, [compileStart]);

  // Material/render settings (renderer-only, no recompile)
  const [material, setMaterial] = useState<MaterialSettings>({
    brightness: 50,
    roughness: 60,
  });
  const [colorScheme, setColorScheme] = useState<ColorScheme>("textured");
  const [materialOverride, setMaterialOverride] = useState<MaterialOverride>(
    DEFAULT_MATERIAL
  );

  // Spec sheet (manufacturer-ready dims + materials)
  // (declared early — referenced by wheel-resize handler below)
  const [spec, setSpec] = useState<FurnitureSpec | null>(null);
  const [specGenerating, setSpecGenerating] = useState(false);
  const [meshBboxMm, setMeshBboxMm] = useState<{
    width_mm: number;
    height_mm: number;
    depth_mm: number;
  } | null>(null);
  const specAutoFiredFor = useRef<string | null>(null);
  // Snapshot of the spec at the moment the current mesh was last built.
  // diffSpec(baseline, current) → list of changes that drives "Rebuild mesh"
  // so OpenAI gets a focused diff instead of a full re-description.
  const baselineSpecRef = useRef<FurnitureSpec | null>(null);

  // Chat (text-only refine, same backend pipe as the lasso)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatStart, setChatStart] = useState<number | null>(null);
  const [chatElapsed, setChatElapsed] = useState(0);
  useEffect(() => {
    if (chatStart === null) return;
    const i = setInterval(() => setChatElapsed(performance.now() - chatStart), 200);
    return () => clearInterval(i);
  }, [chatStart]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getModel(sessionId), getHealth().catch(() => null)])
      .then(([m, h]) => {
        if (cancelled) return;
        setModel(m);
        setHealth(h);
      })
      .catch((e) => {
        if (!cancelled) console.warn("[ariadne] bootstrap failed:", e);
      })
      .finally(() => {
        if (!cancelled) setBootstrapped(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const updateSettings = (next: Settings) => {
    setSettings(next);
    saveSettings(next);
  };

  const handleGenerate = async (
    prompt: string,
    image?: ImageRef,
    qualityPreset?: QualityPreset
  ) => {
    setError(null);
    setPolygonCount(null);
    setSpec(null);
    setMeshBboxMm(null);
    specAutoFiredFor.current = null;
    try {
      const { model: m, generator_source } = await generateModel(
        sessionId,
        prompt,
        image,
        health?.llm_available ? settings.generationModel : undefined,
        qualityPreset
      );
      setModel(m);
      setGenSource(generator_source);
      setHistory([]);
      setSelected(null);
      // Non-part-list modes (raw SCAD, AI photoreal mesh) skip the parts view.
      setViewMode(
        m.mode === "scad" || m.mode === "mesh-url" ? "mesh" : "parts"
      );
      setLassoMode(false);
      setLassoSelection(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  const handleEdit = async (cmd: EditCommand) => {
    console.log("[ariadne] → POST /api/edit", cmd);
    setError(null);
    setBusy(true);
    try {
      const { model: m, source } = await postEdit(
        sessionId,
        cmd.selected_part,
        cmd.edit,
        health?.llm_available ? settings.editModel : undefined
      );
      console.log("[ariadne] ← model updated", { source, modelId: m.id });
      setModel(m);
      setHistory((h) => [...h, { cmd, source }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleStartOver = async () => {
    setError(null);
    try {
      await clearSessionOnServer(sessionId);
    } catch {
      // best-effort
    }
    clearSessionId();
    setModel(null);
    setSelected(null);
    setHistory([]);
    location.reload();
  };

  const [rebuildingMesh, setRebuildingMesh] = useState(false);
  const handleRebuildMesh = useCallback(async () => {
    if (!model || !spec) return;
    setError(null);
    setRebuildingMesh(true);
    setPolygonCount(null);
    try {
      // 1. Capture the CURRENT mesh visual (not the original reference).
      const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) throw new Error("Canvas not found");
      const cap = await captureMesh(canvas);

      // 2. Build a focused DIFF prompt from baseline → current spec.
      const baseline = baselineSpecRef.current ?? spec;
      const changes = diffSpec(baseline, spec);
      const diffPrompt =
        changes.length > 0
          ? `Modify this furniture exactly as follows: ${changes.join("; ")}. Keep everything else (silhouette, color, materials, style) the same as the image.`
          : `Re-render this furniture in the same style.`;
      console.log("[ariadne] rebuild diff:", changes);

      // 3. Send current canvas + diff prompt through the standard pipeline:
      //    /api/generate with image + text + max preset
      //    → OpenAI image-edit → Hunyuan3D → new GLB
      const { generateModel } = await import("./lib/api");
      const { model: m, generator_source } = await generateModel(
        sessionId,
        diffPrompt,
        { mediaType: cap.mediaType, data: cap.data },
        health?.llm_available ? settings.generationModel : undefined,
        "max"
      );
      setModel(m);
      setGenSource(generator_source);
      // Update baseline to the spec we just rebuilt against; clear current
      // spec so the auto-fire grounds fresh dims in the new mesh's bbox.
      baselineSpecRef.current = spec;
      setSpec(null);
      specAutoFiredFor.current = null;
      setSelected(null);
    } catch (e) {
      setError(`Mesh rebuild failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRebuildingMesh(false);
    }
  }, [sessionId, model, spec, health, settings.generationModel]);

  // Snapshot baseline whenever a new spec lands (auto-gen or manual). The diff
  // for the next rebuild will be measured against this baseline.
  useEffect(() => {
    if (spec && (!baselineSpecRef.current || baselineSpecRef.current === spec)) {
      baselineSpecRef.current = spec;
    }
  }, [spec?.category]);

  // ─── Chat refine flow ────────────────────────────────────────────────
  const handleChatSend = useCallback(
    async (text: string) => {
      if (!model) return;
      const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) {
        setError("Canvas not found");
        return;
      }
      let cap;
      try {
        cap = await captureMesh(canvas);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      const userMsg: ChatMessage = {
        role: "user",
        text,
        thumbnail: cap.preview,
        ts: Date.now(),
      };
      setChatMessages((m) => [...m, userMsg]);
      setChatBusy(true);
      setChatStart(performance.now());
      setChatElapsed(0);
      setError(null);
      try {
        const { generateModel } = await import("./lib/api");
        const { model: m } = await generateModel(
          sessionId,
          text,
          { mediaType: cap.mediaType, data: cap.data },
          health?.llm_available ? settings.generationModel : undefined,
          "max"
        );
        setModel(m);
        setSpec(null);
        baselineSpecRef.current = null;
        specAutoFiredFor.current = null;
        setChatMessages((msgs) => [
          ...msgs,
          {
            role: "assistant",
            text: "Updated the design.",
            ts: Date.now(),
          },
        ]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Chat refine failed: ${msg}`);
        setChatMessages((msgs) => [
          ...msgs,
          { role: "error", text: msg, ts: Date.now() },
        ]);
      } finally {
        setChatBusy(false);
        setChatStart(null);
      }
    },
    [sessionId, model, health, settings.generationModel]
  );

  const handleChatClear = useCallback(() => setChatMessages([]), []);

  // ─── View in a Room flow ──────────────────────────────────────────
  // Two room kinds:
  //   - 3D procedural room (recommended): full Three.js scene built around
  //     the user's mesh — real depth, parallax, OrbitControls handles
  //     rotate/zoom/pan naturally. Position handled by `meshOffset`.
  //   - Photo backdrop: flat image as CSS background, mesh on transparent
  //     canvas on top. Kept for "upload your real room photo" + the AI
  //     composite flow.
  const [roomModal, setRoomModal] = useState<boolean>(false);
  const [roomScene, setRoomScene] = useState<RoomScene | null>(null);
  // World-space offset (meters) for the mesh inside a 3D room — driven by
  // the controller pad. Reset on room change.
  const [meshOffset, setMeshOffset] = useState<[number, number, number]>([0, 0, 0]);
  // Y-axis rotation (radians) for the mesh — lets the user turn the piece
  // to face left/right/back without rotating the camera. Reset on room change.
  const [meshRotationY, setMeshRotationY] = useState<number>(0);
  // Backwards-compat alias: roomBackground = the photo URL when in photo
  // mode. Lots of existing code (wheel handler, button labels, modal trigger)
  // keys off this; cheaper to derive than to refactor every callsite.
  const roomBackground =
    roomScene?.kind === "photo" ? roomScene.url : null;
  // Snapshot of the mesh at the moment "See it in a room" was clicked.
  // Used by the Upload tab's composite mode: gpt-image-1 places this exact
  // mesh image into the user's uploaded room photo per their instruction.
  const [meshSnapshotForRoom, setMeshSnapshotForRoom] = useState<string | null>(null);
  const handleOpenRoom = useCallback(async () => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (canvas) {
      try {
        const cap = await captureMesh(canvas);
        // `preview` is a data: URL (mesh on white background); RoomViewModal
        // strips the prefix back to base64 before sending to /api/place-in-room.
        setMeshSnapshotForRoom(cap.preview);
      } catch {
        setMeshSnapshotForRoom(null);
      }
    }
    setRoomModal(true);
  }, []);
  const handleClearRoom = useCallback(() => {
    setRoomScene(null);
    setMeshOffset([0, 0, 0]);
    setMeshRotationY(0);
  }, []);

  // When a room background is set, wheel-on-canvas resizes the mesh by
  // updating spec.overall (NOT camera zoom — OrbitControls.enableZoom is
  // false in room mode). The current spec/bbox live in refs so the handler
  // doesn't need to be re-registered on every spec edit.
  const wheelSpecRef = useRef<{
    spec: FurnitureSpec | null;
    bbox: { width_mm: number; height_mm: number; depth_mm: number } | null;
  }>({ spec: null, bbox: null });

  const handleGenerateSpec = useCallback(async () => {
    if (!model || !meshBboxMm) return;
    setSpecGenerating(true);
    setError(null);
    try {
      const { spec: s } = await apiGenerateSpec(
        sessionId,
        meshBboxMm,
        undefined,
        health?.llm_available ? settings.generationModel : undefined,
        // Pass model.prompt as fallback so dev-injected models (no backend
        // session record) still spec-generate.
        model.prompt
      );
      setSpec(s);
    } catch (e) {
      setError(`Spec generation failed: ${e instanceof Error ? e.message : String(e)}`);
      // Clear the auto-fire latch so a retry (manual or next mesh swap) can
      // try again instead of permanently blocking on this model id.
      specAutoFiredFor.current = null;
    } finally {
      setSpecGenerating(false);
    }
  }, [sessionId, model, meshBboxMm, health, settings.generationModel]);

  const handleDownloadSpec = () => {
    if (!spec || !model) return;
    const bundle = {
      generated_at: new Date().toISOString(),
      model_id: model.id,
      prompt: model.prompt,
      mesh_url: model.meshUrl,
      mesh_file_size: model.meshFileSize,
      bbox_mm: meshBboxMm,
      spec,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (model.prompt || "spec")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    a.href = url;
    a.download = `${safe || "spec"}-spec.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Receive bbox + auto-fire spec generation when a mesh-url model first loads
  // a GLB. Re-firing on the same model ID is suppressed via the ref.
  const handleMeshBbox = useCallback(
    (bboxMm: { width_mm: number; height_mm: number; depth_mm: number }) => {
      setMeshBboxMm(bboxMm);
    },
    []
  );

  useEffect(() => {
    if (
      model?.mode === "mesh-url" &&
      meshBboxMm &&
      !spec &&
      !specGenerating &&
      health?.llm_available &&
      specAutoFiredFor.current !== model.id
    ) {
      specAutoFiredFor.current = model.id;
      handleGenerateSpec();
    }
  }, [model, meshBboxMm, spec, specGenerating, health, handleGenerateSpec]);

  // ─── Spec ↔ visual binding ─────────────────────────────────────────────
  // Original bbox stays fixed so we can compute (current spec.overall /
  // original bbox) → mesh scale. This is what makes resizing the spec
  // dimensions live-update the rendered mesh.
  const [originalBboxMm, setOriginalBboxMm] = useState<{
    width_mm: number;
    height_mm: number;
    depth_mm: number;
  } | null>(null);
  useEffect(() => {
    if (meshBboxMm && !originalBboxMm) setOriginalBboxMm(meshBboxMm);
  }, [meshBboxMm, originalBboxMm]);
  // Reset when model id changes
  useEffect(() => {
    setOriginalBboxMm(null);
  }, [model?.id]);

  // Keep wheel-resize ref in sync with current spec + bbox
  useEffect(() => {
    wheelSpecRef.current = { spec, bbox: originalBboxMm };
  }, [spec, originalBboxMm]);

  // Custom wheel handler: in room mode, scroll wheel resizes the mesh by
  // updating spec.overall uniformly. OrbitControls.enableZoom is false in
  // room mode, so nothing fights us. The listener uses refs so we attach
  // it ONCE per (model.id × roomBackground) instead of on every spec edit.
  useEffect(() => {
    if (!roomBackground || !model) return;
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { spec: s, bbox } = wheelSpecRef.current;
      if (!s || !bbox) return;
      const currentMult = s.overall.width_mm / bbox.width_mm;
      // 5% per wheel notch; clamp to 0.3..3.0×
      const factor = e.deltaY > 0 ? 0.95 : 1.05;
      const newMult = Math.max(0.3, Math.min(3, currentMult * factor));
      setSpec({
        ...s,
        overall: {
          ...s.overall,
          width_mm: Math.round(bbox.width_mm * newMult),
          height_mm: Math.round(bbox.height_mm * newMult),
          depth_mm: Math.round(bbox.depth_mm * newMult),
        },
      });
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [roomBackground, model?.id]);

  // Compute scale factor (1,1,1 if no spec or not yet calibrated)
  const dimensionalScale: [number, number, number] | null =
    spec && originalBboxMm
      ? [
          spec.overall.width_mm / originalBboxMm.width_mm,
          spec.overall.height_mm / originalBboxMm.height_mm,
          spec.overall.depth_mm / originalBboxMm.depth_mm,
        ]
      : null;

  // Color helpers — which spec field carries the dominant fabric/finish color
  // (per category), and how to write it back.
  const getSpecColor = (s: FurnitureSpec | null): string | null => {
    if (!s) return null;
    if (s.category === "sofa") return s.upholstery_color ?? null;
    if (s.category === "chair") return s.upholstery_color ?? null;
    if (s.category === "bed")
      return s.upholstered_panels ? s.upholstery_color ?? null : null;
    return null;
  };
  const setSpecColor = (s: FurnitureSpec, color: string): FurnitureSpec => {
    if (s.category === "sofa") return { ...s, upholstery_color: color };
    if (s.category === "chair") return { ...s, upholstery_color: color };
    if (s.category === "bed") return { ...s, upholstery_color: color };
    return s;
  };

  // Bidirectional sync. We compare against a ref so spec→material and
  // material→spec don't ping-pong on every render.
  const lastSyncedColorRef = useRef<string | null>(null);
  useEffect(() => {
    const c = getSpecColor(spec);
    if (c && c !== lastSyncedColorRef.current) {
      lastSyncedColorRef.current = c;
      setMaterialOverride((prev) => (prev.color === c ? prev : { ...prev, color: c }));
    }
  }, [spec]);
  useEffect(() => {
    const c = materialOverride.color;
    if (c && c !== lastSyncedColorRef.current) {
      lastSyncedColorRef.current = c;
      setSpec((prev) => (prev ? setSpecColor(prev, c) : prev));
    }
  }, [materialOverride.color]);

  // ─── Material name → preset/color binding ──────────────────────────────
  // When the user picks a material name in the spec dropdowns (e.g. "Brass"),
  // map it to a Material preset + color and update the visual override.
  // We track which material slot drives the visual per category so the
  // dominant fabric/finish is the one that recolors the mesh.
  const lastSyncedMaterialNameRef = useRef<string | null>(null);
  useEffect(() => {
    if (!spec) return;
    let dominantName: string | undefined;
    if (spec.category === "sofa") dominantName = spec.upholstery_material;
    else if (spec.category === "chair") dominantName = spec.seat_material;
    else if (spec.category === "table") dominantName = spec.top_material;
    else if (spec.category === "lamp") dominantName = spec.shade_material;
    else if (spec.category === "storage") dominantName = spec.frame_material;
    else if (spec.category === "bed") dominantName = spec.frame_material;
    if (!dominantName || dominantName === lastSyncedMaterialNameRef.current) return;
    lastSyncedMaterialNameRef.current = dominantName;
    setMaterialOverride((prev) => applyMaterialName(prev, dominantName!));
  }, [spec]);

  const handleExportSTL = async () => {
    if (!model) return;
    try {
      await downloadSTL(model, settings.quality);
    } catch (e) {
      setError(`STL export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleLasso = async (points: Point2D[]) => {
    const info = cameraInfoRef.current;
    if (!info || !model) {
      setLassoMode(false);
      return;
    }

    // Mesh-mode lasso: capture canvas + lasso, send to OpenAI/Hunyuan refine.
    if (viewMode === "mesh" && model.mode === "mesh-url") {
      try {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
        if (!canvas) {
          setError("Canvas not found");
          setLassoMode(false);
          return;
        }
        const capture = await captureMeshWithLasso(canvas, points);
        setMeshLasso({ capture, position: polygonCentroid(points) });
      } catch (e) {
        setError(`Lasso capture failed: ${e instanceof Error ? e.message : String(e)}`);
        setLassoMode(false);
      }
      return;
    }

    // Parts-mode lasso: project parts to screen + select inside the polygon
    const inside = model.parts.filter((p) => {
      const center = projectToScreen(partCenterWorld(p), info.camera, info.size);
      return pointInPolygon(center, points);
    });
    if (inside.length === 0) {
      setLassoMode(false);
      setError(null);
      return;
    }
    setLassoSelection({ parts: inside, position: polygonCentroid(points) });
  };

  const handleMeshLassoSubmit = async (text: string) => {
    if (!meshLasso || !model) return;
    setMeshLassoBusy(true);
    setMeshLassoStart(performance.now());
    setMeshLassoElapsed(0);
    setError(null);
    try {
      // The lasso capture is already a PNG (mesh + orange highlight) — feed
      // it to /api/generate as the image input with the user's prompt.
      // Backend goes: OpenAI image-edit (it sees the highlight + reads the
      // text) → Hunyuan3D remesh → new mesh-url model.
      const { generateModel } = await import("./lib/api");
      const { model: m, generator_source } = await generateModel(
        sessionId,
        text,
        { mediaType: meshLasso.capture.mediaType, data: meshLasso.capture.data },
        health?.llm_available ? settings.generationModel : undefined,
        "max"
      );
      setModel(m);
      setGenSource(generator_source);
      setSpec(null);
      specAutoFiredFor.current = null;
      setSelected(null);
      setMeshLasso(null);
      setLassoMode(false);
    } catch (e) {
      setError(`Refine failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMeshLassoBusy(false);
      setMeshLassoStart(null);
    }
  };

  const handleLassoSubmit = async (text: string) => {
    if (!lassoSelection) return;
    setLassoBusy(true);
    setError(null);
    setLassoProgress({ done: 0, total: lassoSelection.parts.length });
    let lastModel: Model | null = null;
    for (let i = 0; i < lassoSelection.parts.length; i++) {
      const part = lassoSelection.parts[i];
      try {
        const { model: m, source } = await postEdit(
          sessionId,
          part.id,
          text,
          health?.llm_available ? settings.editModel : undefined
        );
        lastModel = m;
        setHistory((h) => [
          ...h,
          { cmd: { selected_part: part.id, edit: text }, source },
        ]);
        setLassoProgress({ done: i + 1, total: lassoSelection.parts.length });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    if (lastModel) setModel(lastModel);
    setLassoBusy(false);
    setLassoSelection(null);
    setLassoMode(false);
  };

  const cancelLasso = () => {
    setLassoSelection(null);
    setMeshLasso(null);
    setLassoMode(false);
  };

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __ariadne?: unknown }).__ariadne = {
        sessionId,
        select: setSelected,
        applyEdit: handleEdit,
        generate: handleGenerate,
        startOver: handleStartOver,
        getModel: () => model,
        getSettings: () => settings,
        setViewMode,
        exportSTL: handleExportSTL,
        triggerLasso: handleLasso,
        getCameraInfo: () => cameraInfoRef.current,
        // Dev-only: directly inject a mesh-url model (used for verifying the
        // Fal/Hunyuan GLB rendering path without spending more API credits).
        loadExistingMesh: (url: string, prompt = "test") => {
          setModel({
            id: `dev-${Date.now()}`,
            template: "dev-mesh-url",
            prompt,
            mode: "mesh-url",
            parts: [],
            meshUrl: url,
          });
          setViewMode("mesh");
        },
      };
    }
  });

  if (!bootstrapped) {
    return <div className="loading">Loading…</div>;
  }

  if (!model) {
    return <EntryScreen onGenerate={handleGenerate} error={error} />;
  }

  const isScadMode = model.mode === "scad";
  const isMeshUrlMode = model.mode === "mesh-url";
  const isNonEditableMode = isScadMode || isMeshUrlMode;
  const selectedPart = selected
    ? (model.parts.find((p) => p.id === selected) ?? null)
    : null;

  const canvasSize = cameraInfoRef.current?.size ?? { width: 800, height: 600 };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Ariadne Furniture</h1>
        <span className="subtitle" title={model.prompt}>
          “{model.prompt.length > 50 ? model.prompt.slice(0, 50) + "…" : model.prompt}”
        </span>
        <span className="header-spacer" />
        <SettingsBar settings={settings} health={health} onChange={updateSettings} />
        {busy && <span className="busy">contacting CAD backend…</span>}
        <button className="ghost small" onClick={handleStartOver}>
          Start over
        </button>
      </header>
      {error && (
        <div className="error-banner">
          <strong>Backend error:</strong> {error}
        </div>
      )}
      {genSource?.includes("no keyword match") && (
        <div className="notice-banner">
          <strong>Heads up:</strong> your prompt didn't match any template, so
          you're looking at a default table. Set{" "}
          <code>ANTHROPIC_API_KEY</code> on the server for free-form generation
          of any object.
        </div>
      )}
      <main className="app-main">
        {isMeshUrlMode && (
          <SpecPanel
            spec={spec}
            isGenerating={specGenerating}
            generateAvailable={!!health?.llm_available && !!meshBboxMm}
            onGenerate={handleGenerateSpec}
            onChange={setSpec}
            onDownload={handleDownloadSpec}
            onRebuildMesh={handleRebuildMesh}
            rebuildAvailable={!!health?.fal_available && !!health?.openai_available}
            isRebuilding={rebuildingMesh}
            modelPrompt={model.prompt}
            modelId={model.id}
            meshUrl={model.meshUrl ?? ""}
            sourceImageUrl={model.referenceImageUrl}
          />
        )}
        <div className="canvas-wrap">
          <div className="view-toolbar">
            {!isNonEditableMode && (
              <div className="view-toggle" role="tablist">
                <button
                  role="tab"
                  aria-selected={viewMode === "parts"}
                  className={viewMode === "parts" ? "active" : ""}
                  onClick={() => {
                    setViewMode("parts");
                    setLassoMode(false);
                  }}
                >
                  Parts
                </button>
                <button
                  role="tab"
                  aria-selected={viewMode === "mesh"}
                  className={viewMode === "mesh" ? "active" : ""}
                  onClick={() => {
                    setViewMode("mesh");
                    setLassoMode(false);
                  }}
                >
                  Mesh
                </button>
              </div>
            )}
            {(viewMode === "mesh" && isMeshUrlMode) || (!isNonEditableMode && viewMode === "parts") ? (
              <button
                className={`lasso-btn-big ${lassoMode ? "active" : ""}`}
                onClick={() => {
                  setLassoMode((m) => !m);
                  setLassoSelection(null);
                  setMeshLasso(null);
                }}
                title={
                  viewMode === "mesh"
                    ? "Lasso: circle a region and tell the AI what to change"
                    : "Lasso: circle multiple parts and edit them all at once"
                }
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <ellipse cx="12" cy="11" rx="8" ry="6" />
                  <path d="M9 17 L9 21" />
                  <circle cx="9" cy="22" r="1" fill="currentColor" />
                </svg>
                Lasso & edit a region
              </button>
            ) : null}
            <button className="export-btn" onClick={handleExportSTL}>
              Download .stl
            </button>
            {isMeshUrlMode && viewMode === "mesh" && (
              <>
                <button className="export-btn" onClick={handleOpenRoom}>
                  {roomScene ? "Change room" : "See it in a room"}
                </button>
                {roomScene && (
                  <button className="export-btn" onClick={handleClearRoom}>
                    Clear room
                  </button>
                )}
              </>
            )}
            {viewMode === "mesh" && meshStatus === "loading" && (
              <span className="mesh-status-loading">
                {isMeshUrlMode ? "loading mesh" : "compiling"}…{" "}
                ({(compileElapsed / 1000).toFixed(1)}s)
              </span>
            )}
            {viewMode === "mesh" && meshStatus === "error" && (
              <span className="mesh-status-error">
                {meshMessage ?? "mesh build failed"}
              </span>
            )}
          </div>
          {viewMode === "mesh" && (
            <>
              <MaterialControls
                material={material}
                onChangeMaterial={setMaterial}
                colorScheme={colorScheme}
                onChangeColorScheme={setColorScheme}
                polygonCount={polygonCount}
              />
              {isMeshUrlMode && (
                <div className="material-picker-wrap">
                  <MaterialPicker
                    override={materialOverride}
                    onChange={setMaterialOverride}
                  />
                </div>
              )}
            </>
          )}
          <Scene
            model={model}
            selected={selected}
            onSelect={setSelected}
            quality={settings.quality}
            viewMode={viewMode}
            cameraRef={cameraInfoRef}
            orbitEnabled={!lassoMode && !lassoSelection}
            material={material}
            colorScheme={colorScheme}
            materialOverride={materialOverride}
            dimensionalScale={dimensionalScale}
            roomBackground={roomBackground}
            roomScene={roomScene}
            meshOffset={meshOffset}
            meshRotationY={meshRotationY}
            onMeshStatus={handleMeshStatus}
            onMeshBbox={handleMeshBbox}
          />
          <LassoOverlay
            active={lassoMode && !lassoSelection && !meshLasso}
            onLasso={handleLasso}
            onCancel={cancelLasso}
          />
          {lassoSelection && (
            <LassoPopup
              parts={lassoSelection.parts}
              position={lassoSelection.position}
              canvasSize={canvasSize}
              onSubmit={handleLassoSubmit}
              onCancel={cancelLasso}
              busy={lassoBusy}
              progress={lassoProgress.total > 0 ? lassoProgress : undefined}
            />
          )}
          {meshLasso && (
            <MeshLassoPopup
              position={meshLasso.position}
              canvasSize={canvasSize}
              preview={meshLasso.capture.preview}
              onSubmit={handleMeshLassoSubmit}
              onCancel={cancelLasso}
              busy={meshLassoBusy}
              elapsedMs={meshLassoElapsed}
            />
          )}
          {isMeshUrlMode && viewMode === "mesh" && (
            <ChatPanel
              messages={chatMessages}
              busy={chatBusy}
              elapsedMs={chatElapsed}
              onSend={handleChatSend}
              onClear={handleChatClear}
            />
          )}
          {roomModal && (
            <RoomViewModal
              onPickedPhoto={(url) => {
                setRoomScene({ kind: "photo", url });
                setMeshOffset([0, 0, 0]);
                setMeshRotationY(0);
                setRoomModal(false);
              }}
              onPicked3D={(id, aiMeshUrl) => {
                setRoomScene({ kind: "room3d", id, aiMeshUrl });
                setMeshOffset([0, 0, 0]);
                setMeshRotationY(0);
                setRoomModal(false);
              }}
              onPickedScanned={(layout) => {
                setRoomScene({ kind: "scanned", layout });
                setMeshOffset([0, 0, 0]);
                setMeshRotationY(0);
                setRoomModal(false);
              }}
              onPickedSplat={(splatUrl) => {
                setRoomScene({ kind: "splat", splatUrl });
                setMeshOffset([0, 0, 0]);
                setMeshRotationY(0);
                setRoomModal(false);
              }}
              onClose={() => setRoomModal(false)}
              meshSnapshot={meshSnapshotForRoom}
            />
          )}
          {/* Inline Size slider — overlays the canvas in mesh view when we
              have a spec + bbox to derive the real-world multiplier from.
              Slider edits spec.overall uniformly, which feeds dimensionalScale
              and rescales the mesh. Single source of truth: the spec. */}
          {viewMode === "mesh" &&
            isMeshUrlMode &&
            spec &&
            originalBboxMm && (
              <InlineSizeSlider
                spec={spec}
                originalBboxMm={originalBboxMm}
                onChangeSpec={setSpec}
              />
            )}
          {/* Room controller — directional pad + scale +/-. Shown only in
              room mode so the user can place the mesh without fighting the
              camera. Scale buttons rewrite spec.overall uniformly, same
              source of truth as the inline slider. */}
          {viewMode === "mesh" &&
            isMeshUrlMode &&
            roomScene &&
            spec &&
            originalBboxMm && (
              <RoomController
                offset={meshOffset}
                rotationY={meshRotationY}
                onRotate={(deltaRad) =>
                  // Functional update so rapid clicks compound and we
                  // don't fight a stale rotation captured at render time.
                  setMeshRotationY((r) => r + deltaRad)
                }
                onNudge={(dx, dz) =>
                  // Functional update — rapid clicks compound (each click
                  // reads the LATEST offset, not the one from closure).
                  setMeshOffset(([x, y, z]) => [
                    Math.max(-8, Math.min(8, x + dx)),
                    y,
                    Math.max(-6, Math.min(6, z + dz)),
                  ])
                }
                onRecenter={() => {
                  setMeshOffset(([, y]) => [0, y, 0]);
                  setMeshRotationY(0);
                }}
                multiplier={spec.overall.width_mm / originalBboxMm.width_mm}
                onScale={(factor) =>
                  // Functional update on spec so the new multiplier is
                  // computed from the LATEST spec, not the rendered value.
                  setSpec((prev) => {
                    if (!prev) return prev;
                    const currMult = prev.overall.width_mm / originalBboxMm.width_mm;
                    const m = Math.max(0.2, Math.min(4, currMult * factor));
                    return {
                      ...prev,
                      overall: {
                        ...prev.overall,
                        width_mm: Math.round(originalBboxMm.width_mm * m),
                        height_mm: Math.round(originalBboxMm.height_mm * m),
                        depth_mm: Math.round(originalBboxMm.depth_mm * m),
                      },
                    };
                  })
                }
              />
            )}
        </div>
        {!isNonEditableMode && (
          <EditPanel
            selectedPart={viewMode === "parts" ? selectedPart : null}
            onEdit={handleEdit}
            busy={busy}
          />
        )}
      </main>
      {history.length > 0 && (
        <section className="history">
          <h3>Edits sent to CAD backend</h3>
          <ol>
            {history.map((h, i) => {
              const part = model.parts.find((p) => p.id === h.cmd.selected_part);
              return (
                <li key={i}>
                  <span className="history-label">
                    {part?.label ?? h.cmd.selected_part}
                  </span>{" "}
                  ← <span className="history-edit">{h.cmd.edit}</span>{" "}
                  <span className="history-source">[{h.source}]</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

// In-canvas Size slider: a uniform multiplier on the overall dimensions.
// The slider is derived from current spec / original bbox, so editing it
// just rewrites spec.overall — which the existing dimensionalScale binding
// picks up and rescales the visible mesh against. Spec data and mesh size
// stay in sync, and the displayed mm values reflect the real-world size
// the piece would be next to a room photo.
function InlineSizeSlider({
  spec,
  originalBboxMm,
  onChangeSpec,
}: {
  spec: FurnitureSpec;
  originalBboxMm: { width_mm: number; height_mm: number; depth_mm: number };
  onChangeSpec: (s: FurnitureSpec) => void;
}) {
  const multiplier = spec.overall.width_mm / originalBboxMm.width_mm;
  const setMultiplier = (m: number) => {
    onChangeSpec({
      ...spec,
      overall: {
        ...spec.overall,
        width_mm: Math.round(originalBboxMm.width_mm * m),
        height_mm: Math.round(originalBboxMm.height_mm * m),
        depth_mm: Math.round(originalBboxMm.depth_mm * m),
      },
    });
  };
  return (
    <div className="inline-size-slider">
      <div className="iss-readout">
        <span className="iss-label">Size</span>
        <span className="iss-dims">
          {spec.overall.width_mm} × {spec.overall.height_mm} ×{" "}
          {spec.overall.depth_mm} mm
        </span>
        <span className="iss-mult">{multiplier.toFixed(2)}×</span>
      </div>
      <input
        type="range"
        min={0.3}
        max={3}
        step={0.01}
        value={multiplier}
        onChange={(e) => setMultiplier(Number(e.target.value))}
      />
    </div>
  );
}
