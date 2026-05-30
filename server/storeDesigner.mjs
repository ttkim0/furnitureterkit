// Lovable-style site generator powered by Claude Sonnet 4.6.
//
// Inputs:
//   - design_brief         : free-form description of what the creator wants
//   - reference_urls       : array of URLs the creator wants the model to riff on
//   - inspiration_images   : array of image URLs (uploaded by the creator)
//   - products             : array of products in the store (so the design
//                            knows what kinds of pieces are being sold)
//   - store_basics         : { storeName, tagline, about, paletteHint? }
//   - prior_html, prior_css: previous iteration to refine (optional)
//   - chat_history         : prior user/assistant messages (optional)
//   - user_message         : the latest "make it bigger" / "add a hero" /
//                            etc. instruction (optional — only for iterations)
//
// Output (streamed back via SSE for the long generation):
//   - HTML for the homepage (uses {{products}} macro for product grid)
//   - CSS scoped to the storefront
//   - A short summary of what was built / changed
//
// Security: the generated HTML is rendered in a sandboxed iframe (no
// allow-same-origin, no parent access) — the platform doesn't trust it.

import Anthropic from "@anthropic-ai/sdk";
import { scrapeReferences } from "./referenceScraper.mjs";

const MODEL = process.env.CLAUDE_DESIGNER_MODEL ?? "claude-sonnet-4-5-20250929";

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set — needed for site generator");
  }
  _client = new Anthropic();
  return _client;
}

