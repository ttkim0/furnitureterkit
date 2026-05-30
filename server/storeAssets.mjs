// Store asset generation — logos, hero images, product photo backdrops.
//
// All run on gpt-image-1 via the existing OpenAI client. Stored locally
// in public/store-assets/ for now (Phase 2 will move to Supabase Storage
// for production). Returns relative URLs the storefront can <img src=> to.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";

const ASSETS_DIR = resolve("public/store-assets");

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set — needed for logo generation");
  }
  _client = new OpenAI();
  return _client;
}

/**
 * Generate a minimalist wordmark/icon logo for a furniture brand.
 *
 * @param {object} input
 * @param {string} input.storeName - The brand name (becomes the wordmark text).
 * @param {string} [input.tagline] - Optional tagline for tone.
 * @param {string} [input.style] - One of: 'mark' (icon only) | 'wordmark' | 'combined'.
 * @param {string} [input.vibe] - Free-text descriptor: "warm rustic", "minimal noir", etc.
 * @param {string} [input.bgColor] - Background color hint (CSS hex).
 * @returns {Promise<{ url: string, mediaType: string, prompt: string }>}
 */
export async function generateLogo({
  storeName,
  tagline = "",
  style = "wordmark",
  vibe = "minimal modern",
  bgColor = "#ffffff",
}) {
  const styleInstruction = {
    mark: `An abstract geometric icon mark only (NO TEXT). Single, simple, memorable shape — like the Nike swoosh or Apple silhouette.`,
    wordmark: `A typographic wordmark spelling exactly "${storeName}" (no other text). Clean, custom-feeling typography. The text must be readable and correctly spelled.`,
    combined: `A combined logo: a small abstract icon mark to the left, then the wordmark "${storeName}" to the right. Both elements balanced and harmonious.`,
  }[style];

  const prompt = `Logo design for a furniture and homewares brand named "${storeName}"${tagline ? ` (tagline: "${tagline}")` : ""}.

${styleInstruction}

Aesthetic: ${vibe}. Sophisticated, gallery-grade, would look at home in a luxury design magazine. Minimalist — no gradients, no shadows, no 3D effects, no ornament. Single solid color logo (dark) on a solid ${bgColor} background. Vector-style flat design. No mockups, no tagline text in the image unless it's the wordmark itself. Center the logo with generous padding around it. Square 1024x1024 frame.`;

  const response = await client().images.generate({
    model: "gpt-image-1",
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "medium",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no image data");

  mkdirSync(ASSETS_DIR, { recursive: true });
  const filename = `logo-${slugSafe(storeName)}-${Date.now()}.png`;
  const filePath = resolve(ASSETS_DIR, filename);
  writeFileSync(filePath, Buffer.from(b64, "base64"));
  return {
    url: `/store-assets/${filename}`,
    mediaType: "image/png",
    prompt,
  };
}

/**
 * Generate a hero / banner image for the storefront. Same gpt-image-1 but
 * with a wider aspect ratio and brand-aware composition.
 */
export async function generateHeroImage({
  storeName,
  vibe = "warm minimal",
  primaryProduct = "",
}) {
  const prompt = `Editorial-quality hero banner for the furniture brand "${storeName}". ${primaryProduct ? `Hero featured piece: ${primaryProduct}. ` : ""}Aesthetic: ${vibe}.

Wide cinematic composition (3:1 to 16:9 mood). Architectural daylight. Warm muted color grade. Negative space on the right side for overlaid text (do not draw any text in the image). Looks like a high-end interior design magazine cover. Real photographic rendering, not illustration. No people, no logos, no text.`;

  const response = await client().images.generate({
    model: "gpt-image-1",
    prompt,
    n: 1,
    size: "1536x1024",
    quality: "medium",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no image data");

  mkdirSync(ASSETS_DIR, { recursive: true });
  const filename = `hero-${slugSafe(storeName)}-${Date.now()}.png`;
  const filePath = resolve(ASSETS_DIR, filename);
  writeFileSync(filePath, Buffer.from(b64, "base64"));
  return {
    url: `/store-assets/${filename}`,
    mediaType: "image/png",
    prompt,
  };
}

function slugSafe(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "store";
}
