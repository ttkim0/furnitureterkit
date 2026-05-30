// Creator dashboard — /app/dashboard
//
// Full analytics suite. EVERY metric is computed from real Supabase data
// (orders + analytics_events). Nothing is hardcoded.
//
// Sections:
//   1. Sidebar nav
//   2. Topbar (greeting + store link + AI insights button)
//   3. Store profile card + quick actions
//   4. AI insights (Claude reads metrics, returns 2-3 actionable bullets)
//   5. Hero stat row: Revenue · AOV · Orders · Conversion
//   6. Live + sessions row: live now · today · 7-day · 30-day
//   7. Revenue chart + featured piece
//   8. Customers section: total · new vs returning · repeat customers
//   9. Behavior: avg session · bounce rate · top referrers
//  10. Geo: country breakdown
//  11. Top products by views + by sales
//  12. Recent orders + recent activity

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  listCreatorsByUserId,
  getOrdersByCreator,
  getProductsByCreator,
} from "../lib/storeDb";
import { resolveActiveStore, setActiveStoreId } from "../lib/activeStore";
import { getSupabase } from "../lib/supabase";
import {
  formatPrice,
  type AnalyticsEvent,
  type Creator,
  type Order,
  type Product,
} from "../lib/marketplace";

export function DashboardPage() {
  const auth = useAuth();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [allStores, setAllStores] = useState<Creator[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "nostore" | "noauth">("loading");
  const [insights, setInsights] = useState<{ text: string; loading: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (!auth.ready) return;
    const userId = auth.session?.user?.id;
    if (!userId) return setLoadState("noauth");
    (async () => {
      try {
        const stores = await listCreatorsByUserId(userId);
        setAllStores(stores);
        const active = resolveActiveStore(stores);
        if (!active) return setLoadState("nostore");
        setCreator(active);
        const [ps, os, evs] = await Promise.all([
          getProductsByCreator(active.id),
          getOrdersByCreator(active.id),
          fetchRecentEvents(active.store_slug, 1000),
        ]);
        setProducts(ps);
        setOrders(os);
        setEvents(evs);
        setLoadState("ready");
      } catch (e) {
        console.error("dashboard load failed:", e);
        setLoadState("nostore");
      }
    })();
  }, [auth.ready, auth.session?.user?.id]);

  async function switchStore(newId: string) {
    const target = allStores.find((s) => s.id === newId);
    if (!target) return;
    setActiveStoreId(newId);
    setCreator(target);
    setLoadState("loading");
    try {
      const [ps, os, evs] = await Promise.all([
        getProductsByCreator(target.id),
        getOrdersByCreator(target.id),
        fetchRecentEvents(target.store_slug, 1000),
      ]);
      setProducts(ps);
      setOrders(os);
      setEvents(evs);
      setLoadState("ready");
      setInsights(null);
    } catch {
      setLoadState("nostore");
    }
  }

  // Re-fetch live events every 30s so "live now" feels real.
  useEffect(() => {
    if (loadState !== "ready" || !creator) return;
    const id = setInterval(() => {
      fetchRecentEvents(creator.store_slug, 1000).then(setEvents).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [loadState, creator]);

  // ── Derived: hero stats ──────────────────────────────────────────────
  const realizedOrders = useMemo(
    () => orders.filter((o) => !["pending", "refunded", "cancelled"].includes(o.status)),
    [orders]
  );
  const revenue = useMemo(
    () => realizedOrders.reduce((s, o) => s + o.amount_cents, 0),
    [realizedOrders]
  );
  const aov = useMemo(
    () => (realizedOrders.length === 0 ? 0 : Math.round(revenue / realizedOrders.length)),
    [revenue, realizedOrders]
  );
  const livePieces = useMemo(
    () => products.filter((p) => p.status === "published").length,
    [products]
  );

  // ── Sessions ─────────────────────────────────────────────────────────
  const sessions = useMemo(() => groupSessions(events), [events]);
  const liveSessions = useMemo(() => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    return Array.from(sessions.values()).filter((s) => s.lastEvent >= fiveMinAgo);
  }, [sessions]);
  const sessionsToday = useMemo(() => sessionsInWindow(sessions, 24 * 60 * 60 * 1000), [sessions]);
  const sessions7d = useMemo(() => sessionsInWindow(sessions, 7 * 24 * 60 * 60 * 1000), [sessions]);
  const sessions30d = useMemo(() => sessionsInWindow(sessions, 30 * 24 * 60 * 60 * 1000), [sessions]);
  const totalSessions = sessions.size;

  // Avg session duration (seconds)
  const avgSessionSec = useMemo(() => {
    if (sessions.size === 0) return 0;
    const durations = Array.from(sessions.values()).map((s) =>
      Math.max(0, (s.lastEvent - s.firstEvent) / 1000)
    );
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }, [sessions]);

  // Bounce rate: sessions with only 1 event / total sessions
  const bounceRate = useMemo(() => {
    if (sessions.size === 0) return 0;
    const bounced = Array.from(sessions.values()).filter((s) => s.eventCount === 1).length;
    return Math.round((bounced / sessions.size) * 1000) / 10;
  }, [sessions]);

  // Conversion rate (purchases / unique sessions that saw the store)
  const conversionRate = useMemo(() => {
    if (sessions.size === 0) return 0;
    const purchases = events.filter((e) => e.event_type === "purchase_complete").length;
    return Math.round((purchases / sessions.size) * 1000) / 10;
  }, [sessions, events]);

  // ── Customers ────────────────────────────────────────────────────────
  const customers = useMemo(() => {
    const byEmail = new Map<string, { email: string; count: number; spend: number; firstAt: number; lastAt: number }>();
    for (const o of realizedOrders) {
      const key = o.buyer_email.toLowerCase();
      const cur = byEmail.get(key);
      const ts = new Date(o.created_at).getTime();
      if (cur) {
        cur.count++;
        cur.spend += o.amount_cents;
        cur.firstAt = Math.min(cur.firstAt, ts);
        cur.lastAt = Math.max(cur.lastAt, ts);
      } else {
        byEmail.set(key, { email: o.buyer_email, count: 1, spend: o.amount_cents, firstAt: ts, lastAt: ts });
      }
    }
    return byEmail;
  }, [realizedOrders]);

  const repeatCustomers = useMemo(
    () => Array.from(customers.values()).filter((c) => c.count >= 2),
    [customers]
  );
  const repeatRate = useMemo(
    () => (customers.size === 0 ? 0 : Math.round((repeatCustomers.length / customers.size) * 1000) / 10),
    [customers, repeatCustomers]
  );

  // New vs returning visitors (by ip_hash if present, else session_id)
  const visitorSplit = useMemo(() => {
    const seen = new Map<string, number>(); // ipHash -> sessionCount
    for (const s of sessions.values()) {
      const key = s.ipHash ?? s.sessionId;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    let newVisitors = 0;
    let returning = 0;
    for (const count of seen.values()) {
      if (count === 1) newVisitors++;
      else returning++;
    }
    return { new: newVisitors, returning, total: seen.size };
  }, [sessions]);

  // ── Geo ──────────────────────────────────────────────────────────────
  const countryStats = useMemo(() => {
    const counts = new Map<string, { country: string; name: string; visits: number; uniqueVisitors: Set<string>; purchases: number }>();
    for (const ev of events) {
      const key = ev.country ?? "??";
      const name = ev.country_name ?? "Unknown";
      let cur = counts.get(key);
      if (!cur) {
        cur = { country: key, name, visits: 0, uniqueVisitors: new Set(), purchases: 0 };
        counts.set(key, cur);
      }
      cur.visits++;
      if (ev.ip_hash) cur.uniqueVisitors.add(ev.ip_hash);
      else if (ev.session_id) cur.uniqueVisitors.add(ev.session_id);
      if (ev.event_type === "purchase_complete") cur.purchases++;
    }
    return Array.from(counts.values())
      .map((c) => ({ ...c, uniqueVisitors: c.uniqueVisitors.size }))
      .sort((a, b) => b.visits - a.visits);
  }, [events]);

  // ── Behavior ─────────────────────────────────────────────────────────
  const topReferrers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ev of events) {
      const ref = (ev.referrer ?? "").trim();
      const source = ref ? hostnameOf(ref) : "direct";
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [events]);

  // Top products by views
  const topProductsByViews = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ev of events) {
      if (ev.event_type !== "product_view" || !ev.product_id) continue;
      counts.set(ev.product_id, (counts.get(ev.product_id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, count]) => ({ product: products.find((p) => p.id === id), views: count }))
      .filter((x) => x.product)
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);
  }, [events, products]);

  // Top products by sales
  const topProductsBySales = useMemo(() => {
    const map = new Map<string, { product?: Product; orders: number; revenue: number }>();
    for (const o of realizedOrders) {
      const cur = map.get(o.product_id) ?? {
        product: products.find((p) => p.id === o.product_id),
        orders: 0,
        revenue: 0,
      };
      cur.orders++;
      cur.revenue += o.amount_cents;
      map.set(o.product_id, cur);
    }
    return Array.from(map.values())
      .filter((x) => x.product)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [realizedOrders, products]);

  // Revenue by week (12 weeks)
  const revenueByWeek = useMemo(() => buildRevenueByWeek(orders, 12), [orders]);

  // Featured piece: most-sold (or most-viewed) published piece
  const featuredProduct = useMemo(() => {
    if (products.length === 0) return null;
    const pubs = products.filter((p) => p.status === "published");
    if (pubs.length === 0) return products[0];
    const top = topProductsBySales[0]?.product || topProductsByViews[0]?.product;
    return top ?? pubs[0];
  }, [products, topProductsBySales, topProductsByViews]);

  // ── AI insights ─────────────────────────────────────────────────────
  async function fetchInsights() {
    if (!creator) return;
    setInsights({ text: "", loading: true });
    try {
      const res = await fetch("/api/dashboard-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metrics: {
            storeName: creator.store_name,
            storeSlug: creator.store_slug,
            livePieces,
            totalOrders: realizedOrders.length,
            revenue: revenue / 100,
            aov: aov / 100,
            conversionRate,
            totalSessions,
            sessionsLast7d: sessions7d,
            sessionsLast30d: sessions30d,
            avgSessionSec,
            bounceRate,
            uniqueVisitors: visitorSplit.total,
            newVisitors: visitorSplit.new,
            returningVisitors: visitorSplit.returning,
            totalCustomers: customers.size,
            repeatCustomers: repeatCustomers.length,
            repeatRate,
            topCountries: countryStats.slice(0, 5).map((c) => ({
              country: c.name,
              visits: c.visits,
              uniqueVisitors: c.uniqueVisitors,
              purchases: c.purchases,
            })),
            topReferrers,
            topProductsByViews: topProductsByViews.map((x) => ({
              title: x.product?.title,
              views: x.views,
            })),
            topProductsBySales: topProductsBySales.map((x) => ({
              title: x.product?.title,
              orders: x.orders,
              revenue: x.revenue / 100,
            })),
          },
        }),
      });
      const data = await res.json();
      if (data?.insights) setInsights({ text: data.insights, loading: false });
      else setInsights({ text: "", loading: false, error: data?.error ?? "no insights returned" });
    } catch (e) {
      setInsights({ text: "", loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── Render guards ────────────────────────────────────────────────────
  if (loadState === "loading") {
    return <main className="dash-empty"><p>Loading dashboard…</p></main>;
  }
  if (loadState === "noauth") {
    return (
      <main className="dash-empty">
        <div className="dash-empty-inner">
          <h1>Sign in</h1>
          <Link className="flow-btn flow-btn-primary" to="/auth">Sign in</Link>
        </div>
      </main>
    );
  }
  if (loadState === "nostore" || !creator) {
    return (
      <main className="dash-empty">
        <div className="dash-empty-inner">
          <h1>You don't have a store yet</h1>
          <p>Design and publish your first piece.</p>
          <Link className="flow-btn flow-btn-primary" to="/app">Open editor</Link>
        </div>
      </main>
    );
  }

  const userFirstName =
    (auth.session?.user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    auth.session?.user?.email?.split("@")[0] ??
    "Maker";

  return (
    <main className="dash-layout">
      <aside className="dash-sidebar">
        <div className="dash-brand">
          <span className="dash-brand-mark">A</span>
          <span className="dash-brand-name">Ariadne</span>
        </div>

        {/* Store switcher — shown when the user owns multiple stores */}
        {allStores.length > 1 ? (
          <div className="dash-store-switcher">
            <span className="dash-store-switcher-label">Current store</span>
            <select
              value={creator.id}
              onChange={(e) => switchStore(e.target.value)}
              className="dash-store-switcher-select"
            >
              {allStores.map((s) => (
                <option key={s.id} value={s.id}>{s.store_name}</option>
              ))}
            </select>
            <Link to="/app/stores" className="dash-store-switcher-all">
              See all stores →
            </Link>
          </div>
        ) : (
          <Link to="/app/stores" className="dash-store-switcher-newhint">
            + Add another store
          </Link>
        )}

        <nav className="dash-nav">
          <Link to="/app/dashboard" className="dash-nav-item is-active">
            <span className="dash-nav-icon">⊟</span> Dashboard
          </Link>
          <Link to={`/shop/${creator.store_slug}`} className="dash-nav-item">
            <span className="dash-nav-icon">◉</span> My store
          </Link>
          <Link to="/app/store-designer" className="dash-nav-item">
            <span className="dash-nav-icon">✎</span> Redesign
          </Link>
          <Link to="/app" className="dash-nav-item">
            <span className="dash-nav-icon">+</span> New piece
          </Link>
          <Link to="/app/store-settings" className="dash-nav-item">
            <span className="dash-nav-icon">⚙</span> Settings
          </Link>
          <Link to="/app/stores" className="dash-nav-item">
            <span className="dash-nav-icon">▦</span> All my stores
          </Link>
        </nav>
        <div className="dash-sidebar-footer">
          <Link to="/shop" className="dash-nav-item dash-nav-item-quiet">
            ← Browse marketplace
          </Link>
        </div>
      </aside>

      <section className="dash-main">
        <header className="dash-topbar">
          <div>
            <h1 className="dash-greeting">
              Hello, <em>{userFirstName}</em>
            </h1>
            <p className="dash-subgreeting">
              {liveSessions.length > 0 ? (
                <>
                  <span className="dash-live-dot" /> {liveSessions.length} visitor{liveSessions.length === 1 ? "" : "s"} on your store right now
                </>
              ) : (
                <>Welcome back. Here's what's happening at {creator.store_name}.</>
              )}
            </p>
          </div>
          <div className="dash-topbar-actions">
            <Link to={`/shop/${creator.store_slug}`} className="dash-icon-btn" title="View live store">↗</Link>
            <span className="dash-avatar">{userFirstName.charAt(0).toUpperCase()}</span>
          </div>
        </header>

        {/* Store profile + quick actions */}
        <section className="dash-row dash-row-hero">
          <article className="dash-profile-card">
            <header className="dash-profile-header">
              {creator.logo_url ? (
                <img src={creator.logo_url} alt={creator.store_name} className="dash-profile-logo" />
              ) : (
                <span className="dash-profile-mark">{creator.store_name.charAt(0)}</span>
              )}
              <div>
                <span className="dash-profile-label">your store</span>
                <h2 className="dash-profile-name">{creator.store_name}</h2>
              </div>
            </header>
            <p className="dash-profile-tagline">{creator.tagline ?? "Add a tagline in store settings"}</p>
            <footer className="dash-profile-footer">
              <code className="dash-profile-url">ariadne.shop/{creator.store_slug}</code>
              <button
                className="dash-profile-share"
                onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/shop/${creator.store_slug}`)}
              >
                copy link
              </button>
            </footer>
          </article>
          <div className="dash-quick-actions">
            <QuickAction to="/app" icon="+" label="New piece" primary />
            <QuickAction to="/app/store-designer" icon="✎" label="Redesign" />
            <QuickAction to={`/shop/${creator.store_slug}`} icon="↗" label="View" />
            <QuickAction
              to="#"
              icon="⏍"
              label="Share"
              onClick={(e) => {
                e.preventDefault();
                navigator.clipboard?.writeText(`${window.location.origin}/shop/${creator.store_slug}`);
              }}
            />
            <QuickAction to="/app/store-settings" icon="⚙" label="Settings" />
          </div>
        </section>

        {/* AI INSIGHTS */}
        <section className="dash-row">
          <article className="dash-card dash-insights">
            <header className="dash-card-header">
              <div>
                <span className="dash-card-eyebrow">AI analysis</span>
                <h3>What your data is saying</h3>
              </div>
              <button
                className="dash-insights-btn"
                onClick={fetchInsights}
                disabled={insights?.loading}
              >
                {insights?.loading ? "Reading…" : insights?.text ? "Refresh" : "Generate insights"}
              </button>
            </header>
            {!insights && (
              <p className="dash-empty-line">
                Click "Generate insights" to have Claude review your metrics and suggest next moves.
              </p>
            )}
            {insights?.loading && (
              <p className="dash-empty-line">Claude is reviewing {events.length} events + {realizedOrders.length} orders…</p>
            )}
            {insights?.error && <p className="dash-empty-line dash-error">⚠ {insights.error}</p>}
            {insights?.text && (
              <div className="dash-insights-body" dangerouslySetInnerHTML={{ __html: renderInsights(insights.text) }} />
            )}
          </article>
        </section>

        {/* HERO STATS: Revenue / AOV / Orders / Conversion */}
        <section className="dash-stats">
          <StatCard
            title="Revenue"
            value={formatPrice(revenue)}
            sub={realizedOrders.length === 0 ? "No orders yet" : `from ${realizedOrders.length} order${realizedOrders.length === 1 ? "" : "s"}`}
            color="accent"
          />
          <StatCard
            title="Avg order value"
            value={aov === 0 ? "—" : formatPrice(aov)}
            sub={aov === 0 ? "needs orders" : "across all paid orders"}
            color="green"
          />
          <StatCard
            title="Orders"
            value={realizedOrders.length.toLocaleString()}
            sub={`${orders.filter((o) => o.status === "pending").length} pending`}
            color="blue"
          />
          <StatCard
            title="Conversion"
            value={conversionRate === 0 ? "—" : `${conversionRate}%`}
            sub={conversionRate === 0 ? "needs visitors" : "purchases / session"}
            color="muted"
          />
        </section>

        {/* LIVE + SESSIONS row */}
        <section className="dash-stats">
          <StatCard
            title="Live now"
            value={liveSessions.length.toLocaleString()}
            sub="active in last 5 min"
            color="live"
          />
          <StatCard
            title="Today"
            value={sessionsToday.toLocaleString()}
            sub="sessions"
            color="muted"
          />
          <StatCard
            title="Last 7 days"
            value={sessions7d.toLocaleString()}
            sub="sessions"
            color="muted"
          />
          <StatCard
            title="Last 30 days"
            value={sessions30d.toLocaleString()}
            sub={`${totalSessions} all-time`}
            color="muted"
          />
        </section>

        {/* Revenue chart + featured */}
        <section className="dash-row dash-row-2col">
          <article className="dash-card dash-revenue-chart">
            <header className="dash-card-header">
              <div>
                <span className="dash-card-eyebrow">Revenue, last 12 weeks</span>
                <h3>{formatPrice(revenue)}</h3>
              </div>
              <span className="dash-card-pill">{realizedOrders.length} orders</span>
            </header>
            <RevenueBarChart data={revenueByWeek} />
          </article>
          <article className="dash-card dash-featured">
            {featuredProduct ? (
              <>
                <span className="dash-card-eyebrow">Featured piece</span>
                <div className="dash-featured-image">
                  {featuredProduct.hero_image_url ? (
                    <img src={featuredProduct.hero_image_url} alt={featuredProduct.title} />
                  ) : (
                    <div className="dash-featured-placeholder" />
                  )}
                </div>
                <div className="dash-featured-meta">
                  <h3>{featuredProduct.title}</h3>
                  <p>{formatPrice(featuredProduct.price_cents, featuredProduct.currency)}</p>
                </div>
                <Link to={`/shop/${creator.store_slug}/${featuredProduct.slug}`} className="dash-featured-link">
                  View listing →
                </Link>
              </>
            ) : (
              <>
                <span className="dash-card-eyebrow">Featured piece</span>
                <p className="dash-empty-line">No published pieces yet.</p>
                <Link to="/app" className="flow-btn flow-btn-primary">Design one</Link>
              </>
            )}
          </article>
        </section>

        {/* CUSTOMERS section */}
        <section className="dash-row dash-row-2col">
          <article className="dash-card">
            <header className="dash-card-header">
              <div>
                <span className="dash-card-eyebrow">Customers</span>
                <h3>{customers.size.toLocaleString()} total</h3>
              </div>
            </header>
            <div className="dash-customer-stats">
              <MiniStat label="Repeat customers" value={repeatCustomers.length} sub={`${repeatRate}% of total`} />
              <MiniStat label="New visitors" value={visitorSplit.new} sub="single-session" />
              <MiniStat label="Returning visitors" value={visitorSplit.returning} sub={`${visitorSplit.total > 0 ? Math.round((visitorSplit.returning / visitorSplit.total) * 100) : 0}%`} />
            </div>
            {repeatCustomers.length > 0 && (
              <>
                <h4 className="dash-subhead">Top repeat customers</h4>
                <ul className="dash-customer-list">
                  {repeatCustomers
                    .sort((a, b) => b.spend - a.spend)
                    .slice(0, 5)
                    .map((c) => (
                      <li key={c.email} className="dash-customer-row">
                        <span className="dash-customer-email">{c.email}</span>
                        <span className="dash-customer-orders">{c.count} orders</span>
                        <span className="dash-customer-spend">{formatPrice(c.spend)}</span>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </article>

          <article className="dash-card">
            <header className="dash-card-header">
              <div>
                <span className="dash-card-eyebrow">Behavior</span>
                <h3>{avgSessionSec === 0 ? "—" : formatDuration(avgSessionSec)} avg session</h3>
              </div>
            </header>
            <div className="dash-customer-stats">
              <MiniStat label="Bounce rate" value={`${bounceRate}%`} sub={sessions.size === 0 ? "needs sessions" : "1-event sessions"} />
              <MiniStat label="Pages per session" value={sessions.size === 0 ? "—" : (events.length / sessions.size).toFixed(1)} sub="events/session" />
              <MiniStat label="Total events" value={events.length.toLocaleString()} sub="all-time" />
            </div>
            <h4 className="dash-subhead">Top traffic sources</h4>
            {topReferrers.length === 0 ? (
              <p className="dash-empty-line">No traffic yet — share your link to get started.</p>
            ) : (
              <ul className="dash-ref-list">
                {topReferrers.map((r) => (
                  <li key={r.source} className="dash-ref-row">
                    <span className="dash-ref-source">{r.source}</span>
                    <div className="dash-ref-bar">
                      <div className="dash-ref-fill" style={{ width: `${(r.count / topReferrers[0].count) * 100}%` }} />
                    </div>
                    <span className="dash-ref-count">{r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>

        {/* GEO + TOP PRODUCTS */}
        <section className="dash-row dash-row-2col">
          <article className="dash-card">
            <header className="dash-card-header">
              <div>
                <span className="dash-card-eyebrow">Geography</span>
                <h3>{countryStats.length} countries</h3>
              </div>
            </header>
            {countryStats.length === 0 ? (
              <p className="dash-empty-line">No visits yet — share your store link.</p>
            ) : (
              <table className="dash-table">
                <thead><tr><th>Country</th><th>Visits</th><th>Unique</th><th>Buys</th></tr></thead>
                <tbody>
                  {countryStats.slice(0, 8).map((c) => (
                    <tr key={c.country}>
                      <td>
                        {c.name} <span className="dashboard-country-code">{c.country}</span>
                      </td>
                      <td>{c.visits.toLocaleString()}</td>
                      <td>{c.uniqueVisitors.toLocaleString()}</td>
                      <td className={c.purchases > 0 ? "dash-buys-positive" : ""}>{c.purchases}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>

          <article className="dash-card">
            <header className="dash-card-header">
              <div>
                <span className="dash-card-eyebrow">Top pieces</span>
                <h3>By views</h3>
              </div>
            </header>
            {topProductsByViews.length === 0 ? (
              <p className="dash-empty-line">No piece views yet.</p>
            ) : (
              <ul className="dash-orders">
                {topProductsByViews.map((x) => (
                  <li key={x.product!.id} className="dash-order-row">
                    <span className="dash-order-icon">{x.product!.title.charAt(0).toUpperCase()}</span>
                    <div className="dash-order-meta">
                      <span className="dash-order-title">{x.product!.title}</span>
                      <span className="dash-order-sub">{formatPrice(x.product!.price_cents)}</span>
                    </div>
                    <div className="dash-order-amount">
                      <span>{x.views.toLocaleString()}</span>
                      <span className="dash-order-status dash-order-status-paid">views</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>

        {/* Top by sales + recent orders */}
        <section className="dash-row dash-row-2col">
          <article className="dash-card">
            <header className="dash-card-header">
              <div>
                <span className="dash-card-eyebrow">Top pieces</span>
                <h3>By revenue</h3>
              </div>
            </header>
            {topProductsBySales.length === 0 ? (
              <p className="dash-empty-line">No sales yet.</p>
            ) : (
              <ul className="dash-orders">
                {topProductsBySales.map((x) => (
                  <li key={x.product!.id} className="dash-order-row">
                    <span className="dash-order-icon">{x.product!.title.charAt(0).toUpperCase()}</span>
                    <div className="dash-order-meta">
                      <span className="dash-order-title">{x.product!.title}</span>
                      <span className="dash-order-sub">{x.orders} order{x.orders === 1 ? "" : "s"}</span>
                    </div>
                    <div className="dash-order-amount">
                      <span>{formatPrice(x.revenue)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="dash-card">
            <header className="dash-card-header">
              <div>
                <span className="dash-card-eyebrow">Recent orders</span>
                <h3>{orders.length} all-time</h3>
              </div>
            </header>
            {orders.length === 0 ? (
              <p className="dash-empty-line">No orders yet.</p>
            ) : (
              <ul className="dash-orders">
                {orders.slice(0, 6).map((o) => {
                  const product = products.find((p) => p.id === o.product_id);
                  return (
                    <li key={o.id} className="dash-order-row">
                      <span className="dash-order-icon">{product?.title?.charAt(0).toUpperCase() ?? "·"}</span>
                      <div className="dash-order-meta">
                        <span className="dash-order-title">{product?.title ?? "Piece"}</span>
                        <span className="dash-order-sub">
                          <code>{o.order_number}</code> · {o.buyer_name ?? o.buyer_email}
                        </span>
                      </div>
                      <div className="dash-order-amount">
                        <span>{formatPrice(o.amount_cents, o.currency)}</span>
                        <span className={`dash-order-status dash-order-status-${o.status}`}>{o.status}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </section>

        {/* Recent activity */}
        <section className="dash-row">
          <article className="dash-card">
            <header className="dash-card-header">
              <div>
                <span className="dash-card-eyebrow">Recent activity</span>
                <h3>{events.length} events</h3>
              </div>
            </header>
            {events.length === 0 ? (
              <p className="dash-empty-line">Nothing yet. Once visitors arrive, you'll see what they did.</p>
            ) : (
              <ul className="dash-activity">
                {events.slice(0, 14).map((ev) => (
                  <li key={ev.id} className="dash-activity-row">
                    <span className={`dash-activity-icon dash-activity-icon-${ev.event_type}`}>
                      {eventIcon(ev.event_type)}
                    </span>
                    <span className="dash-activity-text">{humanizeEvent(ev)}</span>
                    <span className="dash-activity-time">{timeAgo(ev.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      </section>
    </main>
  );
}

/* ───────────────────────── Sub-components ───────────────────────── */
function QuickAction({ to, icon, label, primary = false, onClick }: { to: string; icon: string; label: string; primary?: boolean; onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void; }) {
  return (
    <Link to={to} onClick={onClick} className={`dash-qa ${primary ? "is-primary" : ""}`}>
      <span className="dash-qa-circle">{icon}</span>
      <span className="dash-qa-label">{label}</span>
    </Link>
  );
}

function StatCard({ title, value, sub, color }: { title: string; value: string; sub?: string; color: "accent" | "green" | "blue" | "muted" | "live"; }) {
  return (
    <div className={`dash-stat-card dash-stat-card-${color}`}>
      <span className="dash-stat-label">{title}</span>
      <span className="dash-stat-value">{value}</span>
      {sub && <span className="dash-stat-sub">{sub}</span>}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="dash-mini-stat">
      <span className="dash-mini-stat-value">{value}</span>
      <span className="dash-mini-stat-label">{label}</span>
      {sub && <span className="dash-mini-stat-sub">{sub}</span>}
    </div>
  );
}

function RevenueBarChart({ data }: { data: { weekStart: string; cents: number }[] }) {
  const max = Math.max(...data.map((d) => d.cents), 1);
  return (
    <div className="dash-bars">
      {data.map((d, i) => {
        const heightPct = (d.cents / max) * 100;
        return (
          <div key={i} className="dash-bar-col" title={`${d.weekStart}: ${formatPrice(d.cents)}`}>
            <div className="dash-bar" style={{ height: `${Math.max(4, heightPct)}%` }} />
            <span className="dash-bar-label">{shortWeek(d.weekStart)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Helpers ───────────────────────── */
interface SessionInfo {
  sessionId: string;
  ipHash: string | null;
  firstEvent: number;
  lastEvent: number;
  eventCount: number;
}

function groupSessions(events: AnalyticsEvent[]): Map<string, SessionInfo> {
  const map = new Map<string, SessionInfo>();
  for (const ev of events) {
    const key = ev.session_id ?? `noid-${ev.id}`;
    const ts = new Date(ev.created_at).getTime();
    const cur = map.get(key);
    if (cur) {
      cur.firstEvent = Math.min(cur.firstEvent, ts);
      cur.lastEvent = Math.max(cur.lastEvent, ts);
      cur.eventCount++;
      if (!cur.ipHash && ev.ip_hash) cur.ipHash = ev.ip_hash;
    } else {
      map.set(key, { sessionId: key, ipHash: ev.ip_hash, firstEvent: ts, lastEvent: ts, eventCount: 1 });
    }
  }
  return map;
}

function sessionsInWindow(sessions: Map<string, SessionInfo>, windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  let n = 0;
  for (const s of sessions.values()) {
    if (s.firstEvent >= cutoff) n++;
  }
  return n;
}

async function fetchRecentEvents(storeSlug: string, limit = 500): Promise<AnalyticsEvent[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("analytics_events")
    .select("*")
    .eq("store_slug", storeSlug)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as AnalyticsEvent[]) ?? [];
}

function buildRevenueByWeek(orders: Order[], weeks: number): { weekStart: string; cents: number }[] {
  const buckets = new Map<string, number>();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const dayIdx = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dayIdx);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const o of orders) {
    if (o.status === "refunded" || o.status === "cancelled" || o.status === "pending") continue;
    const d = new Date(o.created_at);
    d.setHours(0, 0, 0, 0);
    const dayIdx = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dayIdx);
    const key = d.toISOString().slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + o.amount_cents);
    }
  }
  return Array.from(buckets.entries()).map(([weekStart, cents]) => ({ weekStart, cents }));
}

function shortWeek(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url.slice(0, 30); }
}

function eventIcon(t: AnalyticsEvent["event_type"]): string {
  return ({ store_view: "◯", product_view: "◐", add_to_cart: "+", checkout_started: "→", purchase_complete: "✓" } as Record<string, string>)[t] ?? "·";
}

function humanizeEvent(ev: AnalyticsEvent): string {
  const where = [ev.city, ev.country_name].filter(Boolean).join(", ") || "Unknown location";
  switch (ev.event_type) {
    case "store_view": return `Visitor from ${where} opened your store`;
    case "product_view": return `Visitor from ${where} viewed a piece`;
    case "add_to_cart": return `Visitor from ${where} added a piece to cart`;
    case "checkout_started": return `Visitor from ${where} started checkout`;
    case "purchase_complete": return `Purchase completed from ${where}`;
    default: return `Event from ${where}`;
  }
}

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

function renderInsights(md: string): string {
  // Tiny markdown renderer for the AI insights output. Handles bullets,
  // bold, italic, code, links. Safe-ish — we trust Claude's output but
  // strip raw HTML.
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  const items = lines
    .map((l) => l.replace(/^[-*•]\s*/, ""))
    .map((l) => escape(l))
    .map((l) => l
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>"));
  return "<ul>" + items.map((it) => `<li>${it}</li>`).join("") + "</ul>";
}
