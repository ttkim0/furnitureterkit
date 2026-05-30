// OpenAI image generation + editing via gpt-image-1.
//
// Used as a pre-step before Hunyuan3D when:
//   - The user gave only a text description (no reference image): we generate
//     a studio product photo from the text, then mesh it.
//   - The user gave an image + text edit ("but with leather", "but one more
//     seat"): we edit the reference image with the text instructions, then
//     mesh the modified image.
//
// gpt-image-1 always returns base64-encoded PNGs. ~$0.04/image at medium
// quality, ~$0.17 at high quality.

import OpenAI from "openai";
import { toFile } from "openai/uploads";

export class OpenAIUnavailable extends Error {}

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) {
    throw new OpenAIUnavailable("OPENAI_API_KEY not set");
  }
  _client = new OpenAI();
  return _client;
}

export function isOpenAIConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

const FURNITURE_STYLE_SUFFIX = `

Studio product photograph. Clean white background. Soft, neutral lighting from the upper-front. The object is centered and fully in-frame with about 10% padding around all edges. Soft shadow directly underneath. No text, no UI, no people, no other props in the scene. Single object only.`;

const EDIT_PROMPT_PREFIX = `Modify this furniture piece as follows: `;

const EDIT_PROMPT_SUFFIX = `

Keep the same studio product photograph style. Clean white background, soft neutral lighting, single object centered with padding. Preserve the overall character and proportions of the original except where the modification overrides them.`;