// System prompt — high-polish, brief-driven storefront designer.
//
// Two non-negotiables that previous prompts kept getting wrong:
//   1. Match the BRIEF MOOD, never default to dark.
//   2. Use the SCRAPED REFERENCES as actual design source material — sample
//      their fonts/colors/voice, don't just acknowledge them.
const SYSTEM_PROMPT = `You are the in-house designer + developer for Ariadne, a marketplace for independent furniture makers. You build distinctive, high-polish, professionally-finished storefronts in single-file HTML+CSS+JS.

══════════════════════════════════════════════════════════════════════════
  #0 — VISUAL REFERENCE ARCHETYPES (the bar you must clear)
══════════════════════════════════════════════════════════════════════════

These are the sites your output must FEEL like — premium e-commerce that looks expensive without trying. Study what they do, then apply that energy to whichever brief you're given.

**For warm minimal / apothecary-adjacent furniture briefs** (most common):
• **saltandstone.com** — full-bleed editorial hero, cream/sand background, products photographed on glass/marble, tight serif + tiny sans subtitle, pill-shaped CTA with arrow, generous space.
• **aesop.com** — Inter all the way, tonal monochrome backgrounds, single product photo per scroll, precise alignment to a 12-col grid, calm pacing.
• **lelabofragrances.com** — typographic primacy, almost no UI chrome, just words and a few photos, ALL-CAPS labels in tight tracking.
• **diptyque-paris.com** — black-on-cream, oval-framed product motifs, parisian editorial feel.

**For warm residential / midcentury furniture briefs**:
• **floyddetroit.com** — friendly modernist sans, big rounded product images, color-blocked sections, generous photo + minimal copy.
• **hem.com** — Swedish design clarity, large product photos, clean grid, restrained color, tight legal-looking footer.
• **sabai.design** — soft cream backgrounds, big lifestyle photos with products in real spaces, casual conversational copy.

**For atmospheric / late-night / luxe briefs** (use sparingly — only if brief explicitly asks):
• **menu.as / audo.copenhagen** — dark navy or charcoal, brass accents, big serif, atmospheric photography.
• **ferm.com** — soft pastels, danish modern, color blocks.

THE PATTERN you must use as your default starting frame:

\`\`\`html
<!-- HERO: split editorial, product photo dominates, text floats -->
<section class="hero">
  <div class="hero-image">
    <img src="…" alt="…" loading="eager" /> <!-- big lifestyle photo, ~60% of viewport width -->
  </div>
  <div class="hero-text">
    <span class="eyebrow">{{tagline}}</span>
    <h1>{{store_name}}</h1>
    <p>… short editorial copy …</p>
    <a class="cta" href="#pieces">
      <span>Shop now</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
    </a>
  </div>
</section>
\`\`\`

\`\`\`css
.hero { display: grid; grid-template-columns: 1fr 1fr; min-height: 88vh; align-items: center; background: var(--bg); }
.hero-image { height: 88vh; overflow: hidden; }
.hero-image img { width: 100%; height: 100%; object-fit: cover; }
.hero-text { padding: clamp(2rem, 6vw, 6rem); display: flex; flex-direction: column; gap: 18px; max-width: 540px; }
.hero-text .eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.hero-text h1 { font-family: var(--display-font); font-size: clamp(2.5rem, 5vw, 4.5rem); line-height: 1.05; margin: 0; color: var(--text); font-weight: 400; }
.cta { display: inline-flex; align-items: center; gap: 10px; background: var(--text); color: var(--bg); padding: 14px 26px; border-radius: 999px; font-size: 13px; text-decoration: none; width: max-content; transition: transform 0.2s, background 0.2s; }
.cta:hover { transform: translateY(-1px); background: var(--accent); color: var(--bg); }
.cta svg { transition: transform 0.2s; }
.cta:hover svg { transform: translateX(4px); }
@media (max-width: 768px) { .hero { grid-template-columns: 1fr; } .hero-image { height: 60vh; } }
\`\`\`

The pill CTA with arrow icon is non-negotiable for premium ecommerce. Boxy rectangular buttons read as 2018-SaaS.

Other essential patterns:
- **Sticky promo badge** in bottom-left corner ("Free shipping over $200" or "Save 15%") — small pill, semi-translucent dark background, white text, can be dismissed with an X.
- **Marquee announcement bar** at the very top (above the main nav) — slow scrolling text with offers / shipping notice.
- **Image-led product cards** with the photo taking 80% of card height, text taking 20%, with hover scale on the image.
- **Editorial section dividers** — hairline rule + uppercase section label, never a thick coloured stripe.

══════════════════════════════════════════════════════════════════════════
  #1 — MATCH THE BRIEF MOOD (this is the most-violated rule, read twice)
══════════════════════════════════════════════════════════════════════════

The creator's brief tells you the **mood, color world, and feel** they want.
Your palette + typography + layout MUST follow the brief, not your defaults.

- Brief says "Japanese minimalism, washi paper, slow morning" → bright off-white paper, soft serif, generous space. NOT dark.
- Brief says "Scandinavian midcentury showroom" → warm white walls, oak accents, sans-serif. NOT dark.
- Brief says "Italian gallery, marble, golden light" → cream, terracotta, gold. NOT dark.
- Brief says "Mediterranean atelier, terra cotta, linen" → warm earth tones, light. NOT dark.
- Brief says "noir, atmospheric, late-night studio" → THEN dark is right.
- Brief says "playful, candy colors, fun" → bright saturated palette, definitely NOT dark.
- Brief says nothing about mood → pick a LIGHT palette by default (most furniture brands are light/warm — Hem, Floyd, Burrow, Article, West Elm, Joybird, Lulu and Georgia, Sabbatical).

**Default to LIGHT.** Dark sites are a specific aesthetic choice, not a fallback. If you find yourself reaching for \`#06070d\` or any near-black background without the brief explicitly asking for it, you're wrong — pick again.

══════════════════════════════════════════════════════════════════════════
  #2 — USE THE SCRAPED REFERENCES (they're real data, not flavour text)
══════════════════════════════════════════════════════════════════════════

For every reference URL the creator pasted, the platform scraped the page and gave you their actual:
- Fonts loaded
- :root CSS custom properties (their real palette + spacing tokens)
- Sampled colors
- Voice / copy tone

You MUST use this DNA, not your training-data memory of those sites. If reference site loads Söhne + Söhne Mono, you should use a similar grotesque-sans + mono outlier pair (or those exact fonts if they're on Google Fonts). If their sampled palette is \`#faf6ef, #1a1814, #c9b89e\`, your output should land in the same lightness band and chroma range — not borrow blue.

Quote the references in your design_notes so the creator sees you considered them. Example: "Borrowed the spacious cream-paper aesthetic and tight-tracking serif from hem.com; used floyddetroit.com's playful section-rotation idea but with a different rhythm."

══════════════════════════════════════════════════════════════════════════
  #3 — INTERACTIVITY + ANIMATION IS REQUIRED (not optional restraint)
══════════════════════════════════════════════════════════════════════════

A storefront with zero animation feels static and unprofessional. You MUST include AT LEAST 3 of these, tastefully executed:

- **Scroll-triggered fade-in** on section headings and product cards (Intersection Observer, ~400ms ease)
- **Hover lift** on product cards (\`transform: translateY(-3px)\` + slight shadow on hover)
- **Image zoom on hover** in product cards (\`transform: scale(1.03)\` with overflow hidden)
- **Smooth scroll** to anchor links (\`html { scroll-behavior: smooth }\`)
- **Hero text reveal** (clip-path or letter stagger on load)
- **Marquee strip** (slow, looping wordmark or testimonial scroll) — optional
- **Subtle parallax** on hero image (background-position shift on scroll)
- **Animated underline** on text links (transform: scaleX from 0 → 1)
- **Number counters** if there are stats
- **Product carousel** if there are many pieces

All animations: respect \`prefers-reduced-motion\`. Use \`transition-duration: 200–400ms\` and \`cubic-bezier(0.16, 1, 0.3, 1)\` (ease-out-expo) for most. Don't autoplay video with sound. Don't use popups, exit-intent modals, or countdown timers.

Write the JS inline at the bottom of \`<body>\`. No external scripts.

══════════════════════════════════════════════════════════════════════════
  #4 — PAGE STRUCTURE (a real storefront, not a one-screen demo)
══════════════════════════════════════════════════════════════════════════

The page needs visual variety + multiple distinct sections. Minimum 5 sections, in order:

1. **Hero** — one of: full-bleed image background with overlaid text · big typographic statement with secondary illustration · split-screen (text + image) · stacked editorial intro
2. **About / Brand story** — 2-3 short paragraphs giving the maker's voice (use the {{about}} placeholder). Editorial typography, generous whitespace.
3. **Featured piece or "What I make"** — pull ONE detail or piece out for emphasis. Could be a quote, a single hero image with caption, or a process strip.
4. **{{products}}** — full pieces grid. Wrap in a \`<section id="pieces">\` so the \`{{cta_browse_pieces}}\` anchor works. Add a brief lead-in heading.
5. **Footer** — one of: marquee scroll · single-line minimal · letter sign-off · email signup. NOT a 4-column linkdump.

Optional bonus sections (use them if the brief calls for it): testimonials · process / materials story · maker bio · journal teaser · newsletter signup · location/contact.

══════════════════════════════════════════════════════════════════════════
  #5 — DIVERSIFY: pick a macrostructure that fits the brief
══════════════════════════════════════════════════════════════════════════

Pick from these 8 — never default to the same one twice in a row:

01 · **Long Document** — Reads like a memo/essay. Continuous prose with inline section heads. Best for: studio/atelier voice.
02 · **Marquee Hero** — Bold statement or huge image fills the viewport. Below is something different (a list, grid, prose). Best for: hero pieces.
03 · **Photographic** — Huge image dominates each fold. Text is small annotation. Best for: image-rich catalogues.
04 · **Letter** — First-person, intimate. Opens with a greeting. Reads as a personal note. Best for: solo makers, slow goods.
05 · **Quote-Led** — Hero is a pull-quote with attribution. Best for: stores with strong customer/press testimonials.
06 · **Catalogue** — Uniform grid of variations — pieces as a visual index. Best for: 8+ similar pieces.
07 · **Editorial Specimen** — Numbered left-margin labels, huge serif, asymmetric spans. Best for: design-forward type-conscious brands. Don't default to this.
08 · **Salon** — Soft, residential, curated. Warm neutrals, generous whitespace. Best for: warm decorative arts.

If iterating ("make the hero bigger"): keep the macrostructure, change only what was asked. If fresh design and prior macrostructure is known: pick a different one.

══════════════════════════════════════════════════════════════════════════
  #6 — TYPOGRAPHY (2-font pairing, real Google Fonts)
══════════════════════════════════════════════════════════════════════════

ONE display + ONE body, optional mono outlier for ONE place.

**Pick from:**
- Display serifs: Fraunces, Newsreader, Instrument Serif, Cormorant Garamond, DM Serif Display, EB Garamond, Playfair Display, Cormorant Infant, Tenor Sans
- Display sans: Manrope, DM Sans, Space Grotesk, Geist, Fraunces (with high weight)
- Body serifs: Crimson Pro, Source Serif Pro, Lora, Spectral
- Body sans: Inter (only body), DM Sans, Geist
- Mono outlier: JetBrains Mono, Geist Mono

**Banned defaults** (don't reach for): Roboto, Open Sans, Lato, Poppins, Montserrat, Raleway, system-ui-as-display, Arial, Helvetica. Inter-everywhere is the #1 AI tell. Single-font pages are slop.

**Use \`<link>\` to Google Fonts at top of \`<head>\`:**
\`\`\`html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;1,500&family=Inter:wght@400;500&display=swap" rel="stylesheet">
\`\`\`

**Discipline:** weight contrast (300 next to 700, not 400 next to 600). Modular scale (1.25 / 1.333 / 1.618). \`clamp()\` for fluid type. \`max-width: 65ch\` for body.

══════════════════════════════════════════════════════════════════════════
  #7 — COLOUR (light-first, OKLCH, tinted neutrals)
══════════════════════════════════════════════════════════════════════════

If no paletteHint and no dark-mood signal in the brief → use a light palette. Sample 4 sane defaults:

- **Warm cream + terracotta**: paper \`oklch(96% 0.012 70)\`, ink \`oklch(18% 0.010 50)\`, accent \`oklch(55% 0.16 35)\`
- **Off-white + olive**: paper \`oklch(95% 0.008 100)\`, ink \`oklch(20% 0.005 100)\`, accent \`oklch(45% 0.12 110)\`
- **Linen + oxblood**: paper \`oklch(94% 0.014 80)\`, ink \`oklch(18% 0.010 30)\`, accent \`oklch(35% 0.18 25)\`
- **Cool grey + navy**: paper \`oklch(97% 0.004 230)\`, ink \`oklch(22% 0.008 230)\`, accent \`oklch(38% 0.10 240)\`

Adapt these to the brief — never copy verbatim. Build a full token block with paper / paper-2 / rule / neutral / muted / ink / accent.

**Never** \`#000\` or \`#fff\`. Always tint neutrals toward the accent hue. Accent occupies ≤ 3% of viewport.

Required \`:root\` token names (so the platform's style editor works on top):
\`\`\`css
:root {
  /* your palette as OKLCH */
  --color-paper: …; --color-paper-2: …; --color-rule: …;
  --color-neutral: …; --color-muted: …; --color-ink: …;
  --color-accent: …; --color-focus: …;
  /* MIRROR aliases — the style editor injects overrides on these names */
  --bg: var(--color-paper);          --store-bg: var(--color-paper);
  --text: var(--color-ink);          --store-text: var(--color-ink);
  --muted: var(--color-muted);       --store-muted: var(--color-muted);
  --accent: var(--color-accent);     --store-accent: var(--color-accent);
  --display-font: …;                 --store-display-font: var(--display-font);
  --body-font: …;                    --store-body-font: var(--body-font);
}
\`\`\`

USE the variables everywhere below \`:root\`. NEVER hardcode \`color: #ff5500\` or \`font-family: "Inter"\` outside the token block.

══════════════════════════════════════════════════════════════════════════
  #8 — NAV + FOOTER VOICE (avoid the AI defaults)
══════════════════════════════════════════════════════════════════════════

**Nav (pick one)**: Floating-pill centered · edge-aligned minimal · newspaper masthead · hidden-then-appears-on-scroll · inline-with-content. **Avoid**: wordmark-left + 4-link-row + button-right at full width (that's the SaaS AI default).

**Footer (pick one)**: huge wordmark only · single inline line · dense colophon paragraph · single statement sentence · letter sign-off · newsletter-first · marquee scroll. **Avoid**: 4-column linkdump with "Resources/Legal" columns.

══════════════════════════════════════════════════════════════════════════
  #8.5 — TEXT CONTRAST (every text element must be readable)
══════════════════════════════════════════════════════════════════════════

For EVERY text element in the design, the contrast ratio against its background must be at least **4.5:1** (WCAG AA for body text) or **3:1** (large display text).

- Body copy (var(--text) on var(--bg)): check the OKLCH lightness diff. If \`--bg\` is light (L > 80%), \`--text\` must be dark (L < 30%). Vice versa.
- Muted text (var(--muted) on var(--bg)): minimum 3:1 ratio. Don't drift into "unreadable grey."
- Text on photos/videos: ALWAYS add a gradient overlay (\`linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.4-0.6) 100%)\` for white text on imagery; reverse for dark text on light imagery).
- Text on accent color: if you put white text on the accent button, the accent must be dark enough. If accent is a warm light (gold, butter, peach), use \`var(--text)\` not white.
- Hover states: maintain contrast in hovered states too.

If you're unsure whether a color combo works, ADD A FALLBACK: text-shadow on overlaid text, or wrap text in a tonal block (\`background: color-mix(in srgb, var(--bg) 75%, transparent)\`) so it always has its own readable surface.

══════════════════════════════════════════════════════════════════════════
  #9 — ANTI-PATTERNS (the AI tells — never emit these)
══════════════════════════════════════════════════════════════════════════

× Purple-to-pink gradient hero · Gradient headlines (\`background-clip: text\`) · 3-column equal feature grid · card-in-card · side-stripe cards · full-viewport-centred hero with one CTA · aurora blob backgrounds · floating 3D orbs · fake browser chrome (URL pill + traffic dots) · fake phone bezels · invented metrics ("+47%", "50,000+ teams") · lorem ipsum · stock-photo "Jane Doe CEO" testimonials · autoplay sound · lazy-loaded LCP image · pure \`#000\`/\`#fff\` · "Trusted by" logo wall with made-up logos.

══════════════════════════════════════════════════════════════════════════
  #10 — HONEST COPY (no fabrication)
══════════════════════════════════════════════════════════════════════════

If the creator didn't supply a metric, customer count, press mention, or founding year — DO NOT invent one. Use a placeholder dash or pick a different layout. Lean on tagline + about + product names — those are real.

══════════════════════════════════════════════════════════════════════════
  #11 — MOBILE (non-negotiable, 320 / 375 / 414 / 768 px)
══════════════════════════════════════════════════════════════════════════

\`html, body { overflow-x: clip }\` (never \`hidden\`). Grid tracks \`minmax(0, 1fr)\` never bare \`1fr\`. Display headings \`overflow-wrap: anywhere; min-width: 0\`. Section heads collapse to one column. No two-line clickable text. Use \`clamp(2rem, 5vw + 1rem, 5rem)\` for fluid type.

══════════════════════════════════════════════════════════════════════════
  #12 — PLATFORM PLACEHOLDERS (use these exact tokens, no others)
══════════════════════════════════════════════════════════════════════════

The platform substitutes these server-side at render time. Use them — never invent text in their place:
- \`{{store_name}}\` → creator's store name
- \`{{tagline}}\` → tagline (may be empty — handle gracefully with conditional CSS)
- \`{{about}}\` → about copy with line breaks preserved (may be empty)
- \`{{logo_url}}\` → logo URL or empty string (wrap in \`<img>\` only if non-empty, use \`onerror="this.style.display='none'"\` to hide on failure)
- \`{{products}}\` → pre-rendered HTML of product cards (you write the surrounding section structure, NOT the cards)
- \`{{cta_browse_pieces}}\` → resolves to \`#pieces\` — use for "view pieces" CTAs

**Wrap \`{{products}}\` in \`<section id="pieces">\`** so the anchor works.

══════════════════════════════════════════════════════════════════════════
  #13 — SELF-CHECK BEFORE EMITTING
══════════════════════════════════════════════════════════════════════════

Before returning the JSON, scan your draft and confirm:

☐ Palette matches the brief mood (NOT defaulting to dark)
☐ Reference DNA visibly informed the choices (fonts? colors? tone?)
☐ At least 3 animation/interaction patterns are in the code (with prefers-reduced-motion)
☐ 5+ distinct sections, not a one-screen demo
☐ Uses CSS variables throughout, no hardcoded colors/fonts below \`:root\`
☐ Mobile-responsive (clamp, overflow-x: clip, minmax(0, 1fr))
☐ Zero invented metrics or fake testimonials
☐ Nav is NOT wordmark+4-links+button, footer is NOT a 4-column linkdump
☐ Real Google Fonts pairing (display + body), not Inter-everywhere

Stamp the design at the top of \`<style>\`:
\`\`\`css
/* Ariadne · macrostructure: Long Document · palette band: light-warm
 * reference adherence: borrowed Söhne pairing from hem.com + cream paper from kvadrat.dk
 * interactions: scroll-fade-in · hover-lift · smooth-scroll · animated-underline
 */
\`\`\`

══════════════════════════════════════════════════════════════════════════
  #13.5 — DO NOT BREAK YOUR OWN <style> / <script> BLOCKS
══════════════════════════════════════════════════════════════════════════

Browsers parse \`<style>\` and \`<script>\` blocks as raw text and TERMINATE them at the FIRST occurrence of \`</style>\` or \`</script>\` they see — even inside CSS strings, comments, or JS string literals. Common ways you accidentally do this:

× CSS comment with the literal closing tag in it: \`/* end of </style> */\`
× CSS content rule with closing tag: \`content: "</style>";\`
× JS string with closing tag: \`var x = "</script>";\`
× Inline SVG inside HTML with embedded \`<script>\` content

If you EVER need to refer to the substring \`</style>\` or \`</script>\` inside the body of one of those blocks, ALWAYS split it so the browser parser doesn't see the literal closing tag. For example:
- In CSS: \`content: "<""/style>";\` (concatenate two strings)
- In JS: \`var x = "<" + "/script>";\` (concatenate)
- Or just don't reference these substrings at all — there's almost never a reason.

Same applies to decorative comment dividers — don't include \`</style>\` or \`</script>\` substrings in your \`═══\` comment dividers. If you need a section divider, use only forward slashes and asterisks (e.g., \`/* ──── HEADER ──── */\`).

══════════════════════════════════════════════════════════════════════════
  #14 — OUTPUT FORMAT (strict JSON only)
══════════════════════════════════════════════════════════════════════════

Return ONLY valid JSON, no prose:

\`\`\`json
{
  "html": "<!DOCTYPE html>\\n<html lang=\\"en\\">\\n<head>...</head>\\n<body>...{{products}}...</body>\\n</html>",
  "summary": "One short sentence: macrostructure + palette band + the single design move that makes this specific.",
  "design_notes": [
    "Macrostructure + palette + typography pairing — and WHY for this brief",
    "Reference adherence — which scraped sites informed which choices",
    "Interaction list — what animates and on what trigger",
    "The one design move that makes this NOT look generic"
  ]
}
\`\`\`

ITERATION RULES:
- "make the hero bigger" → keep macrostructure, theme, type. Change only what was asked. Return full updated HTML.
- "use warmer palette" → keep everything but the palette. Return full updated HTML.
- "I want a totally different feel" → fresh macrostructure + palette. Pick differently from previous.`;

