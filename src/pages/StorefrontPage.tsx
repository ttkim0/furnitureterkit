// Public storefront — anyone can browse, no auth required.
//
// URL: /shop/:slug
// Renders the creator's chosen theme (palette + typography + layout) and
// shows their published products. Fires a `store_view` analytics event
// once per session.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getCreatorBySlug, getProductsByCreator, updateCreator } from "../lib/storeDb";
import {
  formatPrice,
  themeById,
  TYPOGRAPHY_FONTS,
  type Creator,
  type Product,
} from "../lib/marketplace";
import { track } from "../lib/analytics";
import { useAuth } from "../lib/auth";
import { InlineEditable } from "../components/InlineEditable";
import {
  renderProductGridHtml,
  renderStorefrontHtml,
  sanitizeStyleBlocks,
} from "../lib/storefrontRender";
import { StyleEditorPanel } from "../components/StyleEditorPanel";
import { VisualEditor } from "../components/VisualEditor";
import { useRef } from "react";

export function StorefrontPage() {
  const { slug } = useParams<{ slug: string }>();
  const auth = useAuth();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound">("loading");

  // Owner check: is the current logged-in user the creator of this store?
  const isOwner = !!(creator && auth.session?.user?.id === creator.user_id);

  async function saveCreatorField<K extends keyof Creator>(field: K, val: Creator[K]) {
    if (!creator) return;
    const updated = await updateCreator(creator.id, { [field]: val } as Partial<Creator>);
    setCreator(updated);
  }

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const c = await getCreatorBySlug(slug);
        if (!c) {
          setLoadState("notfound");
          return;
        }
        setCreator(c);
        const ps = await getProductsByCreator(c.id);
        setProducts(ps.filter((p) => p.status === "published"));
        setLoadState("ready");
        // Fire a store-view event (no product_id at this stage)
        track(slug, "store_view");
      } catch (e) {
        console.error("storefront load failed:", e);
        setLoadState("notfound");
      }
    })();
  }, [slug]);

  const themeStyles = useMemo(() => {
    if (!creator) return {};
    const theme = themeById(creator.theme_id);
    const fonts = TYPOGRAPHY_FONTS[creator.typography];
    return {
      "--store-bg": creator.palette.primary,
      "--store-accent": creator.palette.accent,
      "--store-text": creator.palette.text,
      "--store-muted": creator.palette.muted,
      "--store-display-font": fonts.display,
      "--store-body-font": fonts.body,
      "--store-grid-density":
        theme.layout.productGrid === "dense"
          ? "minmax(220px, 1fr)"
          : "minmax(280px, 1fr)",
    } as React.CSSProperties;
  }, [creator]);

  if (loadState === "loading") {
    return <main className="store-page store-loading">Loading store…</main>;
  }
  if (loadState === "notfound" || !creator) {
    return (
      <main className="store-page store-notfound">
        <div>
          <h1>Store not found</h1>
          <p>No storefront at <code>/shop/{slug}</code>.</p>
          <Link to="/shop">← Browse the marketplace</Link>
        </div>
      </main>
    );
  }

  // If the creator has a custom Lovable-generated homepage, render that
  // inside a sandboxed iframe. The platform owner-tools (edit link, etc.)
  // overlay on top.
  if (creator.custom_homepage_html) {
    return (
      <CustomStorefrontView
        creator={creator}
        products={products}
        isOwner={isOwner}
      />
    );
  }

  const theme = themeById(creator.theme_id);

  return (
    <main className="store-page" style={themeStyles}>
      <header className={`store-header store-header-${theme.layout.hero}`}>
        <div className="store-topbar">
          <Link to="/shop" className="store-back-link">
            ← Marketplace
          </Link>
          {isOwner && (
            <Link to="/app/store-settings" className="store-owner-link">
              Edit store ⚙
            </Link>
          )}
        </div>
        {creator.logo_url && (
          <img className="store-logo" src={creator.logo_url} alt={creator.store_name} />
        )}
        <InlineEditable
          as="h1"
          className="store-name"
          value={creator.store_name}
          editable={isOwner}
          maxLength={60}
          onSave={(v) => saveCreatorField("store_name", v)}
        />
        <InlineEditable
          as="p"
          className="store-tagline"
          value={creator.tagline ?? ""}
          editable={isOwner}
          placeholder={isOwner ? "Add a tagline…" : ""}
          maxLength={120}
          onSave={(v) => saveCreatorField("tagline", v || null)}
        />
      </header>

      {(creator.about || isOwner) && (
        <section className="store-about">
          <InlineEditable
            as="p"
            value={creator.about ?? ""}
            editable={isOwner}
            multiline
            placeholder={isOwner ? "Tell visitors about your work…" : ""}
            maxLength={600}
            onSave={(v) => saveCreatorField("about", v || null)}
          />
        </section>
      )}

      <section className="store-products">
        <h2 className="store-products-title">
          {products.length === 0 ? "Coming soon" : `${products.length} piece${products.length === 1 ? "" : "s"}`}
        </h2>

        {products.length === 0 ? (
          <p className="store-empty">
            New pieces will appear here when {creator.store_name} publishes them.
          </p>
        ) : (
          <div className="store-product-grid">
            {products.map((p) => (
              <Link
                key={p.id}
                to={`/shop/${creator.store_slug}/${p.slug}`}
                className="store-product-card"
              >
                <div className="store-product-image">
                  {p.hero_image_url ? (
                    <img src={p.hero_image_url} alt={p.title} />
                  ) : (
                    <ProductMeshThumb meshUrl={p.mesh_url} />
                  )}
                </div>
                <div className="store-product-meta">
                  <h3>{p.title}</h3>
                  <span className="store-product-price">
                    {formatPrice(p.price_cents, p.currency)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <footer className="store-footer">
        <span>
          A storefront on{" "}
          <Link to="/shop" className="store-footer-link">
            Ariadne
          </Link>
          .
        </span>
      </footer>
    </main>
  );
}

/** Thumbnail placeholder — Phase 2 will lazy-render a small R3F preview
 *  or use a pre-rendered PNG snapshot saved at upload time. For now we
 *  show a soft gradient so the grid isn't empty when there's no hero. */
function ProductMeshThumb({ meshUrl: _ }: { meshUrl: string }) {
  return <div className="store-product-thumb-placeholder" />;
}

/** Render the Claude-generated custom homepage in a sandboxed iframe.
 *  Owner gets the StyleEditorPanel + an "Edit design" overlay link. */
function CustomStorefrontView({
  creator: initialCreator,
  products,
  isOwner,
}: {
  creator: Creator;
  products: Product[];
  isOwner: boolean;
}) {
  const [creator, setCreator] = useState<Creator>(initialCreator);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Track iframe load state so we can fade content in. Default false to
  // catch the brief blank-page flash on navigation back from product page.
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Sync creator state when the prop changes (navigation between stores).
  useEffect(() => {
    setCreator(initialCreator);
    setIframeLoaded(false);
  }, [initialCreator.id]);

  // RESCUE: if the stored custom_homepage_html had CSS-bleed bugs from a
  // previous broken generation, the sanitizer fixes them on render. If the
  // sanitization actually changed something AND the viewer is the owner,
  // silently save the cleaned HTML back to the DB so it's clean next time.
  useEffect(() => {
    if (!isOwner || !creator.custom_homepage_html) return;
    const cleaned = sanitizeStyleBlocks(creator.custom_homepage_html);
    if (cleaned === creator.custom_homepage_html) return;
    console.log(
      `[ariadne] storefront: detected CSS-bleed in saved HTML, auto-resaving cleaned version (${creator.custom_homepage_html.length} → ${cleaned.length} chars)`
    );
    updateCreator(creator.id, { custom_homepage_html: cleaned })
      .then((updated) => setCreator(updated))
      .catch((e) => console.warn("auto-resave failed:", e));
  }, [isOwner, creator.id, creator.custom_homepage_html]);

  // Live overrides set from the StyleEditorPanel — applied to the
  // iframe immediately, persisted to DB only when user clicks Save.
  const [liveOverrides, setLiveOverrides] = useState<{
    palette: typeof creator.palette;
    fontPair: { id: string; name: string; display: string; body: string; googleFamilies: string[]; sample: string };
  } | null>(null);

  const html = useMemo(() => {
    if (!creator.custom_homepage_html) return "";
    return renderStorefrontHtml(creator.custom_homepage_html, {
      store_name: creator.store_name,
      tagline: creator.tagline ?? "",
      about: creator.about ?? "",
      logo_url: creator.logo_url ?? "",
      products: renderProductGridHtml(products, creator.store_slug),
      paletteOverride: liveOverrides?.palette ?? creator.palette,
      typographyOverride: liveOverrides
        ? {
            display: liveOverrides.fontPair.display,
            body: liveOverrides.fontPair.body,
            googleFontFamilies: liveOverrides.fontPair.googleFamilies,
          }
        : undefined,
      visualOverrides: creator.custom_overrides ?? {},
      includeVisualEditor: isOwner, // visitors don't get the editor hooks
    });
  }, [creator, products, liveOverrides, isOwner]);

  return (
    <div
      className="custom-storefront-wrap"
      // Use the creator's palette as the wrap background so navigating
      // back doesn't flash pure black before the iframe paints.
      style={{ background: creator.palette?.primary ?? "#06070d" }}
    >
      {/* Owner overlay bar */}
      {isOwner && (
        <div className="custom-storefront-ownerbar">
          <Link to="/shop">← Marketplace</Link>
          <div className="custom-storefront-ownerbar-actions">
            <Link to="/app/store-designer">Redesign</Link>
            <Link to="/app/dashboard">Dashboard</Link>
          </div>
        </div>
      )}
      {!iframeLoaded && (
        <div
          className="custom-storefront-loading"
          style={{ color: creator.palette?.text ?? "#fff7e6" }}
        >
          <span>Loading {creator.store_name}…</span>
        </div>
      )}
      <iframe
        // Key by creator id so React fully remounts the iframe when the
        // creator changes (e.g., switching stores), forcing a clean reload
        // instead of trying to update a stale srcDoc in place.
        key={creator.id}
        ref={iframeRef}
        srcDoc={html}
        onLoad={() => setIframeLoaded(true)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
        title={`${creator.store_name} storefront`}
        className="custom-storefront-frame"
        style={{ opacity: iframeLoaded ? 1 : 0, transition: "opacity 0.18s" }}
      />
      {isOwner && (
        <>
          <StyleEditorPanel
            creator={creator}
            onLiveChange={setLiveOverrides}
            onSaved={(updated) => {
              setCreator(updated);
              setLiveOverrides(null); // committed — fall back to saved values
            }}
          />
          <VisualEditor
            creator={creator}
            iframeRef={iframeRef}
            onSaved={setCreator}
          />
        </>
      )}
    </div>
  );
}
