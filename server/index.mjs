import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Agent as UndiciAgent } from "undici";

// Force HTTP/1.1 for sidecar uploads. Node 24+ auto-negotiates HTTP/2 over
// ALPN, but the RunPod public HTTP proxy mishandles large multipart H2
// uploads (NGHTTP2_PROTOCOL_ERROR mid-stream). HTTP/1.1 transfers fine.
// Per-request dispatcher only — global fetch (Anthropic/OpenAI/Fal) keeps H2.
const sidecarDispatcher = new UndiciAgent({
  allowH2: false,
  connectTimeout: 30_000,
  headersTimeout: 600_000,
  bodyTimeout: 600_000,
});

// Load .env BEFORE any module that reads process.env. Node's built-in
// process.loadEnvFile() does NOT override variables that already exist in the
// shell environment, which silently breaks setups where the shell has an
// empty ANTHROPIC_API_KEY=''. We override unconditionally so .env is the
// source of truth in development.
function loadDotenvOverriding(path) {
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { loaded: false, count: 0 };
    throw e;
  }
  let count = 0;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
    count++;
  }
  return { loaded: true, count };
}

const envResult = loadDotenvOverriding(".env");
if (envResult.loaded) {
  console.log(`[ariadne-backend] loaded .env (${envResult.count} variable${envResult.count === 1 ? "" : "s"})`);
}

import { listTemplates } from "./templates.mjs";
import { generateModel as runGenerator } from "./generator.mjs";
import { getModel, setModel, updatePart, clearSession } from "./store.mjs";
import { interpretEditWithKeywords } from "./editInterpreter.mjs";
import {
  interpretEditWithLLM,
  isLLMConfigured,
  LLMUnavailable,
  ALLOWED_MODELS,
  DEFAULT_GENERATION_MODEL,
  DEFAULT_EDIT_MODEL,
} from "./llm.mjs";
import { imageToMesh, multiImageToMesh, isFalConfigured } from "./fal.mjs";
import {
  compositeRoomPhotosForMesh,
  generateRoomImage,
  generateRoomImageForMesh,
  isOpenAIConfigured,
  placeInRoom,
} from "./openaiImage.mjs";
import {
  getCachedRoomMesh,
  setCachedRoomMesh,
  listCachedRoomMeshes,
  downloadAndHostGlb,
} from "./roomMeshCache.mjs";
import { generateSpec } from "./specGenerator.mjs";
import { generateCadBundle } from "./cadGenerator.mjs";
import { generateLogo, generateHeroImage } from "./storeAssets.mjs";
import { lookupGeo, hashIp, clientIp } from "./geoip.mjs";
import {
  generateProductPhoto,
  saveUploadedProductImage,
  generateProductPhotosBatch,
  generateProductGalleryBatch,
} from "./productImages.mjs";
import { generateProductVideosBatch } from "./productVideos.mjs";
import { designStorefront } from "./storeDesigner.mjs";
import { generateDashboardInsights } from "./dashboardInsights.mjs";
import { createJob, getJob, updateJob } from "./roomScanJobs.mjs";
import {
  analyzeRoomFrames,
  claudeAnalysisToLayout,
  descriptionToPrompt,
  isAnthropicConfigured,
} from "./roomAnalyzer.mjs";

