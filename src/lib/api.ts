import type { Model } from "./model";

export interface HealthResponse {
  ok: boolean;
  service: string;
  llm: string;
  llm_available: boolean;
  fal_available: boolean;
  openai_available: boolean;
  photoreal_mesh: string;
  image_gen: string;
  mode: "freeform" | "templates";
  templates: string[];
  models: string[];
  default_generation_model: string;
  default_edit_model: string;
}

export interface ImageRef {
  mediaType: string;
  data: string;
}

interface GenerateResponse {
  model: Model;
  generator_source: string;
  available_templates: string[];
  llm_available: boolean;
}

interface EditResponse {
  model: Model;
  change: { part_id: string; override: { color?: string; scale?: [number, number, number] } };
  source: string;
}

interface ModelResponse {
  model: Model | null;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  return jsonOrThrow<HealthResponse>(res);
}

export async function getModel(sessionId: string): Promise<Model | null> {
  const res = await fetch(
    `/api/model?sessionId=${encodeURIComponent(sessionId)}`
  );
  const { model } = await jsonOrThrow<ModelResponse>(res);
  return model;
}

export async function generateModel(
  sessionId: string,
  prompt: string,
  image?: ImageRef,
  model?: string,
  qualityPreset?: "max" | "draft" | "textureless"
): Promise<GenerateResponse> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      prompt,
      image: image ?? null,
      model: model ?? null,
      quality_preset: qualityPreset ?? null,
    }),
  });
  return jsonOrThrow<GenerateResponse>(res);
}

export async function rebuildMesh(
  sessionId: string,
  prompt: string,
  referenceImageUrl?: string,
  model?: string
): Promise<GenerateResponse> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      prompt,
      // Pass the reference image URL so the backend can fetch + re-edit it.
      reference_image_url: referenceImageUrl ?? null,
      model: model ?? null,
      quality_preset: "max",
    }),
  });
  return jsonOrThrow<GenerateResponse>(res);
}

export async function postEdit(
  sessionId: string,
  selected_part: string,
  edit: string,
  model?: string
): Promise<EditResponse> {
  const res = await fetch("/api/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, selected_part, edit, model: model ?? null }),
  });
  return jsonOrThrow<EditResponse>(res);
}

export interface SpecResponse {
  spec: import("./spec").FurnitureSpec;
}

export async function generateSpec(
  sessionId: string,
  bbox_mm: { width_mm: number; height_mm: number; depth_mm: number },
  image?: ImageRef,
  model?: string,
  promptOverride?: string
): Promise<SpecResponse> {
  const res = await fetch("/api/spec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      bbox_mm,
      image: image ?? null,
      model: model ?? null,
      prompt: promptOverride ?? null,
    }),
  });
  return jsonOrThrow<SpecResponse>(res);
}

// Build a manufacturable CAD bundle from a finalized furniture spec.
// Runs the Python build123d service on the backend (~0.2s) and returns a
// downloadable ZIP containing STEP (assembled + per-part), DXF panel
// projections for CNC, cutlist CSV, BOM JSON, and a summary index.
//
// What's inside the ZIP — the things a real furniture maker needs:
//   assembled.step           ← full assembly, one file, opens in every CAD
//   parts/<name>.step        ← per-part STEP for isolated machining
//   parts/<name>.dxf         ← flat panel projections for CNC router/laser
//   cutlist.csv              ← width × depth × thickness × qty × material
//   bom.json                 ← hardware, glue, finish, fasteners
//   summary.json             ← machine-readable index
export interface CadBundleSummary {
  category: string;
  files: {
    assembled_step: string;
    parts_step: Record<string, string>;
    parts_dxf: Record<string, string>;
    cutlist_csv: string;
    bom_json: string;
  };
  part_count: number;
  cutlist_rows: number;
  bom_rows: number;
  notes: string;
  elapsed_seconds: number;
  zip_size_bytes: number;
}

export interface CadBundleResponse {
  ok: true;
  zip_url: string;
  summary: CadBundleSummary;
  elapsed_ms: number;
}

export async function generateCadBundle(
  spec: unknown,
  sessionId?: string
): Promise<CadBundleResponse> {
  const res = await fetch("/api/generate-cad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec, sessionId: sessionId ?? null }),
  });
  return jsonOrThrow<CadBundleResponse>(res);
}

// ── Marketplace: AI brand asset generation (Phase 1) ───────────────────
export interface GeneratedImage {
  url: string; // server-hosted, e.g. /store-assets/logo-abc-123.png
  mediaType: string;
  prompt: string;
}

