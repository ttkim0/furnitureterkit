// Storefront analytics — call from any public page to log a view/event.
//
// Two-step:
//   1. POST /api/track-event → server enriches the event with geo (from IP)
//      and a salted IP hash, then echoes the payload back.
//   2. Client inserts the enriched row into Supabase under the anon key.
//      RLS lets anyone INSERT into analytics_events (the SQL migration
//      whitelists this), so no service-role key is exposed to the browser.
//
// We never block the user on analytics. Failures are silent.

import { enrichEvent } from "./api";
import { getSupabase, isConfigured } from "./supabase";

const SESSION_KEY = "ariadne.analytics-session";

function getOrCreateSessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = "s-" + Math.random().toString(36).slice(2, 14);
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export type AnalyticsEventType =
  | "store_view"
  | "product_view"
  | "add_to_cart"
  | "checkout_started"
  | "purchase_complete";

export async function track(
  storeSlug: string,
  eventType: AnalyticsEventType,
  productId?: string
): Promise<void> {
  if (!isConfigured()) return;
  try {
    const enriched = await enrichEvent({
      store_slug: storeSlug,
      event_type: eventType,
      product_id: productId,
      referrer: document.referrer || undefined,
      session_id: getOrCreateSessionId(),
    });
    if (!enriched) return;
    const sb = getSupabase();
    // Insert under anon key — RLS policy "anyone inserts events" allows this.
    await sb.from("analytics_events").insert(enriched.event);
  } catch {
    // Silently swallow — analytics must never break the user's flow.
  }
}
