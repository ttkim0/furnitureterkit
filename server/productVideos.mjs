// Per-product cinematic video — Fal.ai Seedance Lite (image-to-video).
//
// Takes the product's white-background source image + a category-specific
// cinematography prompt, returns a ~5s MP4 URL hosted on Fal's CDN. The
// storefront uses it as a scroll-scrubbed hero video (WISA pattern):
//   - The video doesn't autoplay; scroll position drives video.currentTime
//   - With `video.seeking` guard for tear-free scrubbing
//   - Result: scrolling through the page feels like a cinematic product reveal
//
// Cost: ~$0.10 per video at Seedance Lite tier.
// Latency: ~30–90s per video. Batched 2-wide so a 5-piece store completes
// in ~3 minutes worst case.

import { fal } from "@fal-ai/client";

const SEEDANCE_MODEL = "fal-ai/bytedance/seedance/v1/lite/image-to-video";

let _configured = false;
function configure() {
  if (_configured) return;
  if (!process.env.FAL_KEY) {
    throw new Error("FAL_KEY not set — needed for video generation");
  }
  fal.config({ credentials: process.env.FAL_KEY });
  _configured = true;
}

/**
 * Category-specific cinematography prompt. Returns a rich, professional
 * direction for the video model — a full 360 reveal in a real environment,
 * shot like a Crate&Barrel or Restoration Hardware campaign film.
 */
function cinematicPromptFor({ title, category, material }) {
  // Environmental setting per category — the piece must be the HERO but
  // shown in a real, atmospheric space with supporting elements.
  const setting = {
    chair: "an editorial interior — soft linen curtains diffusing morning light, a low travertine pedestal nearby, a single ceramic vessel out of focus in the background. The chair sits on a wide oak floor or pale rug.",
    table: "a sun-lit dining space — soft natural light from a tall window, a hint of leafy plant out of focus, a single ceramic bowl or stack of books on the table to convey scale, warm wood floor.",
    sofa: "a magazine-worthy living room — natural light pouring in from frame-left through linen drapes, soft area rug underneath, a side table with a ceramic vase out of focus, gallery wall barely visible in the background.",
    lamp: "an evening atmospheric scene — the lamp is OFF at start then turns ON during the shot, warm pool of light spreading across a quiet desk or side table with a book and a ceramic mug, ambient blue-hour light through a window in the background, the lamp becomes the only true light source.",
    bed: "a calm bedroom — soft morning light, linen bedding, a wooden side table with a glass carafe, a sculptural pendant or art print out of focus on the wall.",
    storage: "a hallway or entryway scene — warm wood floor, art print or framed photograph on the wall behind, a ceramic vessel or stack of books on top of the piece, soft natural side light.",
  }[category] || "a calm editorial interior with supporting decorative objects out of focus and soft natural light.";

  // 360 camera move — every category gets a full orbital reveal so the buyer
  // sees every angle, plus a hero close-up at the end.
  const cameraMove = `A SLOW, SMOOTH 360-DEGREE CAMERA ORBIT around the piece — the camera glides in a complete circle, starting from a 3/4 front angle, moving clockwise around to reveal the side, the back, the other side, and returning to a close-up hero shot of the most distinctive detail. Steady cinematic dolly motion, like a Crate&Barrel or West Elm catalog film. Subtle parallax against the environment. End on a close detail (joinery, material grain, finish patina).`;

  return `Premium product film, 10-second cinematic shot. The hero is the ${title}${material ? ` in ${material}` : ""}, photographed in ${setting}

${cameraMove}

PHOTOGRAPHY DIRECTION:
- Editorial color grading — warm golden-hour or soft morning light, never harsh
- Real depth of field — piece sharply in focus, background gently soft
- Camera height: slightly above the piece, never below
- Material truth: wood grain visible, fabric weave visible, metal patina visible
- Background elements (books, ceramics, plants, light fixtures) are TONALLY MUTED — they support the piece, never compete
- Restoration Hardware / Crate&Barrel / West Elm campaign quality — premium, calm, restrained

ABSOLUTE NO-NOs:
- NO people in the frame
- NO text, logos, watermarks
- NO harsh flash
- NO shaky / handheld camera
- NO fast cuts — single continuous take
- NO dramatic camera zooms or jarring moves

The piece must REMAIN the same piece throughout — preserve its exact geometry, materials, color, and proportions from the source image. The camera moves around it; the piece itself doesn't change.`;
}

/**
 * @param {object} input
 * @param {string} input.title
 * @param {string} input.sourceImageUrl - absolute URL of the white-bg source image
 * @param {string} [input.category]     - chair/table/sofa/bed/lamp/storage
 * @param {string} [input.material]
 * @param {string} [input.duration]     - seedance accepts "5" or "10" (seconds)
 * @returns {Promise<{ url: string, prompt: string }>}
 */
export async function generateProductVideo({
  title,
  sourceImageUrl,
  category,
  material,
  duration = "10",
}) {
  if (!sourceImageUrl) throw new Error("sourceImageUrl required");
  configure();

  const resolvedUrl = sourceImageUrl.startsWith("http")
    ? sourceImageUrl
    : `${process.env.PUBLIC_BASE_URL ?? "http://localhost:5173"}${sourceImageUrl.startsWith("/") ? "" : "/"}${sourceImageUrl}`;
  const prompt = cinematicPromptFor({ title, category, material });

  const result = await fal.subscribe(SEEDANCE_MODEL, {
    input: {
      image_url: resolvedUrl,
      prompt,
      duration: String(duration), // 10s — twice the length of a 5s clip
      resolution: "720p",
    },
    logs: false,
  });

  const url = result?.data?.video?.url ?? result?.video?.url;
  if (!url) {
    throw new Error(`Seedance returned no video URL: ${JSON.stringify(result).slice(0, 300)}`);
  }
  return { url, prompt };
}

/**
 * Generate videos for many products in parallel (concurrency 2 — Seedance
 * is slow + Fal has per-account rate limits).
 *
 * @param {Array<{ id: string, title: string, sourceImageUrl: string, category?: string, material?: string }>} products
 * @returns {Promise<Record<string, { url: string, error?: string }>>}
 */
export async function generateProductVideosBatch(products) {
  const CONCURRENCY = 2;
  const results = {};
  const queue = products.filter((p) => p.sourceImageUrl);
  // Products without a source image can't get a video — record as skipped.
  for (const p of products) {
    if (!p.sourceImageUrl) {
      results[p.id] = { url: "", error: "no source image" };
    }
  }

  async function worker() {
    while (queue.length > 0) {
      const p = queue.shift();
      if (!p) break;
      try {
        const r = await generateProductVideo({
          title: p.title,
          sourceImageUrl: p.sourceImageUrl,
          category: p.category,
          material: p.material,
        });
        results[p.id] = { url: r.url };
        console.log(`[ariadne] video: ${p.title} → ${r.url.slice(0, 80)}…`);
      } catch (e) {
        results[p.id] = { url: "", error: e instanceof Error ? e.message : String(e) };
        console.error(`[ariadne] video failed for ${p.title}:`, e?.message ?? e);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return results;
}