export async function generateLogoImage(input: {
  storeName: string;
  tagline?: string;
  style?: "wordmark" | "mark" | "combined";
  vibe?: string;
  bgColor?: string;
}): Promise<GeneratedImage> {
  const res = await fetch("/api/generate-logo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<GeneratedImage>(res);
}

export async function generateHeroImageApi(input: {
  storeName: string;
  vibe?: string;
  primaryProduct?: string;
}): Promise<GeneratedImage> {
  const res = await fetch("/api/generate-hero", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<GeneratedImage>(res);
}

export async function generateProductPhotoApi(input: {
  title: string;
  description?: string;
  category?: string;
  material?: string;
  style?: "lifestyle" | "studio" | "lifestyle-warm";
}): Promise<GeneratedImage> {
  const res = await fetch("/api/generate-product-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<GeneratedImage>(res);
}

export interface AutoPhotoInput {
  id: string;
  title: string;
  description?: string;
  category?: string;
  material?: string;
  style?: "lifestyle" | "studio" | "lifestyle-warm";
  /** White-background source image of the actual piece (from Hunyuan flow).
   *  When present, gpt-image-1.edit() preserves the real geometry instead
   *  of dreaming up a fictional piece from text. */
  sourceImageUrl?: string;
}

export interface AutoPhotoBatchResponse {
  results: Record<string, { url: string; error?: string; mode?: "edit" | "generate" }>;
  elapsed_ms: number;
}

/** Batch generate product photos in parallel (server caps concurrency at 3).
 *  Used by the designer to populate empty product cards automatically. */
export async function autoGenerateProductPhotos(
  products: AutoPhotoInput[]
): Promise<AutoPhotoBatchResponse> {
  const res = await fetch("/api/auto-generate-product-photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ products }),
  });
  return jsonOrThrow<AutoPhotoBatchResponse>(res);
}

export interface AutoGalleryBatchResponse {
  results: Record<
    string,
    { hero: string; gallery: string[]; error?: string; mode?: "edit" | "generate" }
  >;
  elapsed_ms: number;
}

export interface AutoVideoBatchResponse {
  results: Record<string, { url: string; error?: string }>;
  elapsed_ms: number;
}

export interface AutoVideoInput {
  id: string;
  title: string;
  sourceImageUrl: string;
  category?: string;
  material?: string;
}

/** Batch generate per-product cinematic videos via Fal Seedance.
 *  ~$0.10 per video, ~60s latency. Concurrency capped at 2 on the server.
 *  Used during site generation to create scroll-scrub hero videos. */
export async function autoGenerateProductVideos(
  products: AutoVideoInput[]
): Promise<AutoVideoBatchResponse> {
  const res = await fetch("/api/auto-generate-product-videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ products }),
  });
  return jsonOrThrow<AutoVideoBatchResponse>(res);
}

/** Batch generate FULL galleries (3 photos per product: lifestyle hero +
 *  studio + lifestyle-warm). For real marketplaces buyers want multiple
 *  angles, not one photo. */
export async function autoGenerateProductGalleries(
  products: AutoPhotoInput[]
): Promise<AutoGalleryBatchResponse> {
  const res = await fetch("/api/auto-generate-product-gallery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ products }),
  });
  return jsonOrThrow<AutoGalleryBatchResponse>(res);
}

/** Upload a user-selected image file. Sends raw bytes (not multipart) to
 *  keep the server handler tiny — no busboy/formidable needed. */
export async function uploadProductImage(file: File): Promise<{ url: string; mediaType: string }> {
  const res = await fetch("/api/upload-product-image", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Original-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  return jsonOrThrow<{ url: string; mediaType: string }>(res);
}

/** Upload a base64 data URL (e.g. from a canvas snapshot) as an image. */
export async function uploadProductImageDataUrl(
  dataUrl: string,
  name = "mesh-snapshot"
): Promise<{ url: string; mediaType: string }> {
  // dataUrl format: "data:image/png;base64,iVBORw0KGgo..."
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) throw new Error("invalid data URL");
  const [, mime, b64] = match;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const ext = mime.split("/")[1] ?? "png";
  const res = await fetch("/api/upload-product-image", {
    method: "POST",
    headers: {
      "Content-Type": mime,
      "X-Original-Name": encodeURIComponent(`${name}.${ext}`),
    },
    body: blob,
  });
  return jsonOrThrow<{ url: string; mediaType: string }>(res);
}

