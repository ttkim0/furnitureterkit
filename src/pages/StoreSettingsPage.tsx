// Store settings — /app/store-settings
//
// Where creators edit their store after the initial publish. Same shape
// as StoreBuilderPage but loads existing data and uses UPDATE not INSERT.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isConfigured as isSupabaseConfigured } from "../lib/supabase";
import {
  THEME_PRESETS,
  themeById,
  TYPOGRAPHY_FONTS,
  type Creator,
  type Palette,
  type ThemeId,
} from "../lib/marketplace";
import { generateLogoImage } from "../lib/api";
import {
  listCreatorsByUserId,
  updateCreator,
} from "../lib/storeDb";
import { resolveActiveStore } from "../lib/activeStore";

export function StoreSettingsPage() {
  const auth = useAuth();
  const userId = auth.session?.user?.id;

  const [creator, setCreator] = useState<Creator | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "nostore" | "noauth">("loading");

  // Form state — initialized from loaded creator row
  const [storeName, setStoreName] = useState("");
  const [tagline, setTagline] = useState("");
  const [about, setAbout] = useState("");
  const [themeId, setThemeId] = useState<ThemeId>("minimal-dark");
  const [palette, setPalette] = useState<Palette | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoStatus, setLogoStatus] = useState<"idle" | "generating" | "error">("idle");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoStyle, setLogoStyle] = useState<"wordmark" | "mark" | "combined">("wordmark");
  const [logoVibe, setLogoVibe] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.ready) return;
    if (!userId) return setLoadState("noauth");
    (async () => {
      try {
        const stores = await listCreatorsByUserId(userId);
        const c = resolveActiveStore(stores);
        if (!c) return setLoadState("nostore");
        setCreator(c);
        setStoreName(c.store_name);
        setTagline(c.tagline ?? "");
        setAbout(c.about ?? "");
        setThemeId(c.theme_id);
        setPalette(c.palette);
        setLogoUrl(c.logo_url);
        setLoadState("ready");
      } catch {
        setLoadState("nostore");
      }
    })();
  }, [auth.ready, userId]);

  const activeTheme = themeById(themeId);
  const activePalette = palette ?? activeTheme.palette;

  async function handleGenerateLogo() {
    if (!storeName.trim()) {
      setLogoError("Store name is required.");
      return;
    }
    setLogoStatus("generating");
    setLogoError(null);
    try {
      const result = await generateLogoImage({
        storeName: storeName.trim(),
        tagline: tagline.trim() || undefined,
        style: logoStyle,
        vibe: logoVibe || "matching brand vibe",
        bgColor: activePalette.primary,
      });
      setLogoUrl(result.url);
      setLogoStatus("idle");
    } catch (e) {
      setLogoStatus("error");
      setLogoError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSave() {
    if (!creator) return;
    if (!isSupabaseConfigured()) {
      setSaveError("Supabase not configured.");
      return;
    }
    setSaveState("saving");
    setSaveError(null);
    try {
      const updated = await updateCreator(creator.id, {
        store_name: storeName.trim() || creator.store_name,
        tagline: tagline.trim() || null,
        about: about.trim() || null,
        theme_id: themeId,
        palette: activePalette,
        typography: activeTheme.typography,
        logo_url: logoUrl,
      });
      setCreator(updated);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  const themeStyles = useMemo(() => ({}), []);
  void themeStyles;

  if (loadState === "loading") return <main className="flow-page flow-empty"><p>Loading…</p></main>;
  if (loadState === "noauth") {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>Sign in</h1>
          <Link className="flow-btn flow-btn-primary" to="/auth">Sign in</Link>
        </div>
      </main>
    );
  }
  if (loadState === "nostore" || !creator) {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>No store yet</h1>
          <p>Design and publish your first piece to create a storefront.</p>
          <Link className="flow-btn flow-btn-primary" to="/app">Open editor</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flow-page builder-page">
      <header className="flow-header">
        <h1>Store settings</h1>
        <p className="flow-sub">
          Live at{" "}
          <Link to={`/shop/${creator.store_slug}`} className="flow-success-title">
            ariadne.shop/{creator.store_slug}
          </Link>
        </p>
      </header>

      <section className="flow-card builder-section">
        <h2>Brand</h2>
        <label className="flow-field">
          <span>Store name</span>
          <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)} maxLength={60} />
        </label>
        <label className="flow-field">
          <span>Tagline</span>
          <input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} />
        </label>
        <label className="flow-field">
          <span>About</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={5} maxLength={600} />
        </label>
        <p className="flow-help">
          Store URL (<code>{creator.store_slug}</code>) can't be changed —
          changing it would break existing links to your store and products.
        </p>
      </section>

      <section className="flow-card builder-section">
        <h2>Look</h2>
        <div className="builder-theme-grid">
          {THEME_PRESETS.map((t) => (
            <button
              key={t.id}
              className={`builder-theme-card ${themeId === t.id ? "is-active" : ""}`}
              onClick={() => { setThemeId(t.id); setPalette(null); }}
            >
              <div
                className="builder-theme-swatch"
                style={{
                  background: t.palette.primary,
                  color: t.palette.text,
                  borderColor: t.palette.accent,
                  fontFamily: TYPOGRAPHY_FONTS[t.typography].display,
                }}
              >
                <span style={{ color: t.palette.accent, fontSize: 22 }}>Aa</span>
                <small style={{ color: t.palette.muted, fontSize: 9 }}>
                  {TYPOGRAPHY_FONTS[t.typography].sample}
                </small>
              </div>
              <div className="builder-theme-meta">
                <strong>{t.name}</strong>
                <span>{t.description}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="builder-palette">
          <span className="flow-field-hint">Palette:</span>
          <div className="builder-palette-row">
            {(["primary","accent","text","muted"] as const).map((k) => (
              <label key={k} className="builder-swatch">
                <input type="color" value={activePalette[k]} onChange={(e) => setPalette({ ...activePalette, [k]: e.target.value })} />
                <span className="builder-swatch-color" style={{ background: activePalette[k] }} />
                <span className="builder-swatch-label">{k === "primary" ? "bg" : k}</span>
                <span className="builder-swatch-hex">{activePalette[k]}</span>
              </label>
            ))}
            {palette && (
              <button className="builder-palette-reset" onClick={() => setPalette(null)}>reset</button>
            )}
          </div>
        </div>
      </section>

      <section className="flow-card builder-section">
        <h2>Logo</h2>
        {logoUrl && (
          <div className="builder-logo-preview" style={{ background: activePalette.primary, marginBottom: 12 }}>
            <img src={logoUrl} alt="Logo" />
          </div>
        )}
        <div className="builder-logo-controls">
          <label className="flow-field flow-field-half">
            <span>Style</span>
            <select value={logoStyle} onChange={(e) => setLogoStyle(e.target.value as "wordmark" | "mark" | "combined")}>
              <option value="wordmark">Wordmark</option>
              <option value="mark">Mark</option>
              <option value="combined">Combined</option>
            </select>
          </label>
          <label className="flow-field flow-field-half">
            <span>Vibe</span>
            <input type="text" value={logoVibe} onChange={(e) => setLogoVibe(e.target.value)} placeholder="e.g. warm rustic, modernist" />
          </label>
        </div>
        <button className="flow-btn flow-btn-primary builder-logo-btn" onClick={handleGenerateLogo} disabled={logoStatus === "generating"}>
          {logoStatus === "generating" ? "Generating…" : "Regenerate logo"}
        </button>
        {logoError && <div className="flow-error">{logoError}</div>}
      </section>

      {saveError && <div className="flow-error builder-submit-error">{saveError}</div>}

      <footer className="flow-footer">
        <Link className="flow-btn flow-btn-ghost" to="/app/dashboard">‹ Back to dashboard</Link>
        <button
          className="flow-btn flow-btn-primary"
          onClick={handleSave}
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : "Save changes"}
        </button>
      </footer>
    </main>
  );
}