const PORT = Number(process.env.PORT) || 3001;
// URL of the Python sidecar that wraps SLAM3R + SpatialLM. Defaults to
// localhost:8000 (fine for `runpodctl port-forward` during dev); in
// production point at the RunPod pod's public HTTPS endpoint.
const SCAN_SIDECAR_URL = process.env.SCAN_SIDECAR_URL || "http://localhost:8000";
// Optional dedicated splat sidecar (Gaussian Splatting via Nerfstudio).
// If unset, /api/scan-room-splat falls back to SCAN_SIDECAR_URL — fine
// when you've only deployed one sidecar.
const SPLAT_SIDECAR_URL = process.env.SPLAT_SIDECAR_URL || SCAN_SIDECAR_URL;
const MAX_SCAN_UPLOAD_BYTES = Number(
  process.env.MAX_SCAN_UPLOAD_BYTES || 200 * 1024 * 1024 // 200 MB
);

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// Buffer a request body to a Buffer, with a max-size guard. Used for the
// scan-room video upload, which we forward as-is to the sidecar.
function readBinaryBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        reject(
          new Error(
            `payload too large: ${(size / 1024 / 1024).toFixed(1)} MB (max ${(maxBytes / 1024 / 1024).toFixed(0)} MB)`
          )
        );
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Forward the buffered upload to the Python sidecar's /scan endpoint and
// then poll its /status/{job_id} until done. The sidecar's /scan returns
// immediately with a job_id (HTTP 202) — the heavy pipeline (~12-18 min)
// runs in a background thread on the GPU box. Long-polling here would hit
// Cloudflare's ~100s proxy timeout.
async function dispatchScanToSidecar(jobId, body, contentType, sidecarUrl = SCAN_SIDECAR_URL) {
  updateJob(jobId, { status: "processing", message: "uploading to GPU sidecar" });
  try {
    // Step 1: upload — sidecar returns quickly with sidecar_job_id
    const res = await fetch(`${sidecarUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
      dispatcher: sidecarDispatcher,
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (!res.ok || !parsed?.job_id) {
      updateJob(jobId, {
        status: "error",
        error: parsed?.detail || text.slice(0, 500) || `HTTP ${res.status}`,
      });
      return;
    }
    const sidecarJobId = parsed.job_id;
    updateJob(jobId, { message: `queued on GPU (${sidecarJobId})` });

    // Step 2: poll /status/{job_id} every 10s. Max wait: 30 min.
    const POLL_INTERVAL_MS = 10_000;
    const MAX_POLLS = (30 * 60_000) / POLL_INTERVAL_MS;
    let status = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const sres = await fetch(`${sidecarUrl}/status/${sidecarJobId}`, {
          dispatcher: sidecarDispatcher,
        });
        if (!sres.ok) continue; // transient 502s while pod is busy — keep trying
        status = await sres.json();
      } catch (pollErr) {
        // Transient network blip — log and continue. Real failures show up as
        // status='error' from the sidecar itself.
        console.warn(`[ariadne] poll blip: ${pollErr.message}`);
        continue;
      }
      if (status.message) {
        updateJob(jobId, { message: `sidecar: ${status.message}` });
      }
      if (status.status === "done" || status.status === "error") break;
    }
    if (!status || (status.status !== "done" && status.status !== "error")) {
      updateJob(jobId, { status: "error", error: "sidecar timed out after 30 min" });
      return;
    }
    if (status.status === "error") {
      updateJob(jobId, { status: "error", error: status.error || "sidecar error" });
      return;
    }

    // Step 3: download the .splat and rehost locally
    if (status.splat_url) {
      try {
        const splatRemote = new URL(status.splat_url, sidecarUrl).toString();
        const splatRes = await fetch(splatRemote, { dispatcher: sidecarDispatcher });
        if (splatRes.ok) {
          const buf = Buffer.from(await splatRes.arrayBuffer());
          const localName = `user-splat-${jobId}.splat`;
          const localPath = `public/rooms/${localName}`;
          const { mkdirSync, writeFileSync } = await import("node:fs");
          mkdirSync("public/rooms", { recursive: true });
          writeFileSync(localPath, buf);
          status.local_splat_url = `/rooms/${localName}`;
          status.file_size = buf.length;
        }
      } catch (e) {
        console.warn(`[ariadne] splat rehost failed: ${e.message}`);
      }
    }
    updateJob(jobId, { status: "done", message: "ready", result: status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause = e instanceof Error && e.cause ? String(e.cause) : null;
    console.error(`[ariadne] dispatchScanToSidecar failed:`, msg, cause ? `\n  cause: ${cause}` : "", e);
    updateJob(jobId, {
      status: "error",
      error: cause ? `${msg} (cause: ${cause})` : msg,
    });
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function interpret(part, prompt, modelOverride) {
  if (isLLMConfigured()) {
    try {
      const result = await interpretEditWithLLM(part, prompt, modelOverride);
      const tag = modelOverride && ALLOWED_MODELS.includes(modelOverride)
        ? modelOverride
        : DEFAULT_EDIT_MODEL;
      return { override: result, source: `anthropic-claude (${tag})` };
    } catch (e) {
      if (e instanceof LLMUnavailable) {
        // Shouldn't happen since isLLMConfigured guards it, but fall through.
      } else {
        console.warn("[ariadne] LLM failed, falling back to keywords:", e.message);
      }
    }
  }
  const result = interpretEditWithKeywords(part, prompt);
  return { override: result, source: "keyword-fallback" };
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      service: "ariadne-backend",
      llm: isLLMConfigured() ? "anthropic-claude" : "keyword-fallback",
      llm_available: isLLMConfigured(),
      fal_available: isFalConfigured(),
      openai_available: isOpenAIConfigured(),
      photoreal_mesh: isFalConfigured()
        ? "fal-ai/hunyuan-3d/v3.1/pro"
        : "not-configured",
      image_gen: isOpenAIConfigured() ? "openai/gpt-image-1" : "not-configured",
      mode: isLLMConfigured() ? "freeform" : "templates",
      templates: listTemplates(),
      models: ALLOWED_MODELS,
      default_generation_model: DEFAULT_GENERATION_MODEL,
      default_edit_model: DEFAULT_EDIT_MODEL,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/model") {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      json(res, 400, { error: "missing sessionId" });
      return;
    }
    json(res, 200, { model: getModel(sessionId) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const {
      sessionId,
      prompt,
      image,
      reference_image_url: referenceImageUrl,
      model: requestedModel,
      quality_preset: qualityPreset,
    } = body;
    if (!sessionId || typeof prompt !== "string") {
      json(res, 400, { error: "missing sessionId or prompt" });
      return;
    }
    const ALLOWED_PRESETS = ["max", "draft", "textureless"];
    if (
      qualityPreset !== undefined &&
      qualityPreset !== null &&
      !ALLOWED_PRESETS.includes(qualityPreset)
    ) {
      json(res, 400, {
        error: `quality_preset must be one of ${ALLOWED_PRESETS.join(", ")}`,
      });
      return;
    }
    if (
      requestedModel !== undefined &&
      requestedModel !== null &&
      !ALLOWED_MODELS.includes(requestedModel)
    ) {
      json(res, 400, {
        error: `model must be one of ${ALLOWED_MODELS.join(", ")}`,
      });
      return;
    }
    if (image !== undefined && image !== null) {
      if (
        typeof image !== "object" ||
        typeof image.mediaType !== "string" ||
        typeof image.data !== "string" ||
        !/^image\/(png|jpe?g|gif|webp)$/.test(image.mediaType)
      ) {
        json(res, 400, {
          error:
            "invalid image — must be { mediaType: 'image/png|jpeg|gif|webp', data: 'base64...' }",
        });
        return;
      }
    }
    // If a reference image URL was supplied (rebuild flow), fetch it back into
    // a base64 image we can pass to OpenAI edit / Hunyuan as if the user had
    // just uploaded it.
    let workingImage = image ?? null;
    if (!workingImage && typeof referenceImageUrl === "string" && referenceImageUrl) {
      try {
        const fetched = await fetch(referenceImageUrl);
        if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
        const buf = Buffer.from(await fetched.arrayBuffer());
        const ct = fetched.headers.get("content-type") || "image/png";
        workingImage = {
          mediaType: ct.split(";")[0],
          data: buf.toString("base64"),
        };
      } catch (e) {
        console.warn(
          "[ariadne] failed to fetch reference_image_url:",
          e.message
        );
      }
    }
    try {
      const { model, source } = await runGenerator(
        prompt,
        workingImage,
        requestedModel,
        qualityPreset ?? "draft"
      );
      setModel(sessionId, model);
      json(res, 200, {
        model,
        generator_source: source,
        available_templates: listTemplates(),
        llm_available: isLLMConfigured(),
      });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/edit") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const { sessionId, selected_part, edit, model: requestedModel } = body;
    if (!sessionId || !selected_part || typeof edit !== "string") {
      json(res, 400, { error: "missing sessionId, selected_part, or edit" });
      return;
    }
    if (
      requestedModel !== undefined &&
      requestedModel !== null &&
      !ALLOWED_MODELS.includes(requestedModel)
    ) {
      json(res, 400, {
        error: `model must be one of ${ALLOWED_MODELS.join(", ")}`,
      });
      return;
    }
    const model = getModel(sessionId);
    if (!model) {
      json(res, 404, { error: "no model for session — call /api/generate first" });
      return;
    }
    const part = model.parts.find((p) => p.id === selected_part);
    if (!part) {
      json(res, 400, { error: `unknown part: ${selected_part}` });
      return;
    }

    try {
      const { override, source } = await interpret(part, edit, requestedModel);
      const updated = updatePart(sessionId, selected_part, override);
      json(res, 200, {
        model: updated,
        change: { part_id: selected_part, override },
        source,
      });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/spec") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const {
      sessionId,
      bbox_mm,
      image,
      prompt: promptOverride,
      model: requestedModel,
    } = body;
    if (!sessionId) {
      json(res, 400, { error: "missing sessionId" });
      return;
    }
    if (
      !bbox_mm ||
      typeof bbox_mm.width_mm !== "number" ||
      typeof bbox_mm.height_mm !== "number" ||
      typeof bbox_mm.depth_mm !== "number"
    ) {
      json(res, 400, { error: "missing bbox_mm with {width_mm, height_mm, depth_mm}" });
      return;
    }
    if (!isLLMConfigured()) {
      json(res, 503, { error: "ANTHROPIC_API_KEY not configured" });
      return;
    }
    // Prefer the session model's prompt; fall back to a prompt provided in
    // the request body. This keeps spec generation working for sessions
    // where the model is rendered without going through /api/generate (e.g.
    // dev shortcuts, future "load saved mesh" flows).
    const sessionModel = getModel(sessionId);
    const prompt = sessionModel?.prompt || promptOverride;
    if (!prompt) {
      json(res, 400, {
        error: "no prompt available — either generate a model first or include 'prompt' in the request",
      });
      return;
    }
    try {
      const spec = await generateSpec({
        prompt,
        bboxMm: bbox_mm,
        image: image ?? null,
        model: requestedModel,
      });
      if (sessionModel) sessionModel.spec = spec;
      json(res, 200, { spec });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Generate manufacturable CAD bundle from a furniture spec ──────────
  //
  // POST /api/generate-cad   body: { spec, sessionId? }
  //   Runs the Python build123d service to produce STEP + DXF + cutlist
  //   + BOM. Returns { zipUrl, summary }.
  //
  //   The frontend triggers this when the user clicks "Finalize for
  //   Manufacturing" — i.e. after they've approved the mesh and the spec
  //   has been refined. The bundle is what the user emails to a furniture
  //   maker / sends to a CNC shop.
  //
  //   Output is at public/cad/<id>.zip — Vite serves it as /cad/<id>.zip.
  if (req.method === "POST" && url.pathname === "/api/generate-cad") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    let spec = body?.spec;
    // Allow sessionId-only lookups (frontend doesn't have to re-send the spec).
    if (!spec && body?.sessionId) {
      const sessionModel = getModel(body.sessionId);
      spec = sessionModel?.spec;
    }
    if (!spec || typeof spec !== "object" || !spec.category) {
      json(res, 400, {
        error: "missing spec — provide { spec } or { sessionId } for a session whose spec is set",
      });
      return;
    }
    try {
      const t0 = Date.now();
      const result = await generateCadBundle(spec);
      console.log(
        `[ariadne] cad bundle: ${spec.category} → ${result.zipUrl} ` +
        `(${result.summary.part_count} parts, ${result.elapsedMs}ms, ` +
        `${(result.summary.zip_size_bytes / 1024).toFixed(1)} KB)`
      );
      json(res, 200, {
        ok: true,
        zip_url: result.zipUrl,
        summary: result.summary,
        elapsed_ms: result.elapsedMs,
      });
    } catch (e) {
      console.error("[ariadne] generate-cad failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Marketplace: generate brand logo via gpt-image-1 ──────────────────
  //
  // POST /api/generate-logo  body: { storeName, tagline?, style?, vibe?, bgColor? }
  // Returns { url, mediaType, prompt } — image written to public/store-assets/.
  if (req.method === "POST" && url.pathname === "/api/generate-logo") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    if (!body?.storeName || typeof body.storeName !== "string") {
      json(res, 400, { error: "missing storeName" });
      return;
    }
    try {
      const result = await generateLogo({
        storeName: body.storeName.slice(0, 60),
        tagline: body.tagline?.slice(0, 120),
        style: body.style ?? "wordmark",
        vibe: body.vibe?.slice(0, 120) ?? "minimal modern",
        bgColor: body.bgColor ?? "#ffffff",
      });
      console.log(`[ariadne] logo generated for "${body.storeName}" → ${result.url}`);
      json(res, 200, result);
    } catch (e) {
      console.error("[ariadne] generate-logo failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Marketplace: generate brand hero image via gpt-image-1 ────────────
  if (req.method === "POST" && url.pathname === "/api/generate-hero") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    if (!body?.storeName) {
      json(res, 400, { error: "missing storeName" });
      return;
    }
    try {
      const result = await generateHeroImage({
        storeName: body.storeName.slice(0, 60),
        vibe: body.vibe?.slice(0, 120) ?? "warm minimal",
        primaryProduct: body.primaryProduct?.slice(0, 120) ?? "",
      });
      console.log(`[ariadne] hero generated for "${body.storeName}" → ${result.url}`);
      json(res, 200, result);
    } catch (e) {
      console.error("[ariadne] generate-hero failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Marketplace: generate a product hero photo via gpt-image-1 ────────
  if (req.method === "POST" && url.pathname === "/api/generate-product-photo") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    if (!body?.title) {
      json(res, 400, { error: "missing title" });
      return;
    }
    try {
      const result = await generateProductPhoto({
        title: body.title.slice(0, 100),
        description: body.description?.slice(0, 300) ?? "",
        category: body.category?.slice(0, 40) ?? "",
        material: body.material?.slice(0, 60) ?? "",
        style: body.style ?? "lifestyle",
      });
      console.log(`[ariadne] product photo generated for "${body.title}" → ${result.url}`);
      json(res, 200, result);
    } catch (e) {
      console.error("[ariadne] generate-product-photo failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Dashboard AI insights ─────────────────────────────────────────────
  //
  // POST /api/dashboard-insights  body: { metrics: { ... } }
  // Returns 2-3 bulleted insights from Claude Haiku. Real numbers in,
  // actionable text out.
  if (req.method === "POST" && url.pathname === "/api/dashboard-insights") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    if (!body?.metrics || typeof body.metrics !== "object") {
      json(res, 400, { error: "missing metrics object" });
      return;
    }
    try {
      const result = await generateDashboardInsights(body.metrics);
      json(res, 200, { ok: true, ...result });
    } catch (e) {
      console.error("[ariadne] dashboard-insights failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Lovable-style storefront design (Phase 1.5) ───────────────────────
  //
  // POST /api/design-storefront
  // body: {
  //   designBrief, referenceUrls, inspirationImages, products, storeBasics,
  //   priorHtml?, userMessage?, chatHistory?
  // }
  // Returns: { html, summary, design_notes }
  //
  // Blocking — Claude Sonnet 4.6 with 16k max tokens typically takes
  // 30s-3min depending on extended thinking. The frontend shows a long
  // loading state, just like Lovable does.
  if (req.method === "POST" && url.pathname === "/api/design-storefront") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    if (!body?.storeBasics?.storeName) {
      json(res, 400, { error: "missing storeBasics.storeName" });
      return;
    }
    try {
      const t0 = Date.now();
      const result = await designStorefront({
        designBrief: typeof body.designBrief === "string" ? body.designBrief : "",
        referenceUrls: Array.isArray(body.referenceUrls) ? body.referenceUrls.slice(0, 8) : [],
        inspirationImages: Array.isArray(body.inspirationImages) ? body.inspirationImages.slice(0, 6) : [],
        products: Array.isArray(body.products) ? body.products.slice(0, 12) : [],
        storeBasics: {
          storeName: String(body.storeBasics.storeName).slice(0, 100),
          tagline: body.storeBasics.tagline?.slice?.(0, 200) ?? "",
          about: body.storeBasics.about?.slice?.(0, 1000) ?? "",
          paletteHint: body.storeBasics.paletteHint ?? null,
        },
        priorHtml: typeof body.priorHtml === "string" ? body.priorHtml : null,
        priorCss: typeof body.priorCss === "string" ? body.priorCss : null,
        userMessage: typeof body.userMessage === "string" ? body.userMessage : null,
        chatHistory: Array.isArray(body.chatHistory) ? body.chatHistory : [],
      });
      const elapsedMs = Date.now() - t0;
      console.log(
        `[ariadne] storefront designed for "${body.storeBasics.storeName}" ` +
        `(${result.html.length} chars HTML, ${elapsedMs}ms, ` +
        `in=${result.usage?.input_tokens} out=${result.usage?.output_tokens})`
      );
      json(res, 200, {
        ok: true,
        html: result.html,
        summary: result.summary,
        design_notes: result.design_notes,
        elapsed_ms: elapsedMs,
      });
    } catch (e) {
      console.error("[ariadne] design-storefront failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Marketplace: batch product photo generation ───────────────────────
  //
  // POST /api/auto-generate-product-photos
  // body: { products: [{ id, title, description?, category?, material?, style? }] }
  // Returns: { results: { [productId]: { url: string, error?: string } } }
  //
  // Used by the StoreDesignerPage to run gpt-image-1 in parallel with the
  // Claude site generator. Concurrency capped to 3 to respect rate limits.
  if (req.method === "POST" && url.pathname === "/api/auto-generate-product-photos") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    if (!Array.isArray(body?.products) || body.products.length === 0) {
      json(res, 400, { error: "missing products[] in body" });
      return;
    }
    try {
      const t0 = Date.now();
      const results = await generateProductPhotosBatch(body.products.slice(0, 20));
      const ms = Date.now() - t0;
      const ok = Object.values(results).filter((r) => r.url).length;
      console.log(
        `[ariadne] auto-photos batch: ${ok}/${body.products.length} succeeded in ${ms}ms`
      );
      json(res, 200, { results, elapsed_ms: ms });
    } catch (e) {
      console.error("[ariadne] auto-photos batch failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Marketplace: per-product cinematic video (Fal Seedance) ─────────
  if (req.method === "POST" && url.pathname === "/api/auto-generate-product-videos") {
    let body;
    try { body = await readJsonBody(req); } catch { json(res, 400, { error: "invalid json" }); return; }
    if (!Array.isArray(body?.products) || body.products.length === 0) {
      json(res, 400, { error: "missing products[] in body" });
      return;
    }
    try {
      const t0 = Date.now();
      const results = await generateProductVideosBatch(body.products.slice(0, 10));
      const ms = Date.now() - t0;
      const ok = Object.values(results).filter((r) => r.url).length;
      console.log(`[ariadne] video batch: ${ok}/${body.products.length} succeeded in ${ms}ms`);
      json(res, 200, { results, elapsed_ms: ms });
    } catch (e) {
      console.error("[ariadne] video batch failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Marketplace: batch GALLERY (3 photos per product) ────────────────
  if (req.method === "POST" && url.pathname === "/api/auto-generate-product-gallery") {
    let body;
    try { body = await readJsonBody(req); } catch { json(res, 400, { error: "invalid json" }); return; }
    if (!Array.isArray(body?.products) || body.products.length === 0) {
      json(res, 400, { error: "missing products[] in body" });
      return;
    }
    try {
      const t0 = Date.now();
      const results = await generateProductGalleryBatch(body.products.slice(0, 20));
      const ms = Date.now() - t0;
      const ok = Object.values(results).filter((r) => r.hero).length;
      console.log(`[ariadne] gallery batch: ${ok}/${body.products.length} succeeded in ${ms}ms`);
      json(res, 200, { results, elapsed_ms: ms });
    } catch (e) {
      console.error("[ariadne] gallery batch failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Marketplace: upload user-supplied product image ───────────────────
  //
  // Accepts raw image bytes (the browser sends a Blob with the right
  // Content-Type). Saves to public/store-assets/products/ and returns
  // the public URL. The frontend then stores that URL on the product row.
  if (req.method === "POST" && url.pathname === "/api/upload-product-image") {
    const contentType = req.headers["content-type"] || "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      json(res, 400, { error: "expected raw image bytes with image/* content-type" });
      return;
    }
    try {
      const chunks = [];
      const maxBytes = 12 * 1024 * 1024;
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) {
          json(res, 413, { error: "image too large (max 12 MB)" });
          return;
        }
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const originalName = decodeURIComponent(
        req.headers["x-original-name"]?.toString() ?? "image"
      );
      const result = saveUploadedProductImage(buffer, contentType, originalName);
      console.log(`[ariadne] product image uploaded → ${result.url} (${(buffer.length / 1024).toFixed(0)} KB)`);
      json(res, 200, result);
    } catch (e) {
      console.error("[ariadne] upload-product-image failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // ── Marketplace: analytics event ingestion ────────────────────────────
  //
  // POST /api/track-event  body: { store_slug, event_type, product_id?, referrer?, session_id? }
  // Server enriches with geo (from IP) + hashes IP. Writes to
  // analytics_events via a service-role client (no RLS bypass needed — RLS
  // allows anyone to insert events). Returns 204 on success; analytics
  // failures should never break the user's browsing experience.
  if (req.method === "POST" && url.pathname === "/api/track-event") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const ip = clientIp(req);
    try {
      const geo = await lookupGeo(ip);
      const event = {
        store_slug: String(body.store_slug || "").slice(0, 32),
        event_type: String(body.event_type || ""),
        product_id: body.product_id || null,
        country: geo.country,
        country_name: geo.country_name,
        city: geo.city,
        region: geo.region,
        referrer: typeof body.referrer === "string" ? body.referrer.slice(0, 500) : null,
        user_agent: typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"].slice(0, 500)
          : null,
        ip_hash: hashIp(ip),
        session_id: typeof body.session_id === "string" ? body.session_id.slice(0, 80) : null,
      };
      // Validate event_type matches the SQL check constraint
      const VALID = new Set([
        "store_view",
        "product_view",
        "add_to_cart",
        "checkout_started",
        "purchase_complete",
      ]);
      if (!VALID.has(event.event_type) || !event.store_slug) {
        res.statusCode = 204;
        res.end();
        return;
      }
      // Echo back the event payload to the client. The actual insert is
      // performed by the browser-side Supabase client (anon key) — keeps
      // this endpoint stateless and lets RLS govern access. The reason
      // we route through the server at all is to enrich with geo + hash
      // the IP without exposing the IP to the browser.
      json(res, 200, { ok: true, event });
    } catch (e) {
      // Analytics failures must NEVER 5xx the caller.
      console.warn("[ariadne] track-event soft-fail:", e?.message ?? e);
      res.statusCode = 204;
      res.end();
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/place-in-room") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const { furniture_image, room_image, room_description } = body;
    if (
      !furniture_image ||
      typeof furniture_image.data !== "string" ||
      typeof furniture_image.mediaType !== "string"
    ) {
      json(res, 400, {
        error: "missing furniture_image with { mediaType, data: base64 }",
      });
      return;
    }
    if (!isOpenAIConfigured()) {
      json(res, 503, { error: "OPENAI_API_KEY not configured" });
      return;
    }
    try {
      const composite = await placeInRoom(furniture_image, {
        roomImage: room_image ?? null,
        roomDescription: room_description ?? null,
      });
      json(res, 200, { image: composite });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate-room") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const { description } = body;
    if (!description || typeof description !== "string" || !description.trim()) {
      json(res, 400, { error: "missing description" });
      return;
    }
    if (!isOpenAIConfigured()) {
      json(res, 503, { error: "OPENAI_API_KEY not configured" });
      return;
    }
    try {
      const image = await generateRoomImage(description.trim());
      json(res, 200, { image });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // Per-category fixed prompts for AI-generated 3D rooms. Hard-coded
  // (not user-controlled) so the cache key is stable and we can refine
  // each room's "vibe" in one place.
  const ROOM_MESH_PROMPTS = {
    "home-3d":
      "A spacious empty modern living room with wide oak hardwood floors, white walls, tall floor-to-ceiling windows, soft natural light, and a small fireplace built into the back wall. No furniture in the middle — clear empty floor space ready for a sofa. About 8 by 6 meters.",
    "office-3d":
      "A spacious empty open-plan office interior. Polished concrete floors, exposed white walls, large industrial windows along one side, recessed ceiling lights. Two symmetrical rows of empty wooden desks along the side walls, leaving a wide empty aisle down the center for placing a single demo chair or desk. About 14 by 10 meters.",
    "restaurant-3d":
      "A spacious empty modern restaurant interior. Dark stained wood floors, warm cream-and-charcoal walls, a long polished bar counter along the back wall, brass pendant lights hanging in a symmetrical grid pattern, several empty round wooden dining tables arranged symmetrically along the sides leaving an empty central area for placing one demo chair. No people. About 14 by 10 meters.",
    "hospitality-3d":
      "A spacious empty grand hotel lobby. Polished marble floors, double-height ceilings, two tall columns flanking a central open space, a sleek wooden reception counter at the back, large arched windows letting in daylight. Generous empty floor space in the center for placing a single lounge chair or sofa. About 16 by 12 meters.",
  };

  if (req.method === "POST" && url.pathname === "/api/generate-room-mesh") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const { category, force, prompt: promptOverride } = body;
    if (!category || typeof category !== "string") {
      json(res, 400, { error: "missing category" });
      return;
    }
    if (!ROOM_MESH_PROMPTS[category] && !promptOverride) {
      json(res, 400, {
        error: `unknown category '${category}' — must be one of ${Object.keys(ROOM_MESH_PROMPTS).join(", ")} (or pass a 'prompt' override)`,
      });
      return;
    }
    // Cache hit: serve immediately unless force=true
    if (!force) {
      const cached = getCachedRoomMesh(category);
      if (cached?.mesh_url) {
        json(res, 200, { ...cached, cached: true });
        return;
      }
    }
    if (!isOpenAIConfigured()) {
      json(res, 503, { error: "OPENAI_API_KEY not configured" });
      return;
    }
    if (!isFalConfigured()) {
      json(res, 503, { error: "FAL_KEY not configured" });
      return;
    }
    const prompt = promptOverride || ROOM_MESH_PROMPTS[category];
    try {
      console.log(`[ariadne] generating 3D room mesh for ${category}…`);
      console.log(`[ariadne]   step 1: gpt-image-1 dollhouse render`);
      const image = await generateRoomImageForMesh(prompt);
      console.log(`[ariadne]   step 2: Hunyuan3D image-to-mesh`);
      const mesh = await imageToMesh(image, { faceCount: 250000 });
      console.log(`[ariadne]   step 3: download GLB to public/rooms`);
      const { localUrl, byteLength } = await downloadAndHostGlb(
        category,
        mesh.meshUrl
      );
      const entry = {
        category,
        prompt,
        // mesh_url is what the frontend loads — local for instant fetches
        mesh_url: localUrl,
        // Keep the upstream Fal URL as a fallback / audit trail
        fal_url: mesh.meshUrl,
        content_type: mesh.contentType,
        file_size: byteLength,
        source_field: mesh.sourceField,
        source_image_url: mesh.sourceImageUrl,
      };
      setCachedRoomMesh(category, entry);
      console.log(`[ariadne]   done: ${localUrl} (${(byteLength / 1024 / 1024).toFixed(1)} MB)`);
      json(res, 200, { ...entry, cached: false });
    } catch (e) {
      console.error("[ariadne] room mesh generation failed:", e);
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/room-meshes") {
    json(res, 200, { rooms: listCachedRoomMeshes() });
    return;
  }

  // ── FREE TIER: Photo-based room reconstruction ─────────────────────────
  // User uploads 1–4 photos of their actual room. We composite them into
  // a dollhouse-style render via gpt-image-1, then run Hunyuan to mesh it.
  // No GPU required. Costs ~$0.04 + $0.35 = ~$0.40 per scan. Quality is
  // single-view inference (Hunyuan hallucinates unseen sides), but it
  // captures the user's actual wall colors / window placement / floor.
  //
  // POST /api/generate-room-from-photos
  //   Body: { photos: [{mediaType, data}], description?: string }
  //   Returns: { mesh_url, source_image_url }
  if (
    req.method === "POST" &&
    url.pathname === "/api/generate-room-from-photos"
  ) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid json" });
      return;
    }
    const { photos, description } = body;
    if (!Array.isArray(photos) || photos.length === 0 || photos.length > 50) {
      json(res, 400, {
        error: "photos must be an array of 1-50 { mediaType, data } objects",
      });
      return;
    }
    for (const p of photos) {
      if (
        !p ||
        typeof p.mediaType !== "string" ||
        typeof p.data !== "string" ||
        !/^image\/(png|jpe?g|gif|webp)$/.test(p.mediaType)
      ) {
        json(res, 400, {
          error:
            "each photo must be { mediaType: 'image/png|jpeg|gif|webp', data: 'base64...' }",
        });
        return;
      }
    }
    if (!isOpenAIConfigured()) {
      json(res, 503, { error: "OPENAI_API_KEY not configured" });
      return;
    }
    if (!isFalConfigured()) {
      json(res, 503, { error: "FAL_KEY not configured" });
      return;
    }
    try {
      const start = Date.now();
      if (!isAnthropicConfigured()) {
        json(res, 503, { error: "ANTHROPIC_API_KEY not configured" });
        return;
      }
      if (!isOpenAIConfigured()) {
        json(res, 503, { error: "OPENAI_API_KEY not configured" });
        return;
      }
      if (!isFalConfigured()) {
        json(res, 503, { error: "FAL_KEY not configured" });
        return;
      }
      // ─── EXACTLY the same pipeline as the cached AI rooms ────────
      // The cached rooms (home-3d.glb, office-3d.glb, restaurant-3d.glb,
      // hospitality-3d.glb) came out clean because gpt-image-1 was
      // called via .generate() with a tight dollhouse-cutaway prompt —
      // Hunyuan got a clean "product on a white background" architectural
      // render and meshed it well.
      //
      // For user scans we do the SAME thing — Claude vision first
      // translates the user's photos into the prose description that
      // gpt-image-1.generate() needs, then the rest of the path is
      // identical to the cached-room pipeline.
      //
      // Why this works when .edit() didn't:
      //   - .edit() with raw photos produces messy composites that
      //     bias the output toward "stitched photograph" — Hunyuan can't
      //     mesh those without producing the Roblox-lego failure mode
      //   - .generate() produces a clean isolated render — that's what
      //     Hunyuan was trained on, so it meshes correctly

      console.log(
        `[ariadne] photo-scan: Claude analyzing ${photos.length} photos for room description…`
      );
      const analyzed = await analyzeRoomFrames(photos.slice(0, 50));
      const description = descriptionToPrompt(analyzed);
      console.log(
        `[ariadne] photo-scan: Claude done (${Date.now() - start}ms), ` +
          `confidence=${analyzed?.confidence ?? "?"}, ` +
          `description=${description.slice(0, 120)}…`
      );

      console.log(
        `[ariadne] photo-scan: gpt-image-1 GENERATE (same path as cached AI rooms)`
      );
      const userDesc = body.description?.trim();
      const richPrompt = [
        description,
        userDesc ? `Additional user notes: ${userDesc}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const image = await generateRoomImageForMesh(richPrompt);
      console.log(
        `[ariadne] photo-scan: gpt-image-1 done (${Date.now() - start}ms), meshing via Hunyuan`
      );

      const mesh = await imageToMesh(image, { faceCount: 250000 });
      console.log(
        `[ariadne] photo-scan: mesh done (${Date.now() - start}ms total), rehosting GLB`
      );
      const scanId = `user-scan-${Date.now().toString(36)}`;
      const { localUrl, byteLength } = await downloadAndHostGlb(
        scanId,
        mesh.meshUrl
      );
      json(res, 200, {
        ok: true,
        scan_id: scanId,
        elapsed_ms: Date.now() - start,
        mesh_url: localUrl,
        fal_url: mesh.meshUrl,
        file_size: byteLength,
        analyzed,
        analyzed_from_n_frames: photos.length,
        description,
      });
    } catch (e) {
      console.error("[ariadne] photo-scan failed:", e);
      // Surface upstream-API errors clearly so the user knows whether
      // it's their billing, our code, or a transient API hiccup.
      let errMsg = e instanceof Error ? e.message : String(e);
      const body = e?.body || e?.response?.data;
      if (body?.detail) errMsg = body.detail;
      else if (body?.error?.message) errMsg = body.error.message;
      // Fal.ai 403 / billing
      if (errMsg.toLowerCase().includes("exhausted balance") || errMsg.toLowerCase().includes("user is locked")) {
        json(res, 402, {
          error:
            "Out of Fal.ai credits — top up at https://fal.ai/dashboard/billing to continue. " +
            "Each photo-scan costs ~$0.30 in Fal credits (plus ~$0.34 in OpenAI + Anthropic).",
          upstream: "fal.ai",
          upstream_status: e?.status,
        });
        return;
      }
      // OpenAI billing or rate limit
      if (errMsg.toLowerCase().includes("insufficient_quota") || errMsg.toLowerCase().includes("billing_hard_limit")) {
        json(res, 402, {
          error:
            "Out of OpenAI credits — top up at https://platform.openai.com/settings/organization/billing.",
          upstream: "openai",
        });
        return;
      }
      // Anthropic billing
      if (errMsg.toLowerCase().includes("credit_balance") || errMsg.toLowerCase().includes("anthropic")) {
        json(res, 402, {
          error:
            "Out of Anthropic credits — top up at https://console.anthropic.com/settings/billing.",
          upstream: "anthropic",
        });
        return;
      }
      json(res, 500, { error: errMsg });
    }
    return;
  }

  // ── Room scanning (video → SLAM3R → SpatialLM → layout JSON) ───────────
  //
  // POST /api/scan-room
  //   Multipart upload. The Node side buffers the request body, returns a
  //   jobId immediately, and forwards to the Python sidecar in the
  //   background. The frontend polls /api/scan-room/:jobId for status.
  //
  // GET /api/scan-room/:jobId
  //   Returns { status, message, result?, error? }. Once status="done",
  //   `result.layout` is the structured walls/doors/windows/bboxes JSON.
  if (req.method === "POST" && url.pathname === "/api/scan-room") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/")) {
      json(res, 400, {
        error: "expected multipart/form-data with field 'video'",
      });
      return;
    }
    let body;
    try {
      body = await readBinaryBody(req, MAX_SCAN_UPLOAD_BYTES);
    } catch (e) {
      json(res, 413, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
    const jobId = Math.random().toString(36).slice(2, 14);
    createJob(jobId, {
      filename: "(video)",
      sizeBytes: body.length,
    });
    // Fire-and-forget: dispatch to sidecar, frontend polls for completion
    dispatchScanToSidecar(jobId, body, contentType);
    json(res, 202, {
      jobId,
      status: "processing",
      sidecar: SCAN_SIDECAR_URL,
    });
    return;
  }

  // ── Gaussian Splatting room scan (commercial-friendly photoreal path) ─
  //
  // POST /api/scan-room-splat
  //   Multipart video upload. Dispatched to the Gaussian Splatting
  //   sidecar (Nerfstudio + gsplat + Splatfacto — all Apache 2.0).
  //   Sidecar returns { splat_url, file_size }. We auto-rehost the
  //   .splat file to public/rooms/ for the browser viewer.
  //   Same /api/scan-room/:jobId polling endpoint for status.
  if (req.method === "POST" && url.pathname === "/api/scan-room-splat") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/")) {
      json(res, 400, {
        error: "expected multipart/form-data with field 'video'",
      });
      return;
    }
    let body;
    try {
      body = await readBinaryBody(req, MAX_SCAN_UPLOAD_BYTES);
    } catch (e) {
      json(res, 413, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
    const jobId = Math.random().toString(36).slice(2, 14);
    createJob(jobId, {
      filename: "(video → splat)",
      sizeBytes: body.length,
    });
    dispatchScanToSidecar(jobId, body, contentType, SPLAT_SIDECAR_URL);
    json(res, 202, {
      jobId,
      status: "processing",
      sidecar: SPLAT_SIDECAR_URL,
      pipeline: "splatfacto",
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/scan-room/")) {
    const jobId = url.pathname.slice("/api/scan-room/".length);
    const job = getJob(jobId);
    if (!job) {
      json(res, 404, { error: `no job: ${jobId}` });
      return;
    }
    json(res, 200, {
      jobId: job.id,
      status: job.status,
      message: job.message,
      filename: job.filename,
      sizeBytes: job.sizeBytes,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      result: job.result,
      error: job.error,
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/session") {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      json(res, 400, { error: "missing sessionId" });
      return;
    }
    clearSession(sessionId);
    json(res, 200, { ok: true });
    return;
  }

  res.statusCode = 404;
  res.end();
});

server.listen(PORT, () => {
  console.log(`[ariadne-backend] http://localhost:${PORT}`);
  console.log(
    `  interpreter: ${isLLMConfigured() ? "anthropic-claude (Haiku 4.5)" : "keyword-fallback (no ANTHROPIC_API_KEY)"}`
  );
  console.log(`  templates: ${listTemplates().join(", ")}`);
  console.log("  GET    /api/health");
  console.log("  GET    /api/model?sessionId=…");
  console.log("  POST   /api/generate { sessionId, prompt }");
  console.log("  POST   /api/edit     { sessionId, selected_part, edit }");
  console.log("  POST   /api/spec     { sessionId, bbox_mm, image? }");
  console.log("  POST   /api/place-in-room { furniture_image, room_image? }");
  console.log("  POST   /api/generate-room-from-photos { photos[] } → free-tier scan");
  console.log("  POST   /api/scan-room (multipart video) → SLAM3R/COLMAP sidecar");
  console.log("  POST   /api/scan-room-splat (multipart video) → Gaussian Splatting sidecar ★");
  console.log("  GET    /api/scan-room/:jobId → status");
  console.log(`  scan sidecar: ${SCAN_SIDECAR_URL}`);
  console.log(`  splat sidecar: ${SPLAT_SIDECAR_URL}`);
  console.log("  DELETE /api/session?sessionId=…");
});
