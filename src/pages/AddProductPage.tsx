// Add product — /app/add-product
//
// For creators who already have a store: skip the store-builder wizard
// and just promote the just-finalized piece into a new product row.
// Auto-detects the current creator from auth; routes to the new product
// page on success.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isConfigured as isSupabaseConfigured } from "../lib/supabase";
import { slugify } from "../lib/marketplace";
import {
  getCheckoutSession,
  clearCheckoutSession,
} from "../lib/checkoutSession";
import {
  createProduct,
  listCreatorsByUserId,
  getProductsByCreator,
} from "../lib/storeDb";
import { resolveActiveStore } from "../lib/activeStore";
import type { Creator } from "../lib/marketplace";

export function AddProductPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const session = getCheckoutSession();

  const [creator, setCreator] = useState<Creator | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "nostore" | "noauth">("loading");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const userId = auth.session?.user?.id;

  useEffect(() => {
    if (!auth.ready) return;
    if (!userId) return setLoad("noauth");
    (async () => {
      try {
        const stores = await listCreatorsByUserId(userId);
        const c = resolveActiveStore(stores);
        if (!c) return setLoad("nostore");
        setCreator(c);
        setLoad("ready");
      } catch {
        setLoad("nostore");
      }
    })();
  }, [auth.ready, userId]);

  if (!session) {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>Nothing to add</h1>
          <p>Design and finalize a piece first.</p>
          <Link className="flow-btn flow-btn-primary" to="/app">Open editor</Link>
        </div>
      </main>
    );
  }
  if (load === "loading") return <main className="flow-page flow-empty"><p>Loading…</p></main>;
  if (load === "noauth") {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>Sign in</h1>
          <Link className="flow-btn flow-btn-primary" to="/auth">Sign in</Link>
        </div>
      </main>
    );
  }
  if (load === "nostore" || !creator) {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>You don't have a store yet</h1>
          <p>Run the store builder first to set up your storefront.</p>
          <Link className="flow-btn flow-btn-primary" to="/app/store-builder">Open store builder</Link>
        </div>
      </main>
    );
  }

  async function handleAddProduct() {
    if (!isSupabaseConfigured()) {
      setSubmitError("Supabase not configured.");
      return;
    }
    if (!session || !creator) return;
    setSubmitState("submitting");
    setSubmitError(null);
    try {
      // Slug uniqueness within creator's namespace — append number if taken.
      const baseSlug = slugify(
        session.proposedTitle ?? `${session.spec.category}-${session.modelId.slice(-6)}`
      ) || `piece-${session.modelId.slice(-6)}`;
      const existing = await getProductsByCreator(creator.id);
      const takenSlugs = new Set(existing.map((p) => p.slug));
      let productSlug = baseSlug;
      let i = 2;
      while (takenSlugs.has(productSlug)) {
        productSlug = `${baseSlug}-${i++}`;
      }
      const product = await createProduct({
        creator_id: creator.id,
        slug: productSlug,
        title: session.proposedTitle ?? `${session.spec.category} piece`,
        description: session.proposedDescription ?? undefined,
        price_cents: Math.round((session.proposedPriceUsd ?? 0) * 100),
        currency: "USD",
        mesh_url: session.meshUrl,
        cad_zip_url: session.cadZipUrl,
        spec_json: session.spec,
        cad_summary_json: session.cadSummary,
        source_image_url: session.sourceImageUrl,
      });
      clearCheckoutSession();
      navigate(`/shop/${creator.store_slug}/${product.slug}`);
    } catch (e) {
      setSubmitState("error");
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="flow-page">
      <header className="flow-header">
        <h1>Add to your store</h1>
        <p className="flow-sub">
          You already have a store at{" "}
          <Link to={`/shop/${creator.store_slug}`} className="flow-success-title">
            ariadne.shop/{creator.store_slug}
          </Link>
          . Add this piece as a new product.
        </p>
      </header>

      <section className="flow-card">
        <h2>This piece</h2>
        <div className="flow-receipt-row"><span>Title</span><span>{session.proposedTitle}</span></div>
        <div className="flow-receipt-row"><span>Price</span><span>${session.proposedPriceUsd?.toFixed(2)}</span></div>
        <div className="flow-receipt-row"><span>Category</span><span>{session.spec.category}</span></div>
        <div className="flow-receipt-row">
          <span>CAD bundle</span>
          <span>{session.cadSummary.part_count} parts</span>
        </div>
      </section>

      {submitError && <div className="flow-error builder-submit-error">{submitError}</div>}

      <footer className="flow-footer">
        <Link className="flow-btn flow-btn-ghost" to="/app">‹ Cancel</Link>
        <button
          className="flow-btn flow-btn-primary"
          onClick={handleAddProduct}
          disabled={submitState === "submitting"}
        >
          {submitState === "submitting" ? "Publishing…" : `Add to ${creator.store_name} →`}
        </button>
      </footer>
    </main>
  );
}
