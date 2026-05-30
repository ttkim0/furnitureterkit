// Etsy-style marketplace browse — /shop
//
// Multi-section discovery page that buyers land on. Sections are populated
// from real Supabase data — no fake "trending" or "best-seller" badges
// unless we have the data to back them.
//
// Layout (top to bottom):
//   1. Utility strip ("Save designs · CAD included with every purchase")
//   2. Header + big rounded search bar
//   3. Category pill nav
//   4. Hero featured piece (rotates among published pieces)
//   5. New this week (horizontal scroll)
//   6. From our makers (creator spotlight cards)
//   7. Browse by category (6 tiles)
//   8. Under $500 (curated by price)
//   9. Why Ariadne (trust strip — three columns)
//  10. Full grid + filter

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listMarketplace,
  listFeaturedCreators,
  type MarketplaceListing,
} from "../lib/storeDb";
import { formatPrice, type Creator } from "../lib/marketplace";

type CategoryFilter = "all" | "chair" | "table" | "sofa" | "bed" | "lamp" | "storage";

const CATEGORY_NAV: { id: CategoryFilter; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "◇" },
  { id: "chair", label: "Chairs", icon: "❶" },
  { id: "table", label: "Tables", icon: "❷" },
  { id: "sofa", label: "Sofas", icon: "❸" },
  { id: "bed", label: "Beds", icon: "❹" },
  { id: "lamp", label: "Lamps", icon: "❺" },
  { id: "storage", label: "Storage", icon: "❻" },
];