// Composite 1–4 user photos of an actual room into a single dollhouse-
// cutaway architectural render that Hunyuan3D can ingest. This is the
// "free tier" path for room scanning — no GPU needed, just OpenAI's
// multi-image edit endpoint (~$0.04) + a downstream Hunyuan call.
//
// Hunyuan needs a single image to mesh from. Real rooms can't be captured
// in one photo from the inside (the camera can only see one direction at
// a time), so we ask gpt-image-1 to FUSE the user's photos into a
// dollhouse view that shows the full 3D volume. The model is told to
// preserve materials/colors/proportions from the source photos as closely
// as possible.
export async function compositeRoomPhotosForMesh(photos, description, opts = {}) {
  // gpt-image-1's images.edit endpoint accepts up to 10 reference images.
  // We use that headroom for video-extracted frame sequences (typically
  // 8 frames) which give much better wall coverage than a few snapshots.
  if (!Array.isArray(photos) || photos.length === 0 || photos.length > 10) {
    throw new Error(
      `expected 1-10 photos, got ${Array.isArray(photos) ? photos.length : typeof photos}`
    );
  }
  const client = getClient();
  // Convert each ImageRef to a File the SDK can upload
  const files = await Promise.all(
    photos.map(async (p, i) => {
      const buf = Buffer.from(p.data, "base64");
      const ext = p.mediaType.includes("png")
        ? "png"
        : p.mediaType.includes("jpeg") || p.mediaType.includes("jpg")
          ? "jpg"
          : "webp";
      return toFile(buf, `room-photo-${i}.${ext}`, { type: p.mediaType });
    })
  );

  const descSuffix = description?.trim()
    ? `\n\nGROUND-TRUTH ROOM SPEC (already extracted from the photos by a separate vision model — treat as authoritative):\n${description.trim()}`
    : "";

  const intro =
    photos.length === 1
      ? `Reference photograph of a real room.`
      : `${photos.length} reference photographs of the same real room from different angles.`;

  // The key trick that makes Hunyuan return a clean room mesh (not the
  // blocky / lego "Roblox" failure mode): force gpt-image-1 to OUTPUT
  // an architectural-visualization render — NOT a photo collage, NOT a
  // realistic photograph of the room, NOT a stitched panorama. Hunyuan
  // was trained on clean object-like renders; a clean render of a room
  // is exactly what it can mesh well.
  const prompt = `${intro}

Use these references to UNDERSTAND the room — wall colors, floor material, window/door positions, room proportions, fixtures. Then forget the camera angles in the photos and produce a single new image of the room in the following exact style:

STYLE: Clean architectural visualization render — like a Blender / 3DS Max / Lumion exterior model of a tiny dollhouse, one wall removed for cutaway. The whole room is rendered as a single 3D object sitting on an infinite white studio backdrop, viewed from a slightly elevated three-quarter angle. Soft global illumination. Sharp geometry. Photoreal materials but rendered (not photographed) — think real-estate marketing render, not iPhone photo.

CONTENT:
- Same wall colors as the reference photos
- Same floor type / color
- Same window and door positions and approximate sizes
- Same ceiling height proportion
- Empty floor in the middle (NO furniture — we'll add furniture separately)
- One wall (the closest to the camera) cut away so we can see inside
- No people, no text, no UI, no decorations the references didn't show

Output: ONE clean architectural render. Plain white background outside the room.${descSuffix}`;

  const response = await client.images.edit({
    model: "gpt-image-1",
    image: files.length === 1 ? files[0] : files,
    prompt,
    n: 1,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "high",
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return { mediaType: "image/png", data: b64 };
}

// Variant of generateRoomImage tuned for the image-to-3D pipeline. Hunyuan
// likes a single "object" centered in frame, so for a room we ask for a
// dollhouse / cutaway-isometric render that reads as a contained 3D volume
// instead of a flat wall.
export async function generateRoomImageForMesh(description, opts = {}) {
  const client = getClient();
  const enhanced = `${description}.

Architectural visualization render of an empty interior space, dollhouse cutaway perspective. The room is shown as a 3D volume — floor, walls, and ceiling all visible from a slightly elevated three-quarter angle. Photorealistic materials (wood, fabric, paint, glass). Soft even daylight, neutral palette. Centered composition with the room fully in frame and clear empty floor space in the middle for placing furniture later. No people, no foreground objects, no text, no UI. Looks like a high-quality 3D architectural render against a plain white background.`;
  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt: enhanced,
    n: 1,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "high",
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return { mediaType: "image/png", data: b64 };
}

// Generate a custom room/scene background. Different stylistic suffix than
// the furniture generator — we want a wide-angle empty room photo style.
export async function generateRoomImage(description, opts = {}) {
  const client = getClient();
  const enhanced = `${description}.

Photorealistic wide-angle interior photograph of an empty room (no people, no furniture in the foreground). Natural lighting, neutral palette, eye-level camera angle showing the floor and walls clearly. The room should feel real and inviting, like a well-shot interior magazine spread. No text overlays, no UI.`;
  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt: enhanced,
    n: 1,
    size: opts.size ?? "1536x1024",
    quality: opts.quality ?? "medium",
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return { mediaType: "image/png", data: b64 };
}

// Generate a fresh image from a text description.
export async function generateImageFromText(prompt, opts = {}) {
  const client = getClient();
  const enhanced = `${prompt}${FURNITURE_STYLE_SUFFIX}`;

  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt: enhanced,
    n: 1,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "medium",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI returned no image data");
  }
  return { mediaType: "image/png", data: b64 };
}

// Place a piece of furniture into a room scene. If roomImage is provided,
// gpt-image-1 composites the furniture into that room. If no roomImage, we
// generate the room around the furniture from a text description. The key
// constraint we ask the model to preserve: keep the furniture EXACTLY as
// shown — same shape, color, materials, proportions. Only the surroundings
// (and minimal positioning) should change.
export async function placeInRoom(furnitureImage, opts = {}) {
  const client = getClient();
  const buffer = Buffer.from(furnitureImage.data, "base64");
  const ext = furnitureImage.mediaType.includes("png")
    ? "png"
    : furnitureImage.mediaType.includes("jpeg") || furnitureImage.mediaType.includes("jpg")
      ? "jpg"
      : "webp";
  const furnitureFile = await toFile(buffer, `furniture.${ext}`, {
    type: furnitureImage.mediaType,
  });

  const roomDescription = opts.roomDescription || "a beautifully designed, well-lit modern living room with natural light";

  let response;
  if (opts.roomImage) {
    // Two-image edit: furniture + user's room photo.
    const roomBuf = Buffer.from(opts.roomImage.data, "base64");
    const roomExt = opts.roomImage.mediaType.includes("png")
      ? "png"
      : opts.roomImage.mediaType.includes("jpeg") || opts.roomImage.mediaType.includes("jpg")
        ? "jpg"
        : "webp";
    const roomFile = await toFile(roomBuf, `room.${roomExt}`, {
      type: opts.roomImage.mediaType,
    });

    const prompt = `Place the furniture piece from the first image into the room shown in the second image.

CRITICAL: The furniture must remain EXACTLY as it appears in the first image — same exact shape, silhouette, color, materials, proportions, design details. Do not redesign, restyle, or modify the furniture in any way.

Position the furniture in a natural, sensible location within the room (e.g. a sofa against a wall, a lamp on a side table, a chair near a window). Match the room's perspective, lighting, and shadows so the placement looks photorealistic. Cast a soft shadow under the furniture. Do not add or remove any other furniture or decor from the room.

The output should be a photorealistic interior photograph showing the room with the original furniture piece naturally placed inside it.`;

    response = await client.images.edit({
      model: "gpt-image-1",
      image: [furnitureFile, roomFile],
      prompt,
      n: 1,
      size: opts.size ?? "1024x1024",
      quality: opts.quality ?? "medium",
    });
  } else {
    // Single-image: ask gpt-image-1 to generate a room around the furniture.
    const prompt = `Place this exact furniture piece in ${roomDescription}.

CRITICAL: The furniture must remain EXACTLY as shown — same exact shape, silhouette, color, materials, proportions, design details. Do not redesign, restyle, or modify the furniture in any way.

Generate a photorealistic interior scene showing the room around the original furniture piece. Position it in a natural, sensible location (e.g. a sofa against a wall, a lamp on a side table). Match consistent perspective, soft natural lighting, and a soft shadow under the furniture. No text, no people. Studio interior photography aesthetic.`;

    response = await client.images.edit({
      model: "gpt-image-1",
      image: furnitureFile,
      prompt,
      n: 1,
      size: opts.size ?? "1024x1024",
      quality: opts.quality ?? "medium",
    });
  }

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return { mediaType: "image/png", data: b64 };
}

// Edit a reference image with text instructions to produce a modified image.
export async function editImageWithText(image, prompt, opts = {}) {
  const client = getClient();
  const buffer = Buffer.from(image.data, "base64");
  const ext = image.mediaType.includes("png")
    ? "png"
    : image.mediaType.includes("jpeg") || image.mediaType.includes("jpg")
      ? "jpg"
      : "webp";
  const file = await toFile(buffer, `reference.${ext}`, { type: image.mediaType });

  const enhanced = `${EDIT_PROMPT_PREFIX}${prompt}${EDIT_PROMPT_SUFFIX}`;

  const response = await client.images.edit({
    model: "gpt-image-1",
    image: file,
    prompt: enhanced,
    n: 1,
    size: opts.size ?? "1024x1024",
    quality: opts.quality ?? "medium",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI returned no image data from edit");
  }
  return { mediaType: "image/png", data: b64 };
}
