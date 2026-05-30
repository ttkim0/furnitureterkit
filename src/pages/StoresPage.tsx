// My stores — /app/stores
//
// Grid of every storefront the current user owns. Each card opens the
// dashboard for that store. A "+ Create new store" tile spins up a new one.
//
// This is the canonical place to switch between brands.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { listCreatorsByUserId, getProductsByCreator } from "../lib/storeDb";
import { setActiveStoreId, getActiveStoreId } from "../lib/activeStore";
import type { Creator } from "../lib/marketplace";

interface StoreCard {
  creator: Creator;
  productCount: number;
}

export function StoresPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [cards, setCards] = useState<StoreCard[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "noauth">("loading");

  useEffect(() => {
    if (!auth.ready) return;
    const uid = auth.session?.user?.id;
    if (!uid) return setState("noauth");
    (async () => {
      try {
        const creators = await listCreatorsByUserId(uid);
        const counts = await Promise.all(
          creators.map(async (c) => {
            try {
              const ps = await getProductsByCreator(c.id);
              return { creator: c, productCount: ps.length };
            } catch {
              return { creator: c, productCount: 0 };
            }
          })
        );
        setCards(counts);
        setState("ready");
      } catch {
        setState("ready");
      }
    })();
  }, [auth.ready, auth.session?.user?.id]);

  function openStore(c: Creator) {
    setActiveStoreId(c.id);
    navigate("/app/dashboard");
  }

  function createNew() {
    setActiveStoreId(null);
    navigate("/app/store-designer?new=true");
  }

  if (state === "loading") {
    return <main className="flow-page flow-empty"><p>Loading your stores…</p></main>;
  }
  if (state === "noauth") {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>Sign in</h1>
          <Link className="flow-btn flow-btn-primary" to="/auth">Sign in</Link>
        </div>
      </main>
    );
  }

  const activeId = getActiveStoreId();

  return (
    <main className="stores-page">
      <header className="stores-header">
        <div>
          <h1>Your stores</h1>
          <p>
            Run as many brands as you want from one Ariadne account. Each
            store gets its own URL, design, dashboard, and pieces.
          </p>
        </div>
        <button className="stores-new-btn" onClick={createNew}>
          + Create new store
        </button>
      </header>

      {cards.length === 0 ? (
        <div className="stores-empty">
          <h2>No stores yet</h2>
          <p>Design a piece first, then build your first storefront for it.</p>
          <Link className="flow-btn flow-btn-primary" to="/app">Open editor</Link>
        </div>
      ) : (
        <div className="stores-grid">
          {cards.map((card) => {
            const c = card.creator;
            const isActive = c.id === activeId;
            return (
              <article
                key={c.id}
                className={`stores-card ${isActive ? "is-active" : ""}`}
              >
                {isActive && <span className="stores-card-active">currently open</span>}
                <header className="stores-card-header">
                  {c.logo_url ? (
                    <img src={c.logo_url} alt={c.store_name} className="stores-card-logo" />
                  ) : (
                    <span
                      className="stores-card-mark"
                      style={{ background: c.palette?.accent ?? "#c44a2e" }}
                    >
                      {c.store_name.charAt(0)}
                    </span>
                  )}
                  <div>
                    <h3>{c.store_name}</h3>
                    <code className="stores-card-slug">ariadne.shop/{c.store_slug}</code>
                  </div>
                </header>
                {c.tagline && <p className="stores-card-tagline">{c.tagline}</p>}
                <div className="stores-card-stats">
                  <span><strong>{card.productCount}</strong> {card.productCount === 1 ? "piece" : "pieces"}</span>
                  <span>
                    Designed {c.last_designed_at
                      ? relativeDate(c.last_designed_at)
                      : "—"}
                  </span>
                </div>
                <div className="stores-card-actions">
                  <button onClick={() => openStore(c)} className="stores-card-btn">
                    Open dashboard →
                  </button>
                  <Link to={`/shop/${c.store_slug}`} className="stores-card-btn-quiet">
                    View store ↗
                  </Link>
                </div>
              </article>
            );
          })}

          {/* Create-new tile */}
          <button onClick={createNew} className="stores-card stores-card-create">
            <span className="stores-card-create-plus">+</span>
            <h3>Create a new store</h3>
            <p>Spin up another brand with its own design, name, and pieces.</p>
          </button>
        </div>
      )}
    </main>
  );
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "today";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}w ago`;
  return new Date(iso).toLocaleDateString();
}
