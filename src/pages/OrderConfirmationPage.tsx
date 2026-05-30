// Order confirmation — /shop/:slug/order/:orderNumber
//
// Buyer-facing terminal page after a successful purchase. The order
// number is the only thing in the URL — anyone with it can view; we
// don't expose other buyers' info because the Order rows are read via
// the API passthrough (creator-RLS protected), and this page makes a
// server call to fetch the order without leaking the table.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  formatPrice,
  themeById,
  TYPOGRAPHY_FONTS,
  type Creator,
  type Order,
  type Product,
} from "../lib/marketplace";
import { getOrderByNumber } from "../lib/orderDb";
import { getCreatorBySlug } from "../lib/storeDb";
import { getSupabase } from "../lib/supabase";

export function OrderConfirmationPage() {
  const { slug, orderNumber } = useParams<{ slug: string; orderNumber: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");

  useEffect(() => {
    if (!slug || !orderNumber) return;
    (async () => {
      try {
        const o = await getOrderByNumber(orderNumber);
        if (!o) return setState("notfound");
        const c = await getCreatorBySlug(slug);
        if (!c || c.id !== o.creator_id) return setState("notfound");
        // Product lookup — published rows are publicly readable via RLS.
        const sb = getSupabase();
        const { data: pData } = await sb
          .from("products")
          .select("*")
          .eq("id", o.product_id)
          .maybeSingle();
        if (!pData) return setState("notfound");
        setOrder(o);
        setCreator(c);
        setProduct(pData as Product);
        setState("ready");
      } catch {
        setState("notfound");
      }
    })();
  }, [slug, orderNumber]);

  if (state === "loading") return <main className="store-page store-loading">Loading…</main>;
  if (state !== "ready" || !order || !creator || !product) {
    return (
      <main className="store-page store-notfound">
        <div>
          <h1>Order not found</h1>
          <p>That order number doesn't exist.</p>
          <Link to="/shop">← Back to marketplace</Link>
        </div>
      </main>
    );
  }

  const theme = themeById(creator.theme_id);
  const fonts = TYPOGRAPHY_FONTS[creator.typography];
  const themeStyles = {
    "--store-bg": creator.palette.primary,
    "--store-accent": creator.palette.accent,
    "--store-text": creator.palette.text,
    "--store-muted": creator.palette.muted,
    "--store-display-font": fonts.display,
    "--store-body-font": fonts.body,
  } as React.CSSProperties;
  void theme;

  return (
    <main className="store-page order-confirm-page" style={themeStyles}>
      <div className="order-confirm-card">
        <div className="flow-success-mark">✓</div>
        <h1 className="order-confirm-title">Order confirmed</h1>
        <p className="order-confirm-sub">
          Thanks, {order.buyer_name ?? "friend"}. {creator.store_name} has been
          notified. You'll get an email at <strong>{order.buyer_email}</strong>{" "}
          when it ships.
        </p>

        <div className="flow-receipt order-confirm-receipt">
          <div className="flow-receipt-row"><span>Order number</span><code>{order.order_number}</code></div>
          <div className="flow-receipt-row"><span>Piece</span><span>{product.title}</span></div>
          <div className="flow-receipt-row"><span>Amount</span><span>{formatPrice(order.amount_cents, order.currency)}</span></div>
          <div className="flow-receipt-row"><span>Paid at</span><span>{order.paid_at ? new Date(order.paid_at).toLocaleString() : "—"}</span></div>
          <div className="flow-receipt-row"><span>Status</span><span style={{ color: "var(--store-accent)" }}>{order.status}</span></div>
        </div>

        <p className="order-confirm-note">
          Save the order number above — you'll need it if you contact{" "}
          {creator.store_name} about your order.
        </p>

        <div className="flow-footer flow-footer-cta">
          <Link className="flow-btn flow-btn-ghost" to={`/shop/${creator.store_slug}`}>
            ‹ Continue shopping
          </Link>
          <Link className="flow-btn flow-btn-primary" to="/shop">
            Browse marketplace
          </Link>
        </div>
      </div>
    </main>
  );
}
