// Fal.ai image-to-3D via Hunyuan3D — same pipeline CADAM's "creative mode"
// uses for photoreal mesh generation from a reference image.
//
// Hunyuan3D Pro v3.1 outputs ~500K-face GLB meshes. Pro tier costs ~$0.20–
// $0.40/job; takes 30s–3min. We expose the synchronous `subscribe` flow so
// the caller awaits the final GLB URL.

import { fal } from "@fal-ai/client";

export class FalUnavailable extends Error {}

let _configured = false;
function configure() {
  if (_configured) return;
  if (!process.env.FAL_KEY) {
    throw new FalUnavailable("FAL_KEY not set");
  }
  fal.config({ credentials: process.env.FAL_KEY });
  _configured = true;
}

export function isFalConfigured() {
  return !!process.env.FAL_KEY;
}

// Default model — best quality. CADAM also uses tripo3d and meshy variants;
// add those as alternatives later if needed.
const HUNYUAN_PRO = "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d";

// Trellis (Microsoft) multi-image to 3D — the right tool for room scans.
// Hunyuan is object-centric and produces blocky "Roblox lego" output for
// interiors; Trellis was trained with multi-view scene reconstruction in
// mind and handles rooms much better. Takes 4-10 images of the same scene
// from different angles, builds a single mesh.
const TRELLIS_MULTI = "fal-ai/trellis/multi";

// Multi-image scene reconstruction via Trellis. Takes 4-10 images of the
// SAME room from different angles, returns a single GLB mesh of the room.
// Trellis was trained on multi-view scene data so it actually uses the
// multiple views — much better for interior architecture than Hunyuan's
// single-image object-focused inference.
export async function multiImageToMesh(images, opts = {}) {
  configure();
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("multiImageToMesh: need at least 1 image");
  }
  if (images.length > 10) {
    throw new Error(`multiImageToMesh: max 10 images, got ${images.length}`);
  }

  // Upload each image to Fal storage so Trellis can fetch by URL.
  const imageUrls = await Promise.all(
    images.map(async (img, i) => {
      const buffer = Buffer.from(img.data, "base64");
      const blob = new Blob([buffer], { type: img.mediaType });
      const ext = img.mediaType.split("/")[1] || "jpg";
      const file = new File([blob], `ariadne-room-${Date.now()}-${i}.${ext}`, {
        type: img.mediaType,
      });
      return await fal.storage.upload(file);
    })
  );

  const result = await fal.subscribe(TRELLIS_MULTI, {
    input: {
      image_urls: imageUrls,
      // Quality knobs — Trellis defaults are reasonable; bumping these
      // gives a more detailed mesh at higher cost / latency.
      ss_sampling_steps: opts.ssSteps ?? 12,
      slat_sampling_steps: opts.slatSteps ?? 12,
      mesh_simplify: opts.meshSimplify ?? 0.95,
      texture_size: opts.textureSize ?? 1024,
    },
    logs: false,
  });

  const data = result.data ?? {};
  const extracted = extractGlbUrl(data);
  if (!extracted) {
    throw new Error(
      `Trellis returned no GLB URL. Top-level keys: [${Object.keys(data).join(", ")}]. Response: ${JSON.stringify(data).slice(0, 500)}`
    );
  }
  return {
    meshUrl: extracted.url,
    contentType: extracted.contentType,
    fileSize: extracted.fileSize,
    sourceField: extracted.field,
    requestId: result.requestId,
    sourceImageUrls: imageUrls,
    model: TRELLIS_MULTI,
  };
}

export async function imageToMesh(image, opts = {}) {
  configure();
  const { mediaType, data } = image;
  const buffer = Buffer.from(data, "base64");

  // Upload to Fal's signed storage so Hunyuan can fetch by URL.
  const blob = new Blob([buffer], { type: mediaType });
  const file = new File([blob], `ariadne-${Date.now()}.${mediaType.split("/")[1]}`, {
    type: mediaType,
  });
  const inputImageUrl = await fal.storage.upload(file);

  const result = await fal.subscribe(HUNYUAN_PRO, {
    input: {
      input_image_url: inputImageUrl,
      enable_pbr: true,
      face_count: opts.faceCount ?? 200000,
    },
    logs: false,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS" || update.status === "IN_QUEUE") {
        // No-op; could surface progress via SSE later.
      }
    },
  });

  // Different Fal models return the GLB under different field names. This
  // priority order is taken directly from CADAM's fal-webhook handler so we
  // cover Hunyuan v3.1 Pro / Meshy v6 / Tripo v2.5 / Rodin / Trellis.
  const data2 = result.data ?? {};
  const extracted = extractGlbUrl(data2);
  if (!extracted) {
    throw new Error(
      `Fal returned no GLB URL. Top-level keys: [${Object.keys(data2).join(", ")}]. Response: ${JSON.stringify(data2).slice(0, 500)}`
    );
  }

  return {
    meshUrl: extracted.url,
    contentType: extracted.contentType,
    fileSize: extracted.fileSize,
    sourceField: extracted.field,
    requestId: result.requestId,
    sourceImageUrl: inputImageUrl,
  };
}

// Extract the GLB URL + metadata from a Fal mesh-gen response payload. Order
// matches CADAM's fal-webhook/index.ts (lines 151-180): each Fal model puts
// the result under a different key.
function extractGlbUrl(payload) {
  const candidates = [
    ["model_glb", payload.model_glb], // Hunyuan v3.1 Pro, Meshy v6, SAM 3D Objects
    ["model_urls.glb", payload.model_urls?.glb], // Hunyuan v3.1 Pro alt
    ["textured_glb", payload.textured_glb], // Rodin v2 textured
    ["output_glb", payload.output_glb], // Rodin v2 output
    ["glb", payload.glb], // generic (object form)
    ["model_mesh", payload.model_mesh], // Tripo v2.5, Trellis
    ["base_model", payload.base_model], // Tripo v2.5 textureless
  ];
  for (const [field, value] of candidates) {
    if (value?.url) {
      return {
        field,
        url: value.url,
        contentType: value.content_type ?? "model/gltf-binary",
        fileSize: value.file_size,
      };
    }
  }
  // Direct string form
  if (typeof payload.glb === "string") {
    return {
      field: "glb (string)",
      url: payload.glb,
      contentType: "model/gltf-binary",
      fileSize: undefined,
    };
  }
  return null;
}
