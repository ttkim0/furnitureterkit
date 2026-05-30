// Published page — terminal state of the post-CAD flow.
//
// Shows the order confirmation + CTAs for the next phase (set up
// storefront). Phase 1 will activate the "Open store builder" button to
// land on /app/store-builder; for now it's labeled "Coming next" so the
// user understands the milestone.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getCheckoutSession,
  clearCheckoutSession,
} from "../lib/checkoutSession";
import { listCreatorsByUserId } from "../lib/storeDb";
import { setActiveStoreId } from "../lib/activeStore";
import { useAuth } from "../lib/auth";
import { isConfigured as isSupabaseConfigured } from "../lib/supabase";
import type { Creator } from "../lib/marketplace";

export function PublishedPage() {
  const session = getCheckoutSession();
  const auth = useAuth();
  const [existingStores, setExistingStores] = useState<Creator[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | "">("");

  // Detect if this user already has stores — affects the CTAs available.
  useEffect(() => {
    const uid = auth.session?.user?.id;
    if (!uid || !isSupabaseConfigured()) return;
    listCreatorsByUserId(uid)
      .then((cs) => {
        setExistingStores(cs);
        if (cs.length > 0) setSelectedStoreId(cs[0].id);
      })
      .catch(() => {});
  }, [auth.session?.user?.id]);

  if (!session?.orderId) {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>No recent order</h1>
          <p>
            Finalize a piece first; you'll land here once checkout completes.
          </p>
          <Link className="flow-btn flow-btn-primary" to="/app">
            Open editor
          </Link>
        </div>
      </main>
    );
  }

  function handleNewDesign() {
    clearCheckoutSession();
  }

  return (
    <main className="flow-page">
      <div className="flow-stepper">
        <span className="flow-step">Review</span>
        <span className="flow-step-divider" />
        <span className="flow-step">Checkout</span>
        <span className="flow-step-divider" />
        <span className="flow-step flow-step-active">Publish</span>
      </div>

      <div className="flow-success">
        <div className="flow-success-mark">✓</div>
        <h1>You're published</h1>
        <p className="flow-sub">
          <span className="flow-success-title">
            {session.proposedTitle ?? "Your piece"}
          </span>{" "}
          is now live on your Ariadne storefront.
        </p>

        <div className="flow-receipt">
          <div className="flow-receipt-row">
            <span>Order</span>
            <code>{session.orderId}</code>
          </div>
          <div className="flow-receipt-row">
            <span>Listed for</span>
            <span>${session.proposedPriceUsd?.toFixed(2)}</span>
          </div>
          <div className="flow-receipt-row">
            <span>Paid</span>
            <span>
              {session.paidAt
                ? new Date(session.paidAt).toLocaleString()
                : "—"}
            </span>
          </div>
        </div>

        <div className="flow-next">
          <h2>What's next</h2>
          <ol className="flow-next-list">
            <li>
              <strong>Set up your storefront</strong> — pick a theme, generate
              a logo, write your "about". Takes ~5 min.
            </li>
            <li>
              <strong>Add product photos</strong> — upload your own or
              AI-generate room renders.
            </li>
            <li>
              <strong>Share your store link</strong> — buyers browse the
              Ariadne marketplace and find you.
            </li>
            <li>
              <strong>Track sales + visitors</strong> in your dashboard.
            </li>
          </ol>
        </div>

        {existingStores.length > 0 ? (
          <div className="flow-store-choice">
            <h3 className="flow-store-choice-h">Where should this piece go?</h3>
            <div className="flow-store-choice-grid">
              {/* Option A — add to one of the existing stores */}
              <div className="flow-store-choice-card">
                <span className="flow-store-choice-eyebrow">Add to an existing store</span>
                <p>Slot this piece into a brand you've already built.</p>
                {existingStores.length === 1 ? (
                  <p className="flow-store-choice-name">{existingStores[0].store_name}</p>
                ) : (
                  <select
                    className="flow-store-choice-select"
                    value={selectedStoreId}
                    onChange={(e) => setSelectedStoreId(e.target.value)}
                  >
                    {existingStores.map((s) => (
                      <option key={s.id} value={s.id}>{s.store_name} — ariadne.shop/{s.store_slug}</option>
                    ))}
                  </select>
                )}
                <Link
                  className="flow-btn flow-btn-primary flow-store-choice-cta"
                  to="/app/add-product"
                  onClick={() => setActiveStoreId(selectedStoreId)}
                >
                  Add to this store →
                </Link>
              </div>

              {/* Option B — spin up a brand-new store */}
              <div className="flow-store-choice-card flow-store-choice-card-alt">
                <span className="flow-store-choice-eyebrow">— or —</span>
                <p className="flow-store-choice-h2">Start a new brand</p>
                <p>
                  Give this piece its own storefront with separate name, design,
                  and dashboard. Useful when you want to keep brands distinct.
                </p>
                <Link
                  className="flow-btn flow-btn-ghost flow-store-choice-cta"
                  to="/app/store-designer?new=true"
                  onClick={() => setActiveStoreId(null)}
                >
                  Create a new store →
                </Link>
              </div>
            </div>

            <div className="flow-footer flow-footer-cta flow-store-choice-footer">
              <Link className="flow-btn flow-btn-ghost" to="/app" onClick={handleNewDesign}>
                ‹ Design another piece first
              </Link>
            </div>
          </div>
        ) : (
          <div className="flow-footer flow-footer-cta">
            <Link className="flow-btn flow-btn-ghost" to="/app" onClick={handleNewDesign}>
              ‹ Design another piece
            </Link>
            <Link className="flow-btn flow-btn-primary" to="/app/store-designer">
              Design my store →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