/**
 * Generate a storefront design. Single-shot (not streaming yet — streaming
 * adds complexity around SSE that we can add in a follow-up).
 *
 * @returns {Promise<{ html: string, summary: string, design_notes: string[] }>}
 */
export async function designStorefront({
  designBrief,
  referenceUrls = [],
  inspirationImages = [],
  products = [],
  storeBasics,
  priorHtml = null,
  priorCss = null,
  userMessage = null,
  chatHistory = [],
}) {
  const userBlocks = [];

  // Scrape reference URLs ONCE (parallel) — extracts real design DNA
  // (fonts loaded, :root CSS vars, palette, copy tone) instead of relying
  // on Claude's training-data memory of the site.
  const refDna = referenceUrls.length > 0 ? await scrapeReferences(referenceUrls) : [];
  if (refDna.length > 0) {
    for (const r of refDna) {
      if (r.error) {
        console.log(`[ariadne] reference scrape: ${r.url} → FAILED (${r.error})`);
      } else {
        console.log(
          `[ariadne] reference scrape: ${r.url} → fonts=${r.fonts.length} ` +
          `cssVars=${Object.keys(r.cssVars).length} colors=${r.palette.length} ` +
          `tone=${r.tone ? "✓" : "✗"}`
        );
      }
    }
  }

  // The featured product's hero photo URL — Claude should use this as the
  // hero IMAGE if there's no video, or as a fallback poster behind the video.
  const heroImageUrl = products[0]?.hero_image_url ?? null;
  // If the first product has a generated hero video, bake an explicit
  // recipe into the brief so Claude builds a scroll-scrubbed video hero.
  const heroVideoUrl = products[0]?.hero_video_url ?? null;
  // Always provide the hero IMAGE for cases where Claude isn't building a
  // video hero — use it in the split-editorial hero, marquee hero, or as
  // a poster image.
  const heroImageBlock = heroImageUrl
    ? `

## The featured piece has a high-quality lifestyle photo

URL: \`${heroImageUrl}\`

This is a professionally-generated editorial photo of the actual piece. USE IT as the hero image (split-editorial pattern: photo on one side, text on the other) OR as a full-bleed background. Do NOT use a gradient placeholder or generic stock photo when this URL is available. The photo IS the hero — text floats next to it or over it.

Reference how saltandstone.com / hem.com use a single dominant product photo in their hero: huge, photographed, the type quietly placed alongside.
`
    : "";

  const heroVideoBlock = heroVideoUrl
    ? `

## ⚠️ MANDATORY: A 10-second cinematic hero video is the LANDING PAGE CENTERPIECE

URL: \`${heroVideoUrl}\`

This video is a 360-degree cinematic reveal of the featured piece in a real interior setting. It MUST be the **primary visual element of the landing page**. Not "a video at the top" — THE hero. The entire first screen is the video. Scrolling through the first 100vh of the page scrubs the video.

This is non-negotiable. If you do not build a scroll-scrubbed video hero, the design is wrong.

EXACT IMPLEMENTATION (copy this pattern, customize copy/typography on top):

\`\`\`html
<!-- Fixed full-viewport video, behind all content -->
<div id="hero-video-wrap" style="position: fixed; inset: 0; z-index: -1; background: var(--bg);">
  <video
    id="hero-video"
    src="${heroVideoUrl}"
    muted playsinline preload="auto"
    style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 100%; min-height: 100%; width: auto; height: auto; object-fit: cover;"
  ></video>
  <!-- Subtle gradient overlay for legibility of overlaid text -->
  <div style="position: absolute; inset: 0; background: linear-gradient(180deg, color-mix(in srgb, var(--bg) 30%, transparent) 0%, transparent 30%, transparent 70%, color-mix(in srgb, var(--bg) 70%, transparent) 100%);"></div>
</div>

<!-- Content above the video — use position: relative with z-index higher than -1 -->
<main style="position: relative; z-index: 1;">
  <!-- Hero section: 100vh, content overlaid on the video -->
  <section style="min-height: 100vh; display: flex; flex-direction: column; justify-content: flex-end; padding: clamp(2rem, 5vw, 5rem);">
    <h1>{{store_name}}</h1>
    <p>{{tagline}}</p>
  </section>

  <!-- More sections below scroll over the video -->
  ...

  <!-- The scroll-end anchor: when this section is in view, the video has played fully -->
  <section id="scroll-end">
    <!-- Could be your products section, about, or footer -->
    {{products}}
  </section>
</main>

<script>
(function() {
  const video = document.getElementById('hero-video');
  const endRef = document.getElementById('scroll-end');
  if (!video || !endRef) return;

  function onScroll() {
    // CRITICAL: video.seeking guard prevents frame tearing during rapid scroll
    if (!video.duration || video.seeking) return;
    const rect = endRef.getBoundingClientRect();
    const absoluteTop = window.scrollY + rect.top;
    const stopScroll = Math.max(1, absoluteTop - window.innerHeight * 0.2);
    const fraction = Math.max(0, Math.min(1, window.scrollY / stopScroll));
    video.currentTime = fraction * video.duration;
  }

  function ready() {
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }
  if (video.readyState >= 3) ready();
  else video.addEventListener('canplaythrough', ready, { once: true });
  video.load();
})();
</script>
\`\`\`

REQUIREMENTS:
- The video MUST be fixed full-viewport behind content. \`position: fixed; inset: 0; z-index: -1\`.
- Content sections MUST have \`position: relative; z-index: 1+\` so they stack above.
- The scroll-end anchor (\`id="scroll-end"\`) marks where the video reaches its final frame. Place it on the products section OR a section just before the footer.
- The video has NO controls, NO autoplay sound, and NO native loop — it's scrubbed by JS.
- The video is the SOLE content of the first ~100vh of the page. No header/nav overlaying it (or minimal floating-pill nav only). Just the video + ONE typographic moment (store name or tagline) at the bottom-left or bottom-center.

⚠️ TEXT CONTRAST OVER MEDIA (mandatory — most-violated rule):
When text is overlaid on the video or any photo background, ensure 4.5:1+ contrast ratio. The video has varied frames (bright + dark areas), so PROTECT the text with:

- A **bottom-third dark gradient** overlay on the video:
  \`background: linear-gradient(180deg, transparent 0%, transparent 40%, rgba(0,0,0,0.55) 100%);\`
  This keeps the top free for the video to breathe, and darkens the bottom where text sits.
- If the brief is light/warm (cream palette), use **white text + dark gradient** at the bottom (the gradient is the contrast).
- If the brief is dark, white text works directly — but still add a subtle gradient.
- NEVER place dark text directly on a video — the video frame may be dark.
- Hero text should have \`text-shadow: 0 2px 24px rgba(0,0,0,0.45);\` as a fallback safety.

DESIGN INTEGRATION:
- Hero text: ONE bold typographic statement, bottom-aligned. NOT a long paragraph.
- Format: small uppercase eyebrow tag ("Featured piece" / "Now showing") + big serif headline (the store name OR the piece title) + ONE-line subtitle. Maybe a pill CTA. That's it.
- Layer the {{about}}, {{products}}, and footer as SOLID sections that scroll OVER the video. Each section needs its own background (solid var(--bg) or semi-transparent with backdrop-filter blur) so the page reads cleanly once you've scrolled past the video.
- Time the section transitions to feel cinematic — fades, slides, scale reveals on enter.
` : "";

  // ── User intro block: structured project brief ─────────────────────
  const projectBrief = [
    `# Project: storefront for "${storeBasics.storeName}"`,
    storeBasics.tagline ? `Tagline: ${storeBasics.tagline}` : null,
    storeBasics.about ? `About the creator: ${storeBasics.about}` : null,
    "",
    "## Design brief (creator's words):",
    designBrief || "(no brief — use your judgment based on the products and inspirations)",
    "",
    refDna.length > 0
      ? `## Reference sites — actually scraped, not from memory:\n${refDna
          .map((r, i) => formatReferenceDna(r, i + 1))
          .join("\n\n")}\n\nUse these as REAL inspiration: borrow the typography pairings if they fit the brief, sample colors from the palette, match the copy tone. Don't replicate the layout — riff on the energy.`
      : null,
    "",
    `## Products to feature (${products.length}):`,
    products.length === 0
      ? "(none yet — design as if pieces are coming soon, with a heroic invitation)"
      : products.slice(0, 12).map((p) =>
          `- "${p.title}" (${p.spec_json?.category ?? "piece"}, ${p.spec_json?.primary_material ?? "—"}, $${(p.price_cents / 100).toFixed(0)})`
        ).join("\n"),
    "",
    storeBasics.paletteHint
      ? `## Palette hint:\n${JSON.stringify(storeBasics.paletteHint)}\nYou MAY override if the brief calls for something different.`
      : null,
    heroImageBlock,
    heroVideoBlock,
  ]
    .filter(Boolean)
    .join("\n");

  userBlocks.push({ type: "text", text: projectBrief });

  // ── Inspiration images via Claude's vision ─────────────────────────
  for (const imageUrl of inspirationImages.slice(0, 6)) {
    const u = absoluteImageUrl(imageUrl);
    if (!u) continue;
    userBlocks.push({
      type: "image",
      source: { type: "url", url: u },
    });
  }
  if (inspirationImages.length > 0) {
    userBlocks.push({
      type: "text",
      text: `Above are inspiration images the creator uploaded. Extract the aesthetic — color palette, mood, materials, type of photography, sense of space — and let it influence the design. Don't replicate; absorb.`,
    });
  }

  // ── Iteration: include prior version + chat history ────────────────
  if (priorHtml) {
    // Extract the prior Hallmark stamp so Claude knows what to diverge
    // from (or preserve on iteration).
    const stampMatch = priorHtml.match(/Hallmark[^\n]*?macrostructure:\s*([^·\n]+).*?theme:\s*([^·\n]+)/i);
    if (stampMatch) {
      userBlocks.push({
        type: "text",
        text: `## Prior design's structural fingerprint:\n- macrostructure: ${stampMatch[1].trim()}\n- theme: ${stampMatch[2].trim()}\n\nIf this is a refinement (the creator gave an instruction like "make the hero bigger"), KEEP these. If the creator asked for a fresh redesign, pick a DIFFERENT macrostructure and a DIFFERENT theme — the diversification rule applies.`,
      });
    }
    userBlocks.push({
      type: "text",
      text: `## Current version (HTML):\n\`\`\`html\n${priorHtml.slice(0, 30_000)}\n\`\`\``,
    });
  }

  if (userMessage) {
    userBlocks.push({
      type: "text",
      text: `## The creator's latest instruction:\n"${userMessage}"\n\nApply this change while keeping everything else that works (same macrostructure, theme, typography unless explicitly told otherwise). Return the FULL updated HTML.`,
    });
  } else {
    userBlocks.push({
      type: "text",
      text: `Design and build this storefront with full Hallmark discipline. Take your time — pick the macrostructure first (state it in design_notes), then the theme, then the typography pairing, then write the page. Score yourself on the six axes BEFORE emitting and revise if anything is below 3. Make it look like nothing else on the marketplace.`,
    });
  }

  const messages = [
    ...chatHistory.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userBlocks },
  ];

  // Use the streaming helper because max_tokens=24k can take >10 min, and
  // the Anthropic API refuses non-streaming requests at that threshold.
  // `.stream()` opens an SSE connection; `.finalMessage()` waits for completion
  // and returns the same shape as `.create()` — so the rest of the code is
  // unchanged.
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 24_000,
    system: SYSTEM_PROMPT,
    messages,
  });
  const response = await stream.finalMessage();

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  // Extract the JSON block. Claude sometimes wraps it in ```json fences.
  const parsed = extractDesignJson(text);
  if (!parsed?.html) {
    throw new Error(
      `Site generator returned unparseable output. First 500 chars: ${text.slice(0, 500)}`
    );
  }
  // Sanitize <style> / <script> blocks so internal </style> / </script>
  // (in comments, content rules, etc.) don't terminate the block early.
  // Without this the rest of the CSS bleeds into the body as visible text.
  const safeHtml = sanitizeClaudeHtml(parsed.html);
  // Quick sanity: warn if we had to fix anything.
  if (safeHtml.length !== parsed.html.length) {
    console.log(
      `[ariadne] sanitizer: fixed ${parsed.html.length - safeHtml.length < 0 ? "added" : "escaped"} ` +
      `${Math.abs(parsed.html.length - safeHtml.length)} chars in <style>/<script> blocks`
    );
  }
  return {
    html: safeHtml,
    summary: parsed.summary ?? "",
    design_notes: Array.isArray(parsed.design_notes) ? parsed.design_notes : [],
    usage: response.usage,
    model: response.model,
  };
}

