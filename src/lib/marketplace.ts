// Marketplace types + presets shared between builder and storefront.
//
// Source of truth for Supabase row shapes (Phase 1 schema). When schema
// changes, update both here and supabase/migrations/.

import type { FurnitureSpec } from "./spec";
import type { CadBundleSummary } from "./api";

// ── Row types ──────────────────────────────────────────────────────────
export interface Creator {
  id: string;
  user_id: string;
  store_slug: string;
  store_name: string;
  tagline: string | null;
  about: string | null;
  logo_url: string | null;
  hero_image_url: string | null;
  theme_id: ThemeId;
  palette: Palette;
  typography: TypographyId;
  status: "draft" | "published" | "suspended";
  created_at: string;
  updated_at: string;
  // Phase 1.5 — Lovable-style custom design
  design_brief: string | null;
  reference_urls: string[];
  inspiration_image_urls: string[];
  custom_homepage_html: string | null;
  custom_homepage_css: string | null;
  design_iteration_count: number;
  last_designed_at: string | null;
  // Phase 1.6 — Onlook-style per-element visual edits
  custom_overrides: {
    text?: Record<string, string>;
    style?: Record<string, Record<string, string>>;
  };
}

export interface Product {
  id: string;
  creator_id: string;
  slug: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  mesh_url: string;
  cad_zip_url: string;
  spec_json: FurnitureSpec;
  cad_summary_json: CadBundleSummary | null;
  hero_image_url: string | null;
  gallery_urls: string[];
  /** Source image from the Hunyuan pipeline (gpt-image-1 generated white-
   *  background photo). Used as the visual reference for auto-generating
   *  high-quality lifestyle marketing photos. */
  source_image_url: string | null;
  /** Per-product cinematic video (Fal Seedance image-to-video). ~5s MP4
   *  used as the scroll-scrubbed hero on storefront + product page. */
  hero_video_url: string | null;
  status: "draft" | "published" | "sold_out" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  product_id: string;
  creator_id: string;
  buyer_email: string;
  buyer_name: string | null;
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "shipped" | "delivered" | "refunded" | "cancelled";
  payment_method: string;
  paid_at: string | null;
  shipping_address: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}

export interface AnalyticsEvent {
  id: number;
  store_slug: string;
  product_id: string | null;
  event_type:
    | "store_view"
    | "product_view"
    | "add_to_cart"
    | "checkout_started"
    | "purchase_complete";
  country: string | null;
  country_name: string | null;
  city: string | null;
  region: string | null;
  referrer: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  session_id: string | null;
  created_at: string;
}

// ── Theme system ───────────────────────────────────────────────────────
//
// Each theme bundles: layout (hero shape, product grid density) + default
// palette + default typography. Creators can override palette / typography
// per-store while keeping the theme's layout shape.

export type ThemeId =
  | "minimal-dark"
  | "warm-paper"
  | "studio-white"
  | "noir-serif"
  | "bauhaus-grid";

export type TypographyId =
  | "serif-italic"
  | "modern-sans"
  | "editorial"
  | "monospace-modernist";

export interface Palette {
  primary: string; // page background
  accent: string; // calls-to-action, accents
  text: string; // primary text
  muted: string; // secondary text
}

export interface ThemePreset {
  id: ThemeId;
  name: string;
  description: string;
  palette: Palette;
  typography: TypographyId;
  /** Visual style tags that drive layout decisions in StorefrontRenderer. */
  layout: {
    hero: "full-bleed" | "split" | "centered";
    productGrid: "spacious" | "dense" | "masonry";
    nav: "minimal" | "sidebar";
  };
}

// Light-first ordering — most furniture brands look better in warm light
// palettes. Dark themes are at the bottom for when the brief explicitly
// calls for them.
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "warm-paper",
    name: "Warm Paper",
    description: "Off-white with terracotta. Looks like a print catalog or atelier brochure.",
    palette: { primary: "#f6f1e8", accent: "#c95b4b", text: "#1a1814", muted: "#6e6557" },
    typography: "editorial",
    layout: { hero: "split", productGrid: "spacious", nav: "minimal" },
  },
  {
    id: "studio-white",
    name: "Studio White",
    description: "Pure off-white, modernist sans, lots of negative space. Design-studio vibe.",
    palette: { primary: "#ffffff", accent: "#1a1a1a", text: "#1a1a1a", muted: "#888888" },
    typography: "modern-sans",
    layout: { hero: "centered", productGrid: "dense", nav: "sidebar" },
  },
  {
    id: "bauhaus-grid",
    name: "Bauhaus Grid",
    description: "Primary colors, strict grid, monospace labels. Industrial design feel.",
    palette: { primary: "#fafafa", accent: "#e63946", text: "#1d1d1d", muted: "#666666" },
    typography: "monospace-modernist",
    layout: { hero: "split", productGrid: "dense", nav: "minimal" },
  },
  {
    id: "noir-serif",
    name: "Noir Serif",
    description: "Heavy black, gold accents, big editorial serif. Luxury furniture mood.",
    palette: { primary: "#0a0908", accent: "#d4a574", text: "#f5e8d0", muted: "#7a6e5d" },
    typography: "editorial",
    layout: { hero: "full-bleed", productGrid: "spacious", nav: "minimal" },
  },
  {
    id: "minimal-dark",
    name: "Minimal Dark",
    description: "Quiet, gallery-like. Cream serif on near-black. For atmospheric brands only.",
    palette: { primary: "#06070d", accent: "#ffc88c", text: "#fff7e6", muted: "#a89b85" },
    typography: "serif-italic",
    layout: { hero: "full-bleed", productGrid: "spacious", nav: "minimal" },
  },
];

export const TYPOGRAPHY_FONTS: Record<
  TypographyId,
  { display: string; body: string; sample: string }
> = {
  "serif-italic": {
    display: '"EB Garamond", Georgia, serif',
    body: '"Inter", -apple-system, sans-serif',
    sample: "Quiet, intimate, gallery feel",
  },
  "modern-sans": {
    display: '"Inter", -apple-system, sans-serif',
    body: '"Inter", -apple-system, sans-serif',
    sample: "Clean, technical, modern",
  },
  editorial: {
    display: '"Playfair Display", Georgia, serif',
    body: '"Source Sans 3", -apple-system, sans-serif',
    sample: "Magazine-style, expressive",
  },
  "monospace-modernist": {
    display: '"JetBrains Mono", "SF Mono", monospace',
    body: '"Inter", -apple-system, sans-serif',
    sample: "Industrial, schematic, deliberate",
  },
};

export function themeById(id: ThemeId): ThemePreset {
  return THEME_PRESETS.find((t) => t.id === id) ?? THEME_PRESETS[0];
}

// ── Helpers ─────────────────────────────────────────────────────────────
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function formatPrice(priceCents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);
}