export function MarketplacePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [heroIdx, setHeroIdx] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [rows, cs] = await Promise.all([
          listMarketplace(120),
          listFeaturedCreators(6),
        ]);
        setListings(rows);
        setCreators(cs);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, []);

  // ── Section feeds (derived) ──────────────────────────────────────────
  const newThisWeek = useMemo(() => {
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return listings
      .filter((l) => now - new Date(l.product.created_at).getTime() < oneWeek)
      .slice(0, 12);
  }, [listings]);

  const allTimeRecent = useMemo(() => listings.slice(0, 12), [listings]);

  const heroPicks = useMemo(() => {
    // Pieces that have a hero image (look good as a hero)
    return listings.filter((l) => !!l.product.hero_image_url).slice(0, 5);
  }, [listings]);

  const heroPick = heroPicks[heroIdx % Math.max(1, heroPicks.length)];

  const under500 = useMemo(
    () => listings.filter((l) => l.product.price_cents <= 50000).slice(0, 12),
    [listings]
  );

  const byCategory = useMemo(() => {
    const groups = new Map<string, MarketplaceListing[]>();
    for (const l of listings) {
      const cat = l.product.spec_json?.category;
      if (!cat) continue;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(l);
    }
    return groups;
  }, [listings]);

  // ── Filter + search for the full grid ────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (activeCategory !== "all" && l.product.spec_json?.category !== activeCategory) {
        return false;
      }
      if (q) {
        const blob = `${l.product.title} ${l.product.description ?? ""} ${l.creator.store_name} ${l.product.spec_json?.primary_material ?? ""}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [listings, query, activeCategory]);

  return (
    <main className="mkt-page">
      {/* ── Top utility strip ──────────────────────────────────────── */}
      <div className="mkt-utility">
        <span>★ Save designs you love</span>
        <span>·</span>
        <span>STEP + DXF files included with every purchase</span>
        <span>·</span>
        <span>Order from the maker, or build it yourself</span>
      </div>

      {/* ── Header + search ─────────────────────────────────────────── */}
      <header className="mkt-header">
        <Link to="/" className="mkt-brand">
          <span className="mkt-brand-mark">A</span>
          <span className="mkt-brand-name">Ariadne</span>
          <span className="mkt-brand-tag">Marketplace</span>
        </Link>

        <form
          className="mkt-search"
          onSubmit={(e) => e.preventDefault()}
          role="search"
        >
          <span className="mkt-search-icon">⌕</span>
          <input
            type="search"
            placeholder="Search for chairs, oak tables, your favorite makers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mkt-search-input"
          />
          <button type="submit" className="mkt-search-btn" aria-label="Search">
            Search
          </button>
        </form>

        <nav className="mkt-header-nav">
          <Link to="/app" className="mkt-header-nav-link">Sell on Ariadne</Link>
          <Link to="/auth" className="mkt-header-nav-link">Sign in</Link>
          <button className="mkt-cart-btn" title="Saved (coming soon)">♡</button>
        </nav>
      </header>

      {/* ── Category pill nav ───────────────────────────────────────── */}
      <nav className="mkt-cat-nav">
        {CATEGORY_NAV.map((c) => (
          <button
            key={c.id}
            className={`mkt-cat-pill ${activeCategory === c.id ? "is-active" : ""}`}
            onClick={() => setActiveCategory(c.id)}
          >
            <span className="mkt-cat-pill-icon">{c.icon}</span>
            {c.label}
          </button>
        ))}
      </nav>

      {/* ── Loading / error ─────────────────────────────────────────── */}
      {state === "loading" && (
        <div className="mkt-loading">Loading the marketplace…</div>
      )}
      {state === "error" && (
        <div className="mkt-loading">Couldn't load. <Link to="/">Back to home</Link></div>
      )}

      {state === "ready" && listings.length === 0 && (
        <div className="mkt-empty">
          <h2>The marketplace is just opening</h2>
          <p>Be one of the first makers. <Link to="/app">Open the editor</Link> and design something to list.</p>
        </div>
      )}

      {state === "ready" && listings.length > 0 && (
        <>
          {/* ── Hero featured piece ────────────────────────────────── */}
          {heroPick && (
            <section className="mkt-hero">
              <div className="mkt-hero-image">
                {heroPick.product.hero_image_url ? (
                  <img src={heroPick.product.hero_image_url} alt={heroPick.product.title} />
                ) : (
                  <div className="mkt-hero-placeholder" />
                )}
              </div>
              <div className="mkt-hero-meta">
                <span className="mkt-hero-eyebrow">The Maker Edit · Featured this week</span>
                <h1 className="mkt-hero-title">{heroPick.product.title}</h1>
                <p className="mkt-hero-creator">
                  by{" "}
                  <Link to={`/shop/${heroPick.creator.store_slug}`}>
                    {heroPick.creator.store_name}
                  </Link>
                </p>
                <p className="mkt-hero-price">
                  {formatPrice(heroPick.product.price_cents, heroPick.product.currency)}
                </p>
                {heroPick.product.description && (
                  <p className="mkt-hero-desc">
                    {heroPick.product.description.slice(0, 200)}
                    {heroPick.product.description.length > 200 ? "…" : ""}
                  </p>
                )}
                <div className="mkt-hero-actions">
                  <Link
                    to={`/shop/${heroPick.creator.store_slug}/${heroPick.product.slug}`}
                    className="mkt-btn mkt-btn-primary"
                  >
                    View this piece
                  </Link>
                  <Link
                    to={`/shop/${heroPick.creator.store_slug}`}
                    className="mkt-btn mkt-btn-ghost"
                  >
                    More from {heroPick.creator.store_name}
                  </Link>
                </div>
                {heroPicks.length > 1 && (
                  <div className="mkt-hero-pager">
                    {heroPicks.map((_, i) => (
                      <button
                        key={i}
                        className={`mkt-hero-dot ${i === heroIdx % heroPicks.length ? "is-active" : ""}`}
                        onClick={() => setHeroIdx(i)}
                        aria-label={`Show featured piece ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── New this week ──────────────────────────────────────── */}
          {newThisWeek.length > 0 && (
            <ProductRow
              eyebrow="Just landed"
              title="New this week"
              listings={newThisWeek}
            />
          )}

          {/* ── From our makers ────────────────────────────────────── */}
          {creators.length > 0 && (
            <section className="mkt-section mkt-makers-section">
              <header className="mkt-section-header">
                <div>
                  <span className="mkt-section-eyebrow">Spotlight</span>
                  <h2>From our makers</h2>
                </div>
                <Link to="#all-pieces" className="mkt-section-link">Browse all stores ↗</Link>
              </header>
              <div className="mkt-makers-grid">
                {creators.slice(0, 6).map((c) => {
                  const theirPieces = listings.filter((l) => l.creator.id === c.id).slice(0, 3);
                  return (
                    <Link key={c.id} to={`/shop/${c.store_slug}`} className="mkt-maker-card">
                      <div className="mkt-maker-header">
                        {c.logo_url ? (
                          <img className="mkt-maker-logo" src={c.logo_url} alt={c.store_name} />
                        ) : (
                          <span className="mkt-maker-mark">{c.store_name.charAt(0)}</span>
                        )}
                        <div>
                          <h3 className="mkt-maker-name">{c.store_name}</h3>
                          {c.tagline && (
                            <p className="mkt-maker-tagline">{c.tagline}</p>
                          )}
                        </div>
                      </div>
                      {theirPieces.length > 0 && (
                        <div className="mkt-maker-pieces">
                          {theirPieces.map((p) => (
                            <div key={p.product.id} className="mkt-maker-piece">
                              {p.product.hero_image_url ? (
                                <img src={p.product.hero_image_url} alt={p.product.title} />
                              ) : (
                                <div className="mkt-maker-piece-placeholder" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <span className="mkt-maker-cta">
                        Visit store →
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Browse by category tiles ───────────────────────────── */}
          <section className="mkt-section">
            <header className="mkt-section-header">
              <div>
                <span className="mkt-section-eyebrow">Discover</span>
                <h2>Browse by category</h2>
              </div>
            </header>
            <div className="mkt-cat-tiles">
              {CATEGORY_NAV.slice(1).map((cat) => {
                const sample = byCategory.get(cat.id)?.[0];
                const count = byCategory.get(cat.id)?.length ?? 0;
                return (
                  <button
                    key={cat.id}
                    className="mkt-cat-tile"
                    onClick={() => {
                      setActiveCategory(cat.id);
                      document.getElementById("all-pieces")?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    <div className="mkt-cat-tile-image">
                      {sample?.product.hero_image_url ? (
                        <img src={sample.product.hero_image_url} alt={cat.label} />
                      ) : (
                        <div className="mkt-cat-tile-placeholder">{cat.icon}</div>
                      )}
                    </div>
                    <h3>{cat.label}</h3>
                    <span className="mkt-cat-tile-count">
                      {count === 0 ? "Coming soon" : `${count} ${count === 1 ? "piece" : "pieces"}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Under $500 ──────────────────────────────────────────── */}
          {under500.length > 0 && (
            <ProductRow
              eyebrow="Within reach"
              title="Pieces under $500"
              listings={under500}
            />
          )}

          {/* ── Why Ariadne ─────────────────────────────────────────── */}
          <section className="mkt-why">
            <h2>Why buy on Ariadne</h2>
            <div className="mkt-why-grid">
              <article>
                <span className="mkt-why-icon">⌂</span>
                <h3>Made by real makers</h3>
                <p>
                  Every piece is designed by an independent maker, not a brand. You're
                  buying directly from them.
                </p>
              </article>
              <article>
                <span className="mkt-why-icon">▣</span>
                <h3>CAD with every order</h3>
                <p>
                  STEP files, DXF panels, cutlist, BOM — the full manufacturing bundle.
                  Order finished, or build it yourself.
                </p>
              </article>
              <article>
                <span className="mkt-why-icon">⟁</span>
                <h3>Buy from the source</h3>
                <p>
                  No middlemen. Your purchase goes to the maker, plus a small platform fee.
                  We don't mark up.
                </p>
              </article>
            </div>
          </section>

          {/* ── Recent rolls if no new-this-week ───────────────────── */}
          {newThisWeek.length === 0 && allTimeRecent.length > 0 && (
            <ProductRow
              eyebrow="Recently listed"
              title="From the makers"
              listings={allTimeRecent}
            />
          )}

          {/* ── Full filtered grid ──────────────────────────────────── */}
          <section className="mkt-section mkt-all" id="all-pieces">
            <header className="mkt-section-header">
              <div>
                <span className="mkt-section-eyebrow">Everything</span>
                <h2>
                  {activeCategory === "all"
                    ? "All pieces"
                    : `${CATEGORY_NAV.find((c) => c.id === activeCategory)?.label}`}
                  <span className="mkt-all-count">· {filtered.length}</span>
                </h2>
              </div>
              {activeCategory !== "all" && (
                <button onClick={() => setActiveCategory("all")} className="mkt-section-link">
                  Clear filter ×
                </button>
              )}
            </header>
            {filtered.length === 0 ? (
              <p className="mkt-empty-row">
                No pieces match this filter. Try another category.
              </p>
            ) : (
              <div className="mkt-grid">
                {filtered.map((l) => (
                  <ProductCard key={l.product.id} listing={l} />
                ))}
              </div>
            )}
          </section>

          {/* ── Footer ──────────────────────────────────────────────── */}
          <footer className="mkt-footer">
            <div>
              <strong>Ariadne</strong>
              <p>A marketplace where furniture makers design, sell, and ship.</p>
            </div>
            <div>
              <span>Buyers</span>
              <Link to="/shop">Browse</Link>
              <Link to="/shop">Search</Link>
            </div>
            <div>
              <span>Makers</span>
              <Link to="/app">Open the editor</Link>
              <Link to="/app/dashboard">Dashboard</Link>
            </div>
            <div className="mkt-footer-bottom">
              © {new Date().getFullYear()} · Made on Ariadne
            </div>
          </footer>
        </>
      )}
    </main>
  );
}

/* ─────────────── ProductRow (horizontal scrollable) ─────────────── */
function ProductRow({
  eyebrow,
  title,
  listings,
}: {
  eyebrow: string;
  title: string;
  listings: MarketplaceListing[];
}) {
  return (
    <section className="mkt-section">
      <header className="mkt-section-header">
        <div>
          <span className="mkt-section-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </header>
      <div className="mkt-row">
        {listings.map((l) => (
          <ProductCard key={l.product.id} listing={l} compact />
        ))}
      </div>
    </section>
  );
}

/* ─────────────── ProductCard ─────────────── */
function ProductCard({
  listing,
  compact = false,
}: {
  listing: MarketplaceListing;
  compact?: boolean;
}) {
  const { product, creator } = listing;
  const recentlyAdded =
    Date.now() - new Date(product.created_at).getTime() < 7 * 24 * 60 * 60 * 1000;

  return (
    <Link
      to={`/shop/${creator.store_slug}/${product.slug}`}
      className={`mkt-card ${compact ? "mkt-card-compact" : ""}`}
    >
      <div className="mkt-card-image">
        {product.hero_image_url ? (
          <img src={product.hero_image_url} alt={product.title} loading="lazy" />
        ) : (
          <div className="mkt-card-placeholder" />
        )}
        <button
          className="mkt-card-heart"
          onClick={(e) => {
            e.preventDefault();
            // Stub — favorites are a future feature
          }}
          aria-label="Save"
          title="Save (coming soon)"
        >
          ♡
        </button>
        {recentlyAdded && <span className="mkt-card-badge">New</span>}
      </div>
      <div className="mkt-card-meta">
        <h3 className="mkt-card-title">{product.title}</h3>
        <p className="mkt-card-creator">
          {creator.store_name}
        </p>
        <div className="mkt-card-bottom">
          <span className="mkt-card-price">
            {formatPrice(product.price_cents, product.currency)}
          </span>
          {product.cad_summary_json && (
            <span className="mkt-card-cad" title="Manufacturing CAD bundle included">
              + CAD
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
