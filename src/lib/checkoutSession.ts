// Lightweight passthrough store for the post-CAD flow.
//
// We carry the finished mesh + CAD bundle + spec from SpecPanel → Review →
// Checkout → Published. Router location.state would work for happy-path,
// but a page reload wipes it. SessionStorage gets us refresh-resilience
// without standing up a real DB yet (that's Phase 1).
//
// On "Publish to my storefront" (end of Checkout), this state will be
// promoted into Supabase (Phase 1). Until then it lives only in the
// current browser tab.

import type { FurnitureSpec } from "./spec";
import type { CadBundleSummary } from "./api";

const KEY = "ariadne:checkout-session";

export interface CheckoutSession {
  // Mesh + CAD identifiers
  modelId: string;
  modelPrompt: string;
  meshUrl: string;
  /** White-background source image from Hunyuan pipeline — the visual
   *  reference for AI-generated lifestyle marketing photos. */
  sourceImageUrl?: string;
  cadZipUrl: string;
  cadSummary: CadBundleSummary;
  spec: FurnitureSpec;
  // Listing draft (filled in during Review/Checkout)
  proposedTitle?: string;
  proposedPriceUsd?: number;
  proposedDescription?: string;
  // Filled in by Checkout
  orderId?: string;
  paidAt?: number;
}

export function setCheckoutSession(s: CheckoutSession): void {
  sessionStorage.setItem(KEY, JSON.stringify(s));
}

export function getCheckoutSession(): CheckoutSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CheckoutSession;
  } catch {
    return null;
  }
}

export function updateCheckoutSession(
  patch: Partial<CheckoutSession>
): CheckoutSession | null {
  const cur = getCheckoutSession();
  if (!cur) return null;
  const next = { ...cur, ...patch };
  setCheckoutSession(next);
  return next;
}

export function clearCheckoutSession(): void {
  sessionStorage.removeItem(KEY);
}

// Suggest a sensible default price from spec dimensions × material guess.
// Rough heuristic; user can override. Used only as a starting value.
export function suggestPriceUsd(spec: FurnitureSpec): number {
  const w = spec.overall.width_mm / 1000;
  const d = spec.overall.depth_mm / 1000;
  const h = spec.overall.height_mm / 1000;
  const volume_m3 = Math.max(0.05, w * d * h);
  const base = {
    chair: 480,
    table: 950,
    sofa: 1800,
    bed: 1400,
    lamp: 220,
    storage: 720,
  }[spec.category];
  // Add ~$200/m³ for materials + finish
  const suggested = base + volume_m3 * 200;
  return Math.round(suggested / 10) * 10;
}

// Auto-generate a default title from the model's prompt (first noun phrase).
// User edits in the Review page.
export function suggestTitle(spec: FurnitureSpec, prompt: string): string {
  // Pick the first 3-5 meaningful words from the prompt.
  const words = prompt
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);
  const noun = spec.category[0].toUpperCase() + spec.category.slice(1);
  if (words.length === 0) return `Untitled ${noun}`;
  return words
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ") + ` ${noun}`;
}
