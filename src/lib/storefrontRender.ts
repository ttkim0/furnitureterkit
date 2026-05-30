// Server-substitution of placeholders in the Claude-generated storefront HTML.
//
// Claude is told to emit `{{placeholders}}` for:
//   {{store_name}}, {{tagline}}, {{about}}, {{logo_url}},
//   {{products}}, {{cta_browse_pieces}}
//
// We do the substitution at render-time so:
//   - New products show up without regenerating the design
//   - Store name / tagline / logo edits propagate immediately
//   - The generated HTML is reusable + small
//
// The product card structure is fixed (so analytics + link integrity
// are guaranteed across all storefronts). Creators customize the OUTER
// design freely — the cards inside the {{products}} block are platform-
// rendered.

import { formatPrice } from "./marketplace";
import { buildVisualEditorTag, type VisualOverrides } from "./visualEditorPreload";

export interface RenderableProduct {
  id: string;
  slug: string;
  title: string;
  price_cents: number;
  currency: string;
  hero_image_url: string | null;
  description: string | null;
}

export interface PaletteOverride {
  primary?: string;
  accent?: string;
  text?: string;
  muted?: string;
}

export interface TypographyOverride {
  display?: string; // e.g. '"EB Garamond", Georgia, serif'
  body?: string; // e.g. '"Inter", sans-serif'
  /** If provided, we'll <link> these Google Fonts before rendering. */
  googleFontFamilies?: string[]; // e.g. ['EB+Garamond:ital@1', 'Inter:wght@400;500']
}

export interface StorefrontContext {
  store_name: string;
  tagline: string;
  about: string;
  logo_url: string;
  products: string; // pre-rendered HTML from renderProductGridHtml
  /** Optional per-store overrides applied AFTER the generated CSS so the
   *  owner's tweaks always win. */
  paletteOverride?: PaletteOverride;
  typographyOverride?: TypographyOverride;
  /** Per-element text + style overrides from the visual editor. Applied
   *  by an injected script after page load. */
  visualOverrides?: VisualOverrides;
  /** When true, inject the visual editor preload script. Owners get this;
   *  visitors don't (the script adds editing hooks). */
  includeVisualEditor?: boolean;
}

export function renderStorefrontHtml(template: string, ctx: StorefrontContext): string {
  // Sanitize the template first — fix any pre-broken HTML where Claude
  // emitted </style> or </script> literally inside the block content.
  // This rescues already-saved stores without requiring a regeneration.
  let html = sanitizeStyleBlocks(template);
  html = html
    .replace(/\{\{store_name\}\}/g, escapeHtml(ctx.store_name))
    .replace(/\{\{tagline\}\}/g, escapeHtml(ctx.tagline))
    .replace(/\{\{about\}\}/g, escapeHtml(ctx.about).replace(/\n/g, "<br>"))
    .replace(/\{\{logo_url\}\}/g, escapeAttr(ctx.logo_url))
    .replace(/\{\{cta_browse_pieces\}\}/g, "#pieces")
    .replace(/\{\{products\}\}/g, ctx.products);

  // Inject <base target="_top"> so all link clicks navigate the parent
  // window, not the sandboxed iframe (which would hit the React app with
  // no localStorage / no Supabase session → blank page).
  // Also inject style overrides at the end of <head> so they win over
  // Claude's generated styles.
  const baseTag = '<base target="_top">';
  const overrideStyles = buildOverrideStyles(ctx.paletteOverride, ctx.typographyOverride);
  const googleFontsLink = buildGoogleFontsLink(ctx.typographyOverride?.googleFontFamilies ?? []);
  const headInjection = `\n${baseTag}\n${googleFontsLink}\n${overrideStyles}\n`;

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}${headInjection}`);
  } else if (/<html[^>]*>/i.test(html)) {
    // Claude forgot <head> — inject one
    html = html.replace(/<html([^>]*)>/i, (m) => `${m}<head>${headInjection}</head>`);
  } else {
    // Bare fragment — wrap minimally
    html = `<!DOCTYPE html><html><head>${headInjection}</head><body>${html}</body></html>`;
  }

  // Inject the visual editor script + per-element overrides at the END
  // of <body> so it runs after all platform content has rendered. For
  // visitors (no editor), we still inject the overrides applicator so
  // saved edits are visible. The full editor (hover/click handlers)
  // only runs when includeVisualEditor=true.
  const overrides = ctx.visualOverrides ?? {};
  const hasOverrides = Object.keys(overrides.text ?? {}).length > 0 || Object.keys(overrides.style ?? {}).length > 0;
  if (ctx.includeVisualEditor || hasOverrides) {
    const scriptTag = buildVisualEditorTag(overrides);
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${scriptTag}</body>`);
    } else {
      html = `${html}${scriptTag}`;
    }
  }

  return html;
}

