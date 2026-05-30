// Scrape reference URLs the creator pasted into the designer, extract
// design DNA, and return a structured summary Claude can use as a
// real reference instead of relying on its training-data memory of
// the site (which may be outdated or absent).
//
// We extract:
//   - Page title + meta description
//   - All Google Fonts loaded (font families used)
//   - All :root CSS custom properties (palette + spacing tokens)
//   - Dominant inline-style colors (sampled from the first ~200 elements)
//   - First ~600 chars of visible body text (for tone/voice)
//
// Not a perfect render-fidelity capture — but for "what does this brand
// FEEL like, what fonts/colors/voice does it use" purposes it's much
// better than nothing.

const FETCH_TIMEOUT_MS = 6000;

/**
 * Scrape one URL and return a compact design-DNA summary.
 *
 * @param {string} url
 * @returns {Promise<{ url: string, title: string|null, description: string|null,
 *                     fonts: string[], cssVars: Record<string, string>,
 *                     palette: string[], tone: string|null, error?: string }>}
 */
export async function scrapeReference(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return { url, title: null, description: null, fonts: [], cssVars: {}, palette: [], tone: null, error: "invalid url" };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(normalized, {
      signal: ctrl.signal,
      headers: {
        // Some sites block bot UAs. Plain UA + accept-html.
        "User-Agent": "Mozilla/5.0 (Ariadne Design Reference Scraper)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) {
      return base(normalized, `HTTP ${res.status}`);
    }
    const html = await res.text();
    return extractDna(normalized, html);
  } catch (e) {
    return base(normalized, e?.name === "AbortError" ? "timeout" : (e?.message ?? "fetch failed"));
  }
}

/** Scrape many URLs in parallel (capped concurrency 3 to be polite). */
export async function scrapeReferences(urls) {
  const seen = new Set();
  const unique = urls.filter((u) => {
    if (!u) return false;
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  }).slice(0, 8);
  return await Promise.all(unique.map(scrapeReference));
}

function base(url, error) {
  return { url, title: null, description: null, fonts: [], cssVars: {}, palette: [], tone: null, error };
}

function normalizeUrl(u) {
  if (!u || typeof u !== "string") return null;
  let s = u.trim();
  if (!/^https?:\/\//i.test(s)) {
    if (/^www\./i.test(s) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(s)) {
      s = "https://" + s;
    } else {
      return null;
    }
  }
  try {
    const url = new URL(s);
    return url.toString();
  } catch {
    return null;
  }
}

function extractDna(url, html) {
  return {
    url,
    title: extractTitle(html),
    description: extractMetaDescription(html),
    fonts: extractGoogleFonts(html),
    cssVars: extractRootCssVars(html),
    palette: extractColors(html),
    tone: extractToneSample(html),
  };
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1].trim().slice(0, 200)) : null;
}

function extractMetaDescription(html) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return decode(m[1].slice(0, 400));
  }
  return null;
}

function extractGoogleFonts(html) {
  const families = new Set();
  // Match links to fonts.googleapis.com/css(2)?family=...
  const re = /fonts\.googleapis\.com\/css[^"']*[?&]family=([^"'&]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const param = decodeURIComponent(m[1]);
    // family=Inter:wght@400;500&family=Fraunces:ital,wght@0,400;1,500
    for (const fam of param.split("&family=").join("|").split("|")) {
      const name = fam.split(":")[0]?.replace(/\+/g, " ").trim();
      if (name && name.length < 60) families.add(name);
    }
  }
  // Also check inline font-family declarations
  const ffRe = /font-family\s*:\s*["']?([^"';,{}]+)["']?/gi;
  let count = 0;
  while ((m = ffRe.exec(html)) !== null && count < 50) {
    const name = m[1].trim();
    // Skip generic stacks
    if (/^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|cursive|fantasy)$/i.test(name)) continue;
    if (name.length < 40 && !name.includes("var(")) families.add(name);
    count++;
  }
  return Array.from(families).slice(0, 8);
}

function extractRootCssVars(html) {
  const vars = {};
  // Match :root { --foo: value; ... }
  const rootMatch = html.match(/:root\s*\{([^}]*)\}/i);
  if (!rootMatch) return vars;
  const body = rootMatch[1];
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+?);/gi;
  let m;
  let count = 0;
  while ((m = re.exec(body)) !== null && count < 30) {
    vars[m[1]] = m[2].trim().slice(0, 80);
    count++;
  }
  return vars;
}

function extractColors(html) {
  const colors = new Map(); // color → count
  // Match #rrggbb, #rgb, rgb(), rgba(), oklch(), hsl() in any inline style
  const re = /(#[0-9a-f]{6}|#[0-9a-f]{3}|rgba?\([^)]+\)|oklch\([^)]+\)|hsla?\([^)]+\))/gi;
  let m;
  let count = 0;
  while ((m = re.exec(html)) !== null && count < 400) {
    const c = m[1].toLowerCase().replace(/\s+/g, "");
    // Skip pure black / white / transparent which add noise
    if (/^#(000|fff)([0-9a-f]{3})?$/.test(c)) { count++; continue; }
    if (/^rgba?\(0,0,0,/.test(c) || /^rgba?\(255,255,255,/.test(c)) { count++; continue; }
    colors.set(c, (colors.get(c) ?? 0) + 1);
    count++;
  }
  return Array.from(colors.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([c]) => c);
}

function extractToneSample(html) {
  // Strip tags, collapse whitespace, take the first ~600 chars of visible text.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sample = stripped.slice(0, 600);
  return sample.length > 80 ? decode(sample) : null;
}

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