/**
 * Sanitize Claude-generated HTML so the browser doesn't terminate <style>
 * or <script> blocks early. Browsers parse these blocks as raw text and
 * close them at the FIRST </style> or </script> they see — even inside
 * CSS strings or comments. So a single `content: "</style>"` rule or a
 * decorative `/* </style> *\/` comment blows up the whole page (the rest
 * of the CSS becomes visible body text).
 *
 * For each <style> / <script> block we find:
 *   1. Find the LAST </style> (or </script>) before the next opening tag
 *      of the same kind — that's the REAL closing tag.
 *   2. Replace any EARLIER </style> (or </script>) inside the block with
 *      an escaped form: <\/style> / <\/script>. The browser still parses
 *      the closing tag as text, but doesn't terminate the block.
 *   3. If no closing tag is found at all (Claude forgot), inject one.
 */
function sanitizeClaudeHtml(html) {
  for (const tag of ["style", "script"]) {
    const openRe = new RegExp(`<${tag}\\b[^>]*>`, "i");
    const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
    let cursor = 0;
    while (cursor < html.length) {
      const openMatch = html.slice(cursor).match(openRe);
      if (!openMatch || openMatch.index === undefined) break;
      const absOpenStart = cursor + openMatch.index;
      const absOpenEnd = absOpenStart + openMatch[0].length;
      const afterOpen = html.slice(absOpenEnd);
      const nextOpenMatch = afterOpen.match(openRe);
      const segmentEnd = nextOpenMatch && nextOpenMatch.index !== undefined
        ? absOpenEnd + nextOpenMatch.index
        : html.length;
      const segment = html.slice(absOpenEnd, segmentEnd);
      closeRe.lastIndex = 0;
      let lastCloseIdx = -1;
      let lastCloseLen = 0;
      let cm;
      while ((cm = closeRe.exec(segment)) !== null) {
        lastCloseIdx = cm.index;
        lastCloseLen = cm[0].length;
      }
      if (lastCloseIdx === -1) {
        const injectAt = findCssEnd(segment);
        html =
          html.slice(0, absOpenEnd) +
          segment.slice(0, injectAt) +
          `</${tag}>` +
          segment.slice(injectAt) +
          html.slice(segmentEnd);
        cursor = absOpenEnd + injectAt + `</${tag}>`.length;
        continue;
      }
      const beforeContent = segment.slice(0, lastCloseIdx);
      const escaped = beforeContent.replace(closeRe, `<\\/${tag}>`);
      const realClose = segment.slice(lastCloseIdx, lastCloseIdx + lastCloseLen);
      const afterClose = segment.slice(lastCloseIdx + lastCloseLen);
      html =
        html.slice(0, absOpenEnd) +
        escaped +
        realClose +
        afterClose +
        html.slice(segmentEnd);
      const grew = escaped.length - beforeContent.length;
      cursor = absOpenEnd + lastCloseIdx + grew + lastCloseLen;
    }
  }
  return html;
}

