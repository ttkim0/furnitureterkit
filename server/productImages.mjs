// Product image handling — uploads + AI generation.
//
// Storage: writes to public/store-assets/products/ for Phase 2.
// Phase 2.5 will move to Supabase Storage for cross-deploy persistence.
//
// AI gen: gpt-image-1 with a product-photography preset that takes the
// product's title + description and produces a hero shot.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const PRODUCTS_DIR = resolve("public/store-assets/products");

let _openai = null;
function openai() {
  if (_openai) return _openai;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set");
  }
  _openai = new OpenAI();
  return _openai;
}

/**
 * Generate a hero product photo via gpt-image-1.
 *
 * Two paths:
 *   - **With sourceImageUrl** → gpt-image-1.edit() takes the actual
 *     white-background piece and places it into a lifestyle scene. The
 *     result depicts THIS exact piece (same proportions, materials,
 *     details). This is the high-quality path. Use whenever the source
 *     image is available.
 *   - **Without sourceImageUrl** → gpt-image-1.generate() makes a
 *     fictional lifestyle photo from text only. Lower quality —
 *     fallback path.
 *
 * @param {object} input
 * @param {string} input.title              - Product title (drives composition).
 * @param {string} [input.description]      - Extra context for the image model.
 * @param {string} [input.category]         - chair/table/sofa/bed/lamp/storage.
 * @param {string} [input.material]         - Primary material.
 * @param {string} [input.style]            - 'lifestyle' | 'studio' | 'lifestyle-warm'.
 * @param {string} [input.sourceImageUrl]   - White-background source image of the actual piece.
 * @returns {Promise<{ url: string, mediaType: string, prompt: string, mode: 'edit'|'generate' }>}
 */
