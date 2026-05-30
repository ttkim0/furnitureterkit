// "Place in room" picker — categorized default scenes + describe-a-scene
// (OpenAI generates the room). Returns the picked room as a data URL via
// onPicked; the editor then uses it as the canvas background.

import { useEffect, useRef, useState } from "react";
import {
  generateRoomImage,
  generateRoomMesh,
  listGeneratedRoomMeshes,
  placeInRoom,
  type ImageRef,
  type ScannedRoomLayout,
} from "../lib/api";
import { ROOM_3D_SCENES, type Room3DId } from "./Room3D";
import { ScanRoomFlow } from "./ScanRoomFlow";

interface RoomViewModalProps {
  // Picked a 2D photo → it becomes the canvas CSS background
  onPickedPhoto: (roomDataUrl: string) => void;
  // Picked a procedural 3D room → it renders inside the same Three.js
  // canvas alongside the user's mesh. Optionally pass `aiMeshUrl` to load
  // an AI-generated GLB room mesh for that category instead of the
  // procedural primitive version.
  onPicked3D: (id: Room3DId, aiMeshUrl?: string) => void;
  // Premium SLAM3R sidecar path: structured walls/doors/windows JSON.
  onPickedScanned: (layout: ScannedRoomLayout) => void;
  // Gaussian Splatting sidecar path: .splat URL renders as a photoreal
  // radiance field via SplatViewer.
  onPickedSplat: (splatUrl: string) => void;
  onClose: () => void;
  // Snapshot of the current 3D mesh as a data URL. Used on the Upload tab
  // so the user can ask gpt-image-1 to composite the piece into their photo
  // ("replace all the chairs around this dining table with this 3D model").
  meshSnapshot?: string | null;
}

type Category = "home" | "office" | "restaurant" | "hospitality" | "education";

interface RoomDef {
  id: string;
  label: string;
  url: string;
}

// Curated wide-angle interior photos for furniture test-fit. Selection
// rules used when picking these:
//   1. Wide-angle, eye-level, shows floor + walls — the framing a buyer
//      would use to picture a piece in the space.
//   2. Empty or sparsely-furnished, with visible floor space where a new
//      piece could land. Fully-cluttered rooms are out.
//   3. For restaurants / classrooms, bare tables/desks are visible so the
//      user can see chairs placed around them.
//   4. No people in frame, no AI/CGI renders.
// All 25 URLs verified HTTP 200 with image/jpeg content.
const ROOMS: Record<Category, RoomDef[]> = {
  home: [
    { id: "home-1", label: "Empty hardwood-floor room", url: "https://images.unsplash.com/photo-1722650272764-08d92d193a9c?w=1600&q=80" },
    { id: "home-2", label: "Empty room with garden view", url: "https://images.unsplash.com/photo-1668910242969-bd2933e7a5cf?w=1600&q=80" },
    { id: "home-3", label: "Bright empty white room", url: "https://images.unsplash.com/photo-1721395286594-8913b06056eb?w=1600&q=80" },
    { id: "home-4", label: "Tall-window loft", url: "https://images.unsplash.com/photo-1722650362357-7cb7d35a45eb?w=1600&q=80" },
    { id: "home-5", label: "Empty city-view loft", url: "https://images.unsplash.com/photo-1762810951632-68c9f197cf33?w=1600&q=80" },
  ],
  office: [
    { id: "off-1", label: "Open-plan office floor", url: "https://images.unsplash.com/photo-1742630394132-cbd951f7d924?w=1600&q=80" },
    { id: "off-2", label: "Sunlit private office", url: "https://images.unsplash.com/photo-1700809887584-0798672b1d48?w=1600&q=80" },
    { id: "off-3", label: "Minimalist boardroom", url: "https://images.unsplash.com/photo-1431540015161-0bf868a2d407?w=1600&q=80" },
    { id: "off-4", label: "Wooden-ceiling meeting room", url: "https://images.unsplash.com/photo-1727826384445-0dd59e88b2b9?w=1600&q=80" },
    { id: "off-5", label: "Coworking floor with pendants", url: "https://images.unsplash.com/photo-1686345233737-8f218f94f44f?w=1600&q=80" },
  ],
  restaurant: [
    { id: "rest-1", label: "Modern dining room (bare tables)", url: "https://images.unsplash.com/photo-1776614277456-0fcbc6712eb6?w=1600&q=80" },
    { id: "rest-2", label: "Empty bar counter", url: "https://images.unsplash.com/photo-1772057593525-3f580fb824d3?w=1600&q=80" },
    { id: "rest-3", label: "City-view cafe (bare tables)", url: "https://images.unsplash.com/photo-1755533622553-ca79eeade952?w=1600&q=80" },
    { id: "rest-4", label: "Warm bistro interior", url: "https://images.unsplash.com/photo-1763142045723-230b56924c6a?w=1600&q=80" },
    { id: "rest-5", label: "Outdoor patio dining", url: "https://images.unsplash.com/photo-1684161384292-885e9ffcdc6b?w=1600&q=80" },
  ],
  hospitality: [
    { id: "hsp-1", label: "Hotel lobby", url: "https://images.unsplash.com/photo-1637730827702-de34e9ae4ede?w=1600&q=80" },
    { id: "hsp-2", label: "Boutique lobby", url: "https://images.unsplash.com/photo-1774192621035-20d11389f781?w=1600&q=80" },
    { id: "hsp-3", label: "Wood-paneled spa room", url: "https://images.unsplash.com/photo-1758632031161-b6d7e913c2b9?w=1600&q=80" },
    { id: "hsp-4", label: "Treatment / massage room", url: "https://images.unsplash.com/photo-1745327883290-1e9c6447b938?w=1600&q=80" },
    { id: "hsp-5", label: "Rooftop terrace", url: "https://images.unsplash.com/photo-1493246318656-5bfd4cfb29b8?w=1600&q=80" },
  ],
  education: [
    { id: "edu-1", label: "Classroom with empty desks", url: "https://images.unsplash.com/photo-1740635341299-3b8e3490f546?w=1600&q=80" },
    { id: "edu-2", label: "Empty white-walled classroom", url: "https://images.unsplash.com/photo-1519406596751-0a3ccc4937fe?w=1600&q=80" },
    { id: "edu-3", label: "Wooden-desk classroom", url: "https://images.unsplash.com/photo-1635424239131-32dc44986b56?w=1600&q=80" },
    { id: "edu-4", label: "Lecture hall", url: "https://images.unsplash.com/photo-1519452575417-564c1401ecc0?w=1600&q=80" },
    { id: "edu-5", label: "Library reading hall", url: "https://images.unsplash.com/photo-1749671232817-1f224147f0c9?w=1600&q=80" },
  ],
};