function buildOverrideStyles(
  pal?: PaletteOverride,
  typo?: TypographyOverride
): string {
  if (!pal && !typo) return "";
  const decls: string[] = [];
  if (pal?.primary) {
    decls.push(`--bg: ${pal.primary}`);
    decls.push(`--store-bg: ${pal.primary}`);
  }
  if (pal?.accent) {
    decls.push(`--accent: ${pal.accent}`);
    decls.push(`--store-accent: ${pal.accent}`);
  }
  if (pal?.text) {
    decls.push(`--text: ${pal.text}`);
    decls.push(`--store-text: ${pal.text}`);
  }
  if (pal?.muted) {
    decls.push(`--muted: ${pal.muted}`);
    decls.push(`--store-muted: ${pal.muted}`);
  }
  if (typo?.display) {
    decls.push(`--display-font: ${typo.display}`);
    decls.push(`--store-display-font: ${typo.display}`);
  }
  if (typo?.body) {
    decls.push(`--body-font: ${typo.body}`);
    decls.push(`--store-body-font: ${typo.body}`);
  }
  if (decls.length === 0) return "";
  // Use a high-specificity selector + !important on body to win against
  // Claude's hardcoded color/font properties (sometimes the model writes
  // direct colors instead of using the var). Body-level !important on
  // background-color + color cascades to most of the page.
  return `<style id="ariadne-style-override">
:root, html, body {
  ${decls.join(";\n  ")};
}
${pal?.primary ? `html, body { background-color: ${pal.primary} !important; }` : ""}
${pal?.text ? `body { color: ${pal.text} !important; }` : ""}
${typo?.display ? `h1, h2, h3, h4, h5, h6, .display, .hero, [class*="title"] { font-family: ${typo.display} !important; }` : ""}
${typo?.body ? `body, p, span:not([class*="title"]), li, a, button, input, textarea, select { font-family: ${typo.body} !important; }` : ""}
</style>`;
}

function buildGoogleFontsLink(families: string[]): string {
  if (families.length === 0) return "";
  const familyParam = families.map((f) => `family=${encodeURIComponent(f)}`).join("&");
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${familyParam}&display=swap" rel="stylesheet">`;
}

/** Build the product cards HTML that goes inside the {{products}} block.
 *  This is fixed structure — creators customize the surrounding container
 *  via Claude, but the cards stay consistent for analytics + link
 *  reliability. */
export function renderProductGridHtml(
  products: RenderableProduct[],
  storeSlug: string
): string {
  if (products.length === 0) {
    return `<div class="ariadne-products-empty"><p>New pieces are on the way.</p></div>`;
  }
  const cards = products.map((p) => {
    const img = p.hero_image_url
      ? `<img src="${escapeAttr(p.hero_image_url)}" alt="${escapeAttr(p.title)}" loading="lazy">`
      : `<div class="ariadne-card-thumb-placeholder"></div>`;
    const href = `/shop/${encodeURIComponent(storeSlug)}/${encodeURIComponent(p.slug)}`;
    return `
<a href="${href}" class="ariadne-product-card" data-product-id="${escapeAttr(p.id)}">
  <div class="ariadne-card-image">${img}</div>
  <div class="ariadne-card-meta">
    <h3 class="ariadne-card-title">${escapeHtml(p.title)}</h3>
    <span class="ariadne-card-price">${formatPrice(p.price_cents, p.currency)}</span>
  </div>
</a>`;
  }).join("\n");

  // Wrap in a grid container. Creators' CSS can target .ariadne-product-grid
  // or override entirely.
  return `<div class="ariadne-product-grid">${cards}</div>

<style>
.ariadne-product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 40px 28px;
}
.ariadne-product-card {
  text-decoration: none;
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.18s;
}
.ariadne-product-card:hover { transform: translateY(-3px); }
.ariadne-card-image {
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.06);
  border-radius: 10px;
}
.ariadne-card-image img { width: 100%; height: 100%; object-fit: cover; }
.ariadne-card-thumb-placeholder {
  width: 100%; height: 100%;
  background: linear-gradient(135deg, rgba(160,140,100,0.18), rgba(127,127,127,0.06));
}
.ariadne-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.ariadne-card-title { margin: 0; font-weight: 400; font-size: 18px; }
.ariadne-card-price { opacity: 0.8; font-size: 14px; }
.ariadne-products-empty { padding: 60px 20px; text-align: center; opacity: 0.6; }
</style>`;
}