// ── Storefront design (Phase 1.5: Lovable-style site generation) ──────
export interface DesignStorefrontInput {
  storeBasics: {
    storeName: string;
    tagline?: string;
    about?: string;
    paletteHint?: { primary: string; accent: string; text: string; muted: string };
  };
  designBrief?: string;
  referenceUrls?: string[];
  inspirationImages?: string[];
  products?: Array<{
    title: string;
    price_cents: number;
    spec_json?: { category?: string; primary_material?: string };
    hero_image_url?: string;
    hero_video_url?: string;
  }>;
  priorHtml?: string | null;
  userMessage?: string | null;
  chatHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface DesignStorefrontResponse {
  ok: true;
  html: string;
  summary: string;
  design_notes: string[];
  elapsed_ms: number;
}

export async function designStorefrontApi(
  input: DesignStorefrontInput
): Promise<DesignStorefrontResponse> {
  const res = await fetch("/api/design-storefront", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<DesignStorefrontResponse>(res);
}

// ── Analytics: fire-and-forget event tracker ──────────────────────────
// Server enriches with geo + IP hash, then echoes the enriched payload.
// The client then inserts into Supabase under the anon key (RLS-permitted).
// Fire-and-forget — errors are swallowed; analytics must never break UX.
export interface TrackEventResponse {
  ok: true;
  event: {
    store_slug: string;
    event_type: string;
    product_id: string | null;
    country: string | null;
    country_name: string | null;
    city: string | null;
    region: string | null;
    referrer: string | null;
    user_agent: string | null;
    ip_hash: string | null;
    session_id: string | null;
  };
}

export async function enrichEvent(input: {
  store_slug: string;
  event_type:
    | "store_view"
    | "product_view"
    | "add_to_cart"
    | "checkout_started"
    | "purchase_complete";
  product_id?: string;
  referrer?: string;
  session_id?: string;
}): Promise<TrackEventResponse | null> {
  try {
    const res = await fetch("/api/track-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status !== 200) return null;
    return (await res.json()) as TrackEventResponse;
  } catch {
    return null;
  }
}

export interface PlaceInRoomResponse {
  image: ImageRef;
}

// Generate a custom room background from a text description via OpenAI
// gpt-image-1. Slower than picking a default (15–60 s) and costs ~$0.04.
export async function generateRoomImage(description: string): Promise<{ image: ImageRef }> {
  const res = await fetch("/api/generate-room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return jsonOrThrow<{ image: ImageRef }>(res);
}

export interface GeneratedRoomMesh {
  category: string;
  prompt: string;
  mesh_url: string;
  content_type?: string;
  file_size?: number;
  source_field?: string;
  source_image_url?: string;
  cached: boolean;
}

// Generate (or fetch the cached) AI-built 3D room mesh for a category.
// Pipeline: gpt-image-1 (dollhouse render) → Hunyuan3D (image-to-mesh) →
// GLB URL. First call per category takes 1–3 min and costs ~$0.35; the
// backend caches the URL to disk so subsequent calls return instantly.
export async function generateRoomMesh(
  category: string,
  opts?: { force?: boolean; prompt?: string }
): Promise<GeneratedRoomMesh> {
  const res = await fetch("/api/generate-room-mesh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category,
      force: opts?.force ?? false,
      prompt: opts?.prompt ?? null,
    }),
  });
  return jsonOrThrow<GeneratedRoomMesh>(res);
}

export async function listGeneratedRoomMeshes(): Promise<{
  rooms: Record<string, GeneratedRoomMesh>;
}> {
  const res = await fetch("/api/room-meshes");
  return jsonOrThrow(res);
}

// ─── Room scan (video → SLAM3R → SpatialLM → layout) ────────────────────

export interface ScannedRoomLayout {
  walls: Array<{
    id: string;
    ax: number; ay: number; az: number;
    bx: number; by: number; bz: number;
    height: number; thickness: number;
  }>;
  doors: Array<{
    id: string;
    wall_id: string;
    position_x: number; position_y: number; position_z: number;
    width: number; height: number;
  }>;
  windows: Array<{
    id: string;
    wall_id: string;
    position_x: number; position_y: number; position_z: number;
    width: number; height: number;
  }>;
  bboxes: Array<{
    id: string;
    class: string;
    position_x: number; position_y: number; position_z: number;
    angle_z: number;
    scale_x: number; scale_y: number; scale_z: number;
  }>;
}

export interface ScanRoomJobStatus {
  jobId: string;
  status: "queued" | "uploading" | "processing" | "done" | "error";
  message?: string;
  filename?: string;
  sizeBytes?: number;
  createdAt?: number;
  finishedAt?: number | null;
  result?: {
    ok: boolean;
    job_id: string;
    layout: ScannedRoomLayout;
    artifacts?: {
      point_cloud?: string;
      raw_layout?: string;
    };
  } | null;
  error?: string | null;
}

// Upload a recorded room video. Returns the jobId immediately; the actual
// reconstruction runs in the background on the GPU sidecar (~30–60 s).
// Use XHR (not fetch) so we can surface upload progress to the UI.
export function uploadRoomScan(
  videoBlob: Blob,
  filename: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/scan-room");
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
        }
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    // Build a minimal multipart body — one field, "video"
    const boundary = "----ariadne-scan-" + Math.random().toString(36).slice(2);
    xhr.setRequestHeader("Content-Type", `multipart/form-data; boundary=${boundary}`);
    const head =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="video"; filename="${filename}"\r\n` +
      `Content-Type: ${videoBlob.type || "video/mp4"}\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const enc = new TextEncoder();
    const headBuf = enc.encode(head);
    const tailBuf = enc.encode(tail);
    // Concatenate as a single Blob — preserves binary content of the video
    xhr.send(new Blob([headBuf, videoBlob, tailBuf]));
  });
}