const CATEGORY_LABELS: Record<Category, string> = {
  home: "Home",
  office: "Office",
  restaurant: "Restaurant",
  hospitality: "Hospitality",
  education: "Education",
};

const MAX_ROOM_BYTES = 8 * 1024 * 1024;

export function RoomViewModal({
  onPickedPhoto,
  onPicked3D,
  onPickedScanned,
  onPickedSplat,
  onClose,
  meshSnapshot,
}: RoomViewModalProps) {
  const [tab, setTab] = useState<"3d" | "scan" | Category | "describe" | "upload">("3d");
  const [pickedRoom, setPickedRoom] = useState<RoomDef | null>(ROOMS.home[0]);
  const [error, setError] = useState<string | null>(null);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [describeText, setDescribeText] = useState("");
  const [describeElapsed, setDescribeElapsed] = useState(0);
  const describeStartRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Upload tab state
  const [uploadedRoom, setUploadedRoom] = useState<ImageRef | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [uploadInstruction, setUploadInstruction] = useState("");
  const [uploadElapsed, setUploadElapsed] = useState(0);
  const uploadStartRef = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (describeStartRef.current === null) return;
    const i = setInterval(() => {
      if (describeStartRef.current)
        setDescribeElapsed(performance.now() - describeStartRef.current);
    }, 200);
    return () => clearInterval(i);
  }, [loadingRoom]);

  useEffect(() => {
    if (uploadStartRef.current === null) return;
    const i = setInterval(() => {
      if (uploadStartRef.current)
        setUploadElapsed(performance.now() - uploadStartRef.current);
    }, 200);
    return () => clearInterval(i);
  }, [loadingRoom]);

  // Upload handler: stash the file in state (as both data URL + ImageRef
  // for backend use). The user then optionally types an instruction and
  // clicks "Use as backdrop" or "Composite with this room".
  const handleFile = (file: File) => {
    setError(null);
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
      setError(`Unsupported image type: ${file.type}`);
      return;
    }
    if (file.size > MAX_ROOM_BYTES) {
      setError(`Image too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (max 8 MB)`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setUploadedPreview(dataUrl);
      // Strip the data: prefix → bare base64 for the backend
      const [meta, b64] = dataUrl.split(",");
      const m = /data:([^;]+);base64/.exec(meta);
      const mediaType = m?.[1] || file.type || "image/png";
      setUploadedRoom({ mediaType, data: b64 });
    };
    reader.onerror = () => setError("Failed to read image.");
    reader.readAsDataURL(file);
  };

  // Use the uploaded photo straight as canvas background (no AI step).
  const useUploadedAsBackdrop = () => {
    if (!uploadedPreview) return;
    onPickedPhoto(uploadedPreview);
  };

  // Composite mode: send (uploaded room + mesh snapshot + instruction) to
  // gpt-image-1 via /api/place-in-room. The model is told to KEEP the
  // furniture exactly as shown and adapt the room — e.g. "replace all the
  // chairs around the table with this 3D model". The composite becomes
  // the canvas background; the actual 3D mesh still floats on top so the
  // user can keep pan/rotate/resize editing it.
  const compositeWithUploaded = async () => {
    if (!uploadedRoom || !meshSnapshot || !uploadInstruction.trim()) return;
    setLoadingRoom(true);
    setError(null);
    uploadStartRef.current = performance.now();
    setUploadElapsed(0);
    try {
      // Strip the data: prefix from the mesh snapshot
      const [meta, b64] = meshSnapshot.split(",");
      const m = /data:([^;]+);base64/.exec(meta);
      const meshImg: ImageRef = {
        mediaType: m?.[1] || "image/png",
        data: b64,
      };
      const { image } = await placeInRoom(
        meshImg,
        uploadedRoom,
        uploadInstruction.trim()
      );
      onPickedPhoto(`data:${image.mediaType};base64,${image.data}`);
    } catch (e) {
      setError(
        `Composite failed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setLoadingRoom(false);
      uploadStartRef.current = null;
    }
  };

  const useDefaultRoom = async (room: RoomDef) => {
    setLoadingRoom(true);
    setError(null);
    try {
      const res = await fetch(room.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("failed to read room blob"));
        reader.readAsDataURL(blob);
      });
      onPickedPhoto(dataUrl);
    } catch (e) {
      setError(
        `Could not load that scene (${e instanceof Error ? e.message : String(e)}). Try another, or upload your own.`
      );
    } finally {
      setLoadingRoom(false);
    }
  };

  const generateScene = async () => {
    if (!describeText.trim()) return;
    setLoadingRoom(true);
    setError(null);
    describeStartRef.current = performance.now();
    setDescribeElapsed(0);
    try {
      const { image } = await generateRoomImage(describeText.trim());
      onPickedPhoto(`data:${image.mediaType};base64,${image.data}`);
    } catch (e) {
      setError(
        `Scene generation failed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setLoadingRoom(false);
      describeStartRef.current = null;
    }
  };

  const isCategoryTab =
    tab !== "3d" && tab !== "scan" && tab !== "describe" && tab !== "upload";

  return (
    <div className="room-modal-backdrop" onClick={onClose}>
      <div className="room-modal" onClick={(e) => e.stopPropagation()}>
        <header className="room-modal-header">
          <h2>See it in a room</h2>
          <button className="room-modal-close" onClick={onClose}>×</button>
        </header>

        <div className="room-modal-body">
          <p className="room-modal-lede">
            Pick a scene. <b>3D rooms</b> let you walk your piece through a
            real space — rotate, zoom, pan with the mouse, position with the
            controller. Photos work too if you want a real-world backdrop.
          </p>

          <div className="room-modal-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "3d"}
              className={`room-modal-tab ${tab === "3d" ? "active" : ""}`}
              onClick={() => setTab("3d")}
            >
              3D Rooms ★
            </button>
            <button
              role="tab"
              aria-selected={tab === "scan"}
              className={`room-modal-tab ${tab === "scan" ? "active" : ""}`}
              onClick={() => setTab("scan")}
              title="Scan your real room with your phone (uses SLAM3R + SpatialLM on the GPU sidecar)"
            >
              Scan my room 📷
            </button>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={tab === c}
                className={`room-modal-tab ${tab === c ? "active" : ""}`}
                onClick={() => {
                  setTab(c);
                  setPickedRoom(ROOMS[c][0]);
                }}
              >
                {CATEGORY_LABELS[c]}
              </button>
            ))}
            <button
              role="tab"
              aria-selected={tab === "describe"}
              className={`room-modal-tab ${tab === "describe" ? "active" : ""}`}
              onClick={() => setTab("describe")}
            >
              Describe ✨
            </button>
            <button
              role="tab"
              aria-selected={tab === "upload"}
              className={`room-modal-tab ${tab === "upload" ? "active" : ""}`}
              onClick={() => setTab("upload")}
            >
              Upload
            </button>
          </div>

          {tab === "3d" && (
            <Rooms3DTab
              onPicked3D={onPicked3D}
              setError={setError}
            />
          )}

          {tab === "scan" && (
            <ScanRoomFlow
              // Free tier (Photos): Trellis GLB → same renderer as
              // our cached AI rooms (Room3D with aiMeshUrl).
              onScannedMesh={(meshUrl) => onPicked3D("home-3d", meshUrl)}
              // Premium tier (Gaussian Splatting sidecar): .splat URL
              onScannedSplat={onPickedSplat}
              // Legacy SLAM3R path (kept around for the structured layout case)
              onScannedLayout={onPickedScanned}
              setError={setError}
            />
          )}

          {isCategoryTab && (
            <>
              <div className="room-modal-grid">
                {ROOMS[tab as Category].map((r) => (
                  <button
                    key={r.id}
                    className={`room-modal-thumb ${pickedRoom?.id === r.id ? "active" : ""}`}
                    onClick={() => setPickedRoom(r)}
                  >
                    <img src={r.url.replace("w=1600", "w=400")} alt={r.label} loading="lazy" />
                    <span>{r.label}</span>
                  </button>
                ))}
              </div>
              <button
                className="room-modal-primary"
                onClick={() => pickedRoom && useDefaultRoom(pickedRoom)}
                disabled={loadingRoom || !pickedRoom}
              >
                {loadingRoom
                  ? "Loading scene…"
                  : `Use ${pickedRoom?.label.toLowerCase() ?? "scene"}`}
              </button>
            </>
          )}

          {tab === "describe" && (
            <>
              <textarea
                value={describeText}
                onChange={(e) => setDescribeText(e.target.value)}
                placeholder="e.g. a sunlit Scandinavian-style living room with white walls, oak floors, and a large window overlooking pine trees…"
                rows={4}
                disabled={loadingRoom}
                className="room-modal-describe"
              />
              <p className="room-modal-describe-note">
                Custom scenes take 15–60 s and cost ~$0.04 (gpt-image-1).
              </p>
              <button
                className="room-modal-primary"
                onClick={generateScene}
                disabled={loadingRoom || !describeText.trim()}
              >
                {loadingRoom
                  ? `Generating scene… (${(describeElapsed / 1000).toFixed(1)}s)`
                  : "Generate scene (~$0.04)"}
              </button>
            </>
          )}

          {tab === "upload" && (
            <>
              {!uploadedPreview ? (
                <>
                  <button
                    className="room-modal-upload"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    + Upload a photo of your room
                  </button>
                  <p className="room-modal-describe-note">
                    Wide-angle photo of your actual space. Works best when
                    you can see the floor and walls clearly.
                  </p>
                </>
              ) : (
                <>
                  <div className="room-modal-uploaded-preview">
                    <img src={uploadedPreview} alt="Uploaded room" />
                    <button
                      className="room-modal-uploaded-replace"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Replace photo
                    </button>
                  </div>
                  <textarea
                    value={uploadInstruction}
                    onChange={(e) => setUploadInstruction(e.target.value)}
                    placeholder="Optional — tell us what to do with this room. e.g. 'replace all the chairs around the dining table with this 3D model' or 'put one of these in each empty corner'. Leave blank to just use the photo as a backdrop."
                    rows={4}
                    disabled={loadingRoom}
                    className="room-modal-describe"
                  />
                  <p className="room-modal-describe-note">
                    {uploadInstruction.trim() && meshSnapshot
                      ? "Composite mode (gpt-image-1) — 20–60 s, ~$0.04. The 3D model still floats on top so you can keep editing it."
                      : !meshSnapshot
                        ? "Composite needs a 3D mesh — close this and generate one first, then come back to composite."
                        : "Will use your photo as a plain backdrop with the 3D model on top."}
                  </p>
                  <div className="room-modal-upload-actions">
                    <button
                      className="room-modal-secondary"
                      onClick={useUploadedAsBackdrop}
                      disabled={loadingRoom}
                    >
                      Use as backdrop
                    </button>
                    <button
                      className="room-modal-primary"
                      onClick={compositeWithUploaded}
                      disabled={
                        loadingRoom ||
                        !uploadInstruction.trim() ||
                        !meshSnapshot
                      }
                    >
                      {loadingRoom
                        ? `Compositing… (${(uploadElapsed / 1000).toFixed(1)}s)`
                        : "Composite with 3D model (~$0.04)"}
                    </button>
                  </div>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </>
          )}

          {error && <div className="room-modal-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── 3D Rooms tab ─────────────────────────────────────────────────────
// Per-card buttons: "Use procedural" (instant, fake geometry) and
// "Generate AI room" (1–3 min, ~$0.35, real Hunyuan-built GLB). The AI
// URLs are cached server-side per category so the second click is free.
function Rooms3DTab({
  onPicked3D,
  setError,
}: {
  onPicked3D: (id: Room3DId, aiMeshUrl?: string) => void;
  setError: (e: string | null) => void;
}) {
  // Which categories already have a cached AI mesh on the server
  const [cachedUrls, setCachedUrls] = useState<Record<string, string>>({});
  // Per-category in-flight generation status
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [generatingElapsed, setGeneratingElapsed] = useState<
    Record<string, number>
  >({});
  const generatingStartRef = useRef<Record<string, number>>({});

  useEffect(() => {
    listGeneratedRoomMeshes()
      .then(({ rooms }) => {
        const map: Record<string, string> = {};
        for (const [cat, entry] of Object.entries(rooms)) {
          if (entry?.mesh_url) map[cat] = entry.mesh_url;
        }
        setCachedUrls(map);
      })
      .catch(() => {
        // Backend down or endpoint missing — silently fall through; the
        // user can still pick procedural rooms.
      });
  }, []);

  // Tick elapsed-time counter for any in-flight generations
  useEffect(() => {
    const anyRunning = Object.values(generating).some(Boolean);
    if (!anyRunning) return;
    const i = setInterval(() => {
      const next: Record<string, number> = {};
      for (const [cat, start] of Object.entries(generatingStartRef.current)) {
        next[cat] = performance.now() - start;
      }
      setGeneratingElapsed(next);
    }, 500);
    return () => clearInterval(i);
  }, [generating]);

  const generate = async (categoryId: string) => {
    setError(null);
    setGenerating((g) => ({ ...g, [categoryId]: true }));
    generatingStartRef.current[categoryId] = performance.now();
    try {
      const result = await generateRoomMesh(categoryId);
      setCachedUrls((m) => ({ ...m, [categoryId]: result.mesh_url }));
      // Immediately switch into this room so the user sees the result
      onPicked3D(categoryId as Room3DId, result.mesh_url);
    } catch (e) {
      setError(
        `Could not generate room: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setGenerating((g) => ({ ...g, [categoryId]: false }));
      delete generatingStartRef.current[categoryId];
    }
  };

  return (
    <>
      <div className="room-modal-3d-grid">
        {ROOM_3D_SCENES.map((s) => {
          const hasAI = !!cachedUrls[s.id];
          const isGenerating = !!generating[s.id];
          const elapsed = generatingElapsed[s.id] ?? 0;
          return (
            <div key={s.id} className="room-modal-3d-card">
              <button
                className="room-modal-3d-card-pick"
                onClick={() => onPicked3D(s.id, cachedUrls[s.id])}
                disabled={isGenerating}
                title={
                  hasAI
                    ? "Use AI-generated room (cached)"
                    : "Use procedural room"
                }
              >
                <div className={`room-modal-3d-swatch swatch-${s.id}`}>
                  {hasAI && <span className="room-modal-3d-badge">AI</span>}
                </div>
                <div className="room-modal-3d-card-body">
                  <div className="room-modal-3d-label">{s.label}</div>
                  <div className="room-modal-3d-desc">{s.description}</div>
                </div>
              </button>
              <button
                className="room-modal-3d-gen"
                onClick={() => generate(s.id)}
                disabled={isGenerating}
                title={
                  hasAI
                    ? "Re-generate the AI room (overwrites cache, ~$0.35)"
                    : "Generate real 3D mesh via gpt-image-1 + Hunyuan3D, ~$0.35, 1–3 min"
                }
              >
                {isGenerating
                  ? `Generating… ${(elapsed / 1000).toFixed(0)}s`
                  : hasAI
                    ? "Re-generate AI room"
                    : "Generate AI room (~$0.35)"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="room-modal-describe-note">
        <b>AI rooms</b> use the same Hunyuan3D pipeline as your furniture —
        real mesh, real textures, walks around the same way. First gen takes
        1–3 min and costs ~$0.35; we cache the result so it's free after.
        Procedural rooms (no AI badge) load instantly as fallback.
      </p>
    </>
  );
}