export async function generateProductPhoto({
  title,
  description = "",
  category = "",
  material = "",
  style = "lifestyle",
  sourceImageUrl = null,
}) {
  // High-quality path — we have an image of the actual piece. Use .edit()
  // so gpt-image-1 preserves the real geometry, materials, and details.
  if (sourceImageUrl) {
    try {
      return await generateProductPhotoFromSource({
        sourceImageUrl,
        title,
        description,
        category,
        material,
        style,
      });
    } catch (e) {
      console.warn(
        `[ariadne] product photo .edit() failed (${e?.message ?? e}), falling back to text-only generation`
      );
      // Fall through to text-only generation
    }
  }
  const styleHint = {
    studio: "Studio product photograph in the style of Hem or Floyd Detroit catalogs — clean off-white seamless backdrop with a subtle warm-to-cool gradient, soft professional strobe lighting from upper-front-left, gentle shadow underneath. Editorial precision.",
    lifestyle: "Editorial lifestyle photograph in the style of Hem, Sabai, or Article — the piece in a real architectural interior with warm wood floors, natural diffused light from a tall window, soft linen drapes blurring at the edges, an out-of-focus indoor plant or ceramic vessel. Magazine-quality depth of field. The piece is the hero.",
    "lifestyle-warm": "Salt & Stone or Aesop-style editorial composition — warm golden-hour light from frame-left, soft natural shadows, tonal warm palette of cream / sand / terracotta / pale linen. Premium apothecary editorial mood, quiet and restrained.",
  }[style] || "Editorial product photograph in the style of Hem catalog. Soft natural light, magazine-quality composition, real photographic depth-of-field.";

  const prompt = `${styleHint}

The piece: "${title}"${description ? ` — ${description}` : ""}.${category ? ` Category: ${category}.` : ""}${material ? ` Primary material: ${material}.` : ""}

PHOTOGRAPHY DIRECTION:
- Shot on medium-format equivalent — 80mm lens, soft natural or strobed lighting
- Tonal color grading — warm whites, soft shadows, NEVER blown-out highlights
- Real photographic depth of field — piece sharp, background gently soft
- Editorial composition: rule-of-thirds, generous negative space
- Surface details must be visible — wood grain, fabric weave, metal patina

ABSOLUTE NO-NOs: NO text. NO logos. NO watermarks. NO people. NO brand markings.
4:3 landscape. Pure photographic realism — looks SHOT, not rendered or illustrated.
Color palette: premium and restrained — earth tones, off-whites, soft warm neutrals.`;

  const response = await openai().images.generate({
    model: "gpt-image-1",
    prompt,
    n: 1,
    size: "1536x1024",
    quality: "high", // bumped from "medium" — 4× cost, dramatically better quality
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no image data");

  mkdirSync(PRODUCTS_DIR, { recursive: true });
  const filename = `product-${slugFile(title)}-${Date.now()}-${randomBytes(3).toString("hex")}.png`;
  const filePath = resolve(PRODUCTS_DIR, filename);
  writeFileSync(filePath, Buffer.from(b64, "base64"));
  return {
    url: `/store-assets/products/${filename}`,
    mediaType: "image/png",
    prompt,
    mode: "generate",
  };
}

/**
 * High-quality variant: place the actual piece (from its white-background
 * source image) into a lifestyle scene via gpt-image-1.edit(). The result
 * depicts THIS specific piece — true materials, real proportions — not a
 * fictional photo dreamed up from text.
 */
async function generateProductPhotoFromSource({
  sourceImageUrl,
  title,
  description,
  category,
  material,
  style,
}) {
  // Fetch the source image bytes (might be a remote URL or a relative
  // /store-assets/ path served by Vite).
  const resolvedUrl = sourceImageUrl.startsWith("http")
    ? sourceImageUrl
    : `${process.env.PUBLIC_BASE_URL ?? "http://localhost:5173"}${sourceImageUrl.startsWith("/") ? "" : "/"}${sourceImageUrl}`;
  const fetched = await fetch(resolvedUrl);
  if (!fetched.ok) throw new Error(`source image fetch failed: ${fetched.status}`);
  const buffer = Buffer.from(await fetched.arrayBuffer());
  const mediaType = fetched.headers.get("content-type") ?? "image/png";
  const ext = mediaType.includes("png") ? "png" : mediaType.includes("jpeg") ? "jpg" : "png";
  const imageFile = await toFile(buffer, `source.${ext}`, { type: mediaType });

  // Editorial product photography styles — reference brands the model
  // recognizes: Hem, Sabai, Floyd, Aesop, Salt & Stone, Le Labo, Diptyque.
  const sceneByStyle = {
    studio: "a clean seamless off-white studio backdrop with PROFESSIONAL strobe lighting from upper-front-left, soft shadow underneath the piece. The shot looks like an in-house product image from Hem or Floyd Detroit — editorial precision, neutral background, the piece floating in clean space. Backdrop has a subtle warm-to-cool gradient (top-left to bottom-right).",
    lifestyle: "an editorial interior shot in the style of Hem, Sabai, or Article catalog photography. Real architectural space with warm wood floors, natural diffused light from a tall window on the left, soft linen drapes blurring at the edges, a hint of indoor plant or ceramic vessel out of focus. The piece is the hero — sharply lit, in-focus, with magazine-quality depth of field. The background is intentionally tonally simple so the piece dominates.",
    "lifestyle-warm": "a Salt & Stone or Aesop-style editorial composition: warm golden-hour light streaming from frame-left, soft natural shadows, a tonal warm palette of cream / sand / terracotta / pale linen, professional product photography. The piece occupies the right-of-center area against a softly gradiented warm cream backdrop. Premium apothecary editorial mood — quiet, restrained, expensive-feeling.",
  };
  const scene = sceneByStyle[style] || sceneByStyle.lifestyle;

  const prompt = `⚠️ CRITICAL: Use the input image as the EXACT piece to feature. The piece you see in the input is the piece that must appear in the output — same geometry, same proportions, same materials, same finish. Do NOT replace it with a different piece. Do NOT redraw it from your imagination. Do NOT generate a generic version of the same category. You MUST use the input piece pixel-faithful.

Your job is to place that EXACT piece (kept identical) into ${scene}

The piece is "${title}"${description ? ` — ${description}` : ""}${material ? ` (${material})` : ""}${category ? `, a ${category}` : ""}.

PHOTOGRAPHY DIRECTION (for the scene around the piece):
- Shot on a medium-format camera (think Phase One or Hasselblad), 80mm lens equivalent
- Soft natural light or strobed product lighting — NEVER harsh flash
- Tonal color grading — warm whites + soft shadows, never blown-out highlights
- Real photographic depth-of-field — piece sharply in focus, background gently soft
- Editorial composition: rule-of-thirds, generous negative space
- Background details are TONALLY MUTED — they SUPPORT the piece, never compete

PRESERVATION CHECKLIST — verify the output piece against the input:
✓ Same overall shape (legs, seat, back, surfaces — identical structure)
✓ Same proportions (height-to-width ratio matches)
✓ Same material (wood species, fabric type, metal finish — visibly identical)
✓ Same color (no shifts in hue)
✓ Same fine details (joinery, edges, finish — all preserved)
✓ Only the LIGHTING + SHADOWS adapt to the new scene
✓ Only the BACKGROUND is generated (the piece is taken from the input)

If you cannot preserve the input piece faithfully, OUTPUT THE INPUT PIECE ON A NEUTRAL STUDIO BACKDROP instead of a lifestyle scene. Better to have a studio shot of the actual piece than a lifestyle shot of an imaginary one.

OUTPUT CONSTRAINTS:
- 4:3 landscape composition, piece occupies 50-65% of the frame
- NO text, NO logos, NO watermarks, NO people, NO brand markings
- Pure photographic realism — looks SHOT, not rendered, not stylized illustration
- Color palette: premium and restrained — earth tones, off-whites, soft warm neutrals`;

  const response = await openai().images.edit({
    model: "gpt-image-1",
    image: imageFile,
    prompt,
    size: "1536x1024",
    quality: "high", // bumped from "medium" — 4× cost, dramatically better quality
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1.edit() returned no image data");

  mkdirSync(PRODUCTS_DIR, { recursive: true });
  const filename = `product-${slugFile(title)}-${Date.now()}-${randomBytes(3).toString("hex")}.png`;
  const filePath = resolve(PRODUCTS_DIR, filename);
  writeFileSync(filePath, Buffer.from(b64, "base64"));
  return {
    url: `/store-assets/products/${filename}`,
    mediaType: "image/png",
    prompt,
    mode: "edit",
  };
}

/**
 * Save an uploaded product image (raw bytes + content type).
 * Used by the upload endpoint to write user-supplied photos.
 */
export function saveUploadedProductImage(buffer, contentType, originalName = "image") {
  const ext = (contentType?.split("/")[1] ?? "jpg").split(";")[0].trim().slice(0, 5);
  mkdirSync(PRODUCTS_DIR, { recursive: true });
  const filename = `upload-${slugFile(originalName)}-${Date.now()}-${randomBytes(3).toString("hex")}.${ext}`;
  const filePath = resolve(PRODUCTS_DIR, filename);
  writeFileSync(filePath, buffer);
  return {
    url: `/store-assets/products/${filename}`,
    mediaType: contentType ?? "application/octet-stream",
  };
}

function slugFile(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "image";
}

/**
 * Generate a GALLERY of photos for each product (3 styles each: lifestyle,
 * studio, lifestyle-warm). Returns:
 *   results[productId] = { hero: url, gallery: [url, url, url], error?, mode? }
 *
 * The first photo (lifestyle) becomes the hero. The gallery array is for
 * the product page to show as a clickable strip. Total cost: 3× per product.
 *
 * @param {Array<{ id: string, title: string, description?: string, category?: string, material?: string, sourceImageUrl?: string }>} products
 * @returns {Promise<Record<string, { hero: string, gallery: string[], error?: string, mode?: 'edit'|'generate' }>>}
 */
export async function generateProductGalleryBatch(products) {
  const CONCURRENCY = 2; // 3 photos per product × 2 parallel = 6 in flight
  const results = {};
  const queue = [...products];

  // For each product, generate the lifestyle (hero) first, then studio +
  // warm in parallel.
  async function worker() {
    while (queue.length > 0) {
      const p = queue.shift();
      if (!p) break;
      try {
        const baseInput = {
          title: p.title,
          description: p.description ?? "",
          category: p.category ?? "",
          material: p.material ?? "",
          sourceImageUrl: p.sourceImageUrl ?? null,
        };
        // Hero (lifestyle) — runs first so we can save it before others land
        const hero = await generateProductPhoto({ ...baseInput, style: "lifestyle" });
        // Two more for the gallery — studio + warm
        const [studio, warm] = await Promise.all([
          generateProductPhoto({ ...baseInput, style: "studio" }).catch((e) => ({ url: "", error: e?.message })),
          generateProductPhoto({ ...baseInput, style: "lifestyle-warm" }).catch((e) => ({ url: "", error: e?.message })),
        ]);
        const gallery = [hero.url, studio.url, warm.url].filter(Boolean);
        results[p.id] = { hero: hero.url, gallery, mode: hero.mode };
        console.log(
          `[ariadne] gallery (${hero.mode}): ${p.title} → ${gallery.length} photo${gallery.length === 1 ? "" : "s"}`
        );
      } catch (e) {
        results[p.id] = { hero: "", gallery: [], error: e instanceof Error ? e.message : String(e) };
        console.error(`[ariadne] gallery failed for ${p.title}:`, e?.message ?? e);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, products.length) }, worker));
  return results;
}

/**
 * Generate photos for many products in parallel. Returns the URL map keyed
 * by product id. We cap concurrency to 3 to stay within OpenAI's rate
 * limits and avoid burning credit on noisy retries.
 *
 * For products that include `sourceImageUrl`, we use gpt-image-1.edit()
 * so the result depicts the actual piece. Otherwise we fall back to
 * text-only generation.
 *
 * @param {Array<{ id: string, title: string, description?: string, category?: string, material?: string, style?: string, sourceImageUrl?: string }>} products
 * @returns {Promise<Record<string, { url: string, error?: string, mode?: 'edit'|'generate' }>>}
 */
export async function generateProductPhotosBatch(products) {
  const CONCURRENCY = 3;
  const results = {};
  const queue = [...products];

  async function worker() {
    while (queue.length > 0) {
      const p = queue.shift();
      if (!p) break;
      try {
        const r = await generateProductPhoto({
          title: p.title,
          description: p.description ?? "",
          category: p.category ?? "",
          material: p.material ?? "",
          style: p.style ?? "lifestyle",
          sourceImageUrl: p.sourceImageUrl ?? null,
        });
        results[p.id] = { url: r.url, mode: r.mode };
        console.log(
          `[ariadne] auto-photo (${r.mode}): ${p.title} → ${r.url}`
        );
      } catch (e) {
        results[p.id] = { url: "", error: e instanceof Error ? e.message : String(e) };
        console.error(`[ariadne] auto-photo failed for ${p.title}:`, e?.message ?? e);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, products.length) }, worker));
  return results;
}