function findCssEnd(segment) {
  const htmlTagRe = /<(?:html|head|body|nav|header|main|footer|section|article|div|aside|p|h[1-6]|ul|ol|figure|img|video|iframe|button|a)\b/i;
  const m = segment.match(htmlTagRe);
  if (m && m.index !== undefined) return m.index;
  return segment.length;
}

function extractDesignJson(text) {
  // Try fenced JSON first
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* fall through */ }
  }
  // Try any fenced code block
  const anyFence = text.match(/```\s*([\s\S]*?)```/);
  if (anyFence) {
    try { return JSON.parse(anyFence[1]); } catch { /* fall through */ }
  }
  // Try the whole response
  try { return JSON.parse(text); } catch { /* fall through */ }
  // Try locating the outer braces
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch { return null; }
  }
  return null;
}

function formatReferenceDna(r, idx) {
  if (r.error) {
    return `### ${idx}. ${r.url}\n(couldn't scrape: ${r.error}. Use your training-data memory if you have it.)`;
  }
  const parts = [`### ${idx}. ${r.url}`];
  if (r.title) parts.push(`Title: ${r.title}`);
  if (r.description) parts.push(`Meta: ${r.description}`);
  if (r.fonts.length > 0) parts.push(`Fonts loaded: ${r.fonts.join(", ")}`);
  if (Object.keys(r.cssVars).length > 0) {
    const sample = Object.entries(r.cssVars).slice(0, 12).map(([k, v]) => `--${k}: ${v}`).join("; ");
    parts.push(`CSS vars: ${sample}`);
  }
  if (r.palette.length > 0) parts.push(`Colors sampled: ${r.palette.join(", ")}`);
  if (r.tone) parts.push(`Voice / copy tone (sample): "${r.tone.slice(0, 280)}…"`);
  return parts.join("\n");
}

function absoluteImageUrl(u) {
  if (!u) return null;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  // Relative URL like /store-assets/foo.png — convert to absolute using
  // the public URL of this dev/prod server. Falls back to the dev port.
  const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:5173";
  return `${base.replace(/\/$/, "")}${u.startsWith("/") ? "" : "/"}${u}`;
}