/**
 * Escape stray </style> or </script> inside their own blocks so the browser
 * doesn't terminate them early (which causes CSS/JS to leak into the body
 * as visible text).
 *
 * Walks forward through the HTML one tag-pair at a time, re-scanning for
 * the next opener after each mutation (so positions stay accurate even
 * when the HTML grows from escapes/injections). For each block we:
 *
 *   1. Find the next opener (e.g. <style>)
 *   2. Scan from open.end forward until we hit either (a) the next opener
 *      of the SAME tag, or (b) end of document
 *   3. Within that segment, find the LAST </tag> — that's the real close
 *   4. Escape any earlier </tag> in the segment (premature closures)
 *   5. If no </tag> exists in the segment, inject one before the first
 *      HTML-looking content (e.g. <body>, <nav>) so body content doesn't
 *      get sucked into the style block
 */
export function sanitizeStyleBlocks(html: string): string {
  for (const tag of ["style", "script"] as const) {
    const openRe = new RegExp(`<${tag}\\b[^>]*>`, "i");
    const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
    let cursor = 0;
    while (cursor < html.length) {
      // Locate the next opener after cursor.
      const openMatch = html.slice(cursor).match(openRe);
      if (!openMatch || openMatch.index === undefined) break;
      const absOpenStart = cursor + openMatch.index;
      const absOpenEnd = absOpenStart + openMatch[0].length;
      // Bound the segment by the next opener of the SAME tag (or doc end).
      const afterOpen = html.slice(absOpenEnd);
      const nextOpenMatch = afterOpen.match(openRe);
      const segmentEnd = nextOpenMatch && nextOpenMatch.index !== undefined
        ? absOpenEnd + nextOpenMatch.index
        : html.length;
      const segment = html.slice(absOpenEnd, segmentEnd);

      // Find the LAST </tag> in the segment.
      closeRe.lastIndex = 0;
      let lastCloseIdx = -1;
      let lastCloseLen = 0;
      let cm: RegExpExecArray | null;
      while ((cm = closeRe.exec(segment)) !== null) {
        lastCloseIdx = cm.index;
        lastCloseLen = cm[0].length;
      }

      if (lastCloseIdx === -1) {
        // No closing tag in this segment — inject one before the first
        // HTML-looking element to avoid sucking the body into the block.
        const injectAt = findCssEnd(segment);
        const newHtml =
          html.slice(0, absOpenEnd) +
          segment.slice(0, injectAt) +
          `</${tag}>` +
          segment.slice(injectAt) +
          html.slice(segmentEnd);
        cursor = absOpenEnd + injectAt + `</${tag}>`.length;
        html = newHtml;
        continue;
      }

      // Escape any earlier </tag> in the content before the real close.
      const beforeContent = segment.slice(0, lastCloseIdx);
      const escaped = beforeContent.replace(closeRe, `<\\/${tag}>`);
      const realClose = segment.slice(lastCloseIdx, lastCloseIdx + lastCloseLen);
      const afterClose = segment.slice(lastCloseIdx + lastCloseLen);
      const newHtml =
        html.slice(0, absOpenEnd) +
        escaped +
        realClose +
        afterClose +
        html.slice(segmentEnd);
      // Move cursor past the real close — escapes may have grown the prefix
      // so we recompute from the original positions plus the growth.
      const grew = escaped.length - beforeContent.length;
      cursor = absOpenEnd + lastCloseIdx + grew + lastCloseLen;
      html = newHtml;
    }
  }
  return html;
}

/** Best-effort: locate the end of CSS-looking content in a segment. Used
 *  to inject a missing `</style>` before any HTML-looking body content.
 *  Heuristic: find the FIRST HTML tag (e.g. <body>, <nav>, <header>) and
 *  return its position. If none, return segment.length. */
function findCssEnd(segment: string): number {
  // Match an HTML opening tag of a structural element.
  const htmlTagRe = /<(?:html|head|body|nav|header|main|footer|section|article|div|aside|p|h[1-6]|ul|ol|figure|img|video|iframe|button|a)\b/i;
  const m = segment.match(htmlTagRe);
  if (m && m.index !== undefined) return m.index;
  return segment.length;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/\n/g, " ");
}