export async function getScanRoomStatus(jobId: string): Promise<ScanRoomJobStatus> {
  const res = await fetch(`/api/scan-room/${encodeURIComponent(jobId)}`);
  return jsonOrThrow<ScanRoomJobStatus>(res);
}

// Splat-tier scan upload (Nerfstudio Splatfacto on GPU sidecar). Same
// multipart contract as uploadRoomScan, just hits a different endpoint
// that dispatches to SPLAT_SIDECAR_URL on the Node side.
export function uploadRoomScanSplat(
  videoBlob: Blob,
  filename: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ jobId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/scan-room-splat");
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
        }
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    const boundary = "----ariadne-splat-" + Math.random().toString(36).slice(2);
    xhr.setRequestHeader("Content-Type", `multipart/form-data; boundary=${boundary}`);
    const head =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="video"; filename="${filename}"\r\n` +
      `Content-Type: ${videoBlob.type || "video/mp4"}\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const enc = new TextEncoder();
    xhr.send(new Blob([enc.encode(head), videoBlob, enc.encode(tail)]));
  });
}

// FREE-TIER room scan — Trellis multi-image-to-3D directly from the
// user's video frames. Trellis was trained for multi-view scene
// reconstruction so it actually USES the multiple angles (unlike
// Hunyuan, which was object-centric and produced Roblox-lego output
// for rooms). Furniture in the source frames stays in the mesh.
//   1. Browser extracts up to 10 diverse frames from the video
//   2. Backend uploads them to Fal storage and calls Trellis multi-image
//   3. Get back a GLB of the user's actual room with furniture
//   4. Rehost locally for fast loading
// ~$0.30 per scan, ~30-60 s. No GPU required.
export interface RoomTheme {
  floorColor?: string;
  wallColor?: string;
  ceilingColor?: string;
  floorMaterial?: string;
  overallStyle?: string;
}

export interface PhotoScanResult {
  ok: boolean;
  scan_id: string;
  elapsed_ms?: number;
  /** Local URL to the GLB mesh of the user's room. */
  mesh_url: string;
  fal_url?: string;
  file_size?: number;
  model?: string;
  frames_used?: number;
}

export async function scanRoomFromPhotos(
  photos: ImageRef[],
  description?: string
): Promise<PhotoScanResult> {
  const res = await fetch("/api/generate-room-from-photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photos, description: description ?? null }),
  });
  return jsonOrThrow<PhotoScanResult>(res);
}

export async function placeInRoom(
  furnitureImage: ImageRef,
  roomImage?: ImageRef,
  roomDescription?: string
): Promise<PlaceInRoomResponse> {
  const res = await fetch("/api/place-in-room", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      furniture_image: furnitureImage,
      room_image: roomImage ?? null,
      room_description: roomDescription ?? null,
    }),
  });
  return jsonOrThrow<PlaceInRoomResponse>(res);
}

export async function clearSessionOnServer(sessionId: string): Promise<void> {
  await fetch(`/api/session?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}
