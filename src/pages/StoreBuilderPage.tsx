// Store builder — turn the just-published product into a live storefront.
//
// Single-page wizard with 4 sections you scroll through, not a stepper:
//   1. Brand   — store name + slug (auto-suggested from name, live-checked)
//   2. Look    — theme preset + palette tweaks
//   3. Logo    — AI-generated wordmark (regen freely) OR upload your own
//   4. About   — tagline + about copy
// On submit:
//   - Insert a `creators` row for this user (via Supabase, RLS-protected)
//   - Insert a `products` row with the pending CheckoutSession's data
//   - Navigate to /shop/:slug
//
// Resilience: if Supabase isn't configured (dev), we still UI-test the
// builder; on submit we show a warning that nothing was saved.

import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getCheckoutSession, clearCheckoutSession } from "../lib/checkoutSession";
import {
  THEME_PRESETS,
  themeById,
  slugify,
  TYPOGRAPHY_FONTS,
  type Palette,
  type ThemeId,
} from "../lib/marketplace";
import { generateLogoImage } from "../lib/api";
import {
  createCreator,
  createProduct,
  isSlugAvailable,
  getCreatorByUserId,
} from "../lib/storeDb";
import { useAuth } from "../lib/auth";
import { isConfigured as isSupabaseConfigured } from "../lib/supabase";

export function StoreBuilderPage() {
  const navigate = useNavigate();
  const session = getCheckoutSession();
  const auth = useAuth();

  // ── Form state ───────────────────────────────────────────────────────
  const [storeName, setStoreName] = useState("");
  const [storeSlug, setStoreSlug] = useState("");
  const [slugStatus, setSlugStatus] = useState<"unchecked" | "available" | "taken" | "checking" | "invalid">(
    "unchecked"
  );
  const [themeId, setThemeId] = useState<ThemeId>("minimal-dark");
  const [paletteOverride, setPaletteOverride] = useState<Palette | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoStatus, setLogoStatus] = useState<"idle" | "generating" | "error">("idle");
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoStyle, setLogoStyle] = useState<"wordmark" | "mark" | "combined">("wordmark");
  const [logoVibe, setLogoVibe] = useState("minimal modern, gallery-grade");
  const [tagline, setTagline] = useState("");
  const [about, setAbout] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-suggest slug from name unless user has typed their own.
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  useEffect(() => {
    if (!slugManuallyEdited) setStoreSlug(slugify(storeName));
  }, [storeName, slugManuallyEdited]);

  // Resolve theme + active palette
  const theme = themeById(themeId);
  const palette = paletteOverride ?? theme.palette;

  // Debounced slug availability check
  useEffect(() => {
    if (!storeSlug || !isSupabaseConfigured()) {
      setSlugStatus("unchecked");
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(storeSlug)) {
      setSlugStatus("invalid");
      return;
    }
    setSlugStatus("checking");
    const handle = setTimeout(async () => {
      try {
        const ok = await isSlugAvailable(storeSlug);
        setSlugStatus(ok ? "available" : "taken");
      } catch {
        setSlugStatus("unchecked");
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [storeSlug]);

  // If user already has a store, redirect — Phase 1 supports only one store/user.
  useEffect(() => {
    if (!auth.session?.user?.id || !isSupabaseConfigured()) return;
    (async () => {
      try {
        const existing = await getCreatorByUserId(auth.session!.user!.id);
        if (existing) {
          // For now, send them to their store. Phase 2 will let them
          // ADD products to an existing store from this page.
          navigate(`/shop/${existing.store_slug}`);
        }
      } catch {
        // Ignore — let user proceed to create.
      }
    })();
  }, [auth.session?.user?.id]);

  // ── Logo generation ─────────────────────────────────────────────────
  async function handleGenerateLogo() {
    if (!storeName.trim()) {
      setLogoError("Add a store name first so the logo has text to use.");
      return;
    }
    setLogoStatus("generating");
    setLogoError(null);
    try {
      const result = await generateLogoImage({
        storeName: storeName.trim(),
        tagline: tagline.trim() || undefined,
        style: logoStyle,
        vibe: logoVibe,
        bgColor: palette.primary,
      });
      setLogoUrl(result.url);
      setLogoStatus("idle");
    } catch (e) {
      setLogoStatus("error");
      setLogoError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Submit: create creator + product → /shop/:slug ───────────────────
  const canSubmit = useMemo(() => {
    return (
      storeName.trim().length >= 2 &&
      (slugStatus === "available" || (!isSupabaseConfigured() && /^[a-z0-9][a-z0-9-]{2,30}$/.test(storeSlug))) &&
      session != null
    );
  }, [storeName, slugStatus, storeSlug, session]);

  async function handleSubmit() {
    if (!canSubmit || !session) return;
    if (!isSupabaseConfigured()) {
      setSubmitError("Supabase not configured — store can't be saved. Set VITE_SUPABASE_URL/_KEY and run the marketplace SQL migration.");
      return;
    }
    if (!auth.session?.user?.id) {
      setSubmitError("Not signed in.");
      return;
    }
    setSubmitState("submitting");
    setSubmitError(null);
    try {
      // 1. Create the creator row
      const userId = auth.session!.user!.id;
      const creator = await createCreator({
        user_id: userId,
        store_slug: storeSlug,
        store_name: storeName.trim(),
        tagline: tagline.trim() || undefined,
        about: about.trim() || undefined,
        logo_url: logoUrl ?? undefined,
        theme_id: themeId,
        palette,
        typography: theme.typography,
      });
      // 2. Promote the pending product
      const productSlug = slugify(
        session.proposedTitle ?? `${session.spec.category}-${session.modelId.slice(-6)}`
      );
      await createProduct({
        creator_id: creator.id,
        slug: productSlug || `piece-${session.modelId.slice(-6)}`,
        title: session.proposedTitle ?? `${session.spec.category} piece`,
        description: session.proposedDescription ?? undefined,
        price_cents: Math.round((session.proposedPriceUsd ?? 0) * 100),
        currency: "USD",
        mesh_url: session.meshUrl,
        cad_zip_url: session.cadZipUrl,
        spec_json: session.spec,
        cad_summary_json: session.cadSummary,
      });
      // 3. Clear the staged session — product is now in DB.
      clearCheckoutSession();
      setSubmitState("done");
      // 4. Send the user to their live store.
      setTimeout(() => navigate(`/shop/${creator.store_slug}`), 800);
    } catch (e) {
      setSubmitState("error");
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Empty state ──────────────────────────────────────────────────────
  if (!session) {
    return (
      <main className="flow-page flow-empty">
        <div className="flow-empty-inner">
          <h1>No piece pending</h1>
          <p>
            The store builder is the next step after a finalized piece.
            Design + finalize one first.
          </p>
          <Link className="flow-btn flow-btn-primary" to="/app">
            Open editor
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flow-page builder-page">
      <header className="flow-header">
        <h1>Set up your storefront</h1>
        <p className="flow-sub">
          Your first piece — <em>{session.proposedTitle}</em> — is ready to list.
          Pick a look, generate a logo, write your "about".
        </p>
      </header>

      {/* ── 1. Brand ──────────────────────────────────────────────────── */}
      <section className="flow-card builder-section">
        <h2>1. Brand</h2>
        <p className="flow-help">Your store name and URL. Both can be changed later.</p>

        <label className="flow-field">
          <span>Store name</span>
          <input
            type="text"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="e.g. Hearthwood Studio"
            maxLength={60}
          />
        </label>

        <label className="flow-field">
          <span>Store URL</span>
          <div className="builder-slug-input">
            <span className="builder-slug-prefix">ariadne.shop/</span>
            <input
              type="text"
              value={storeSlug}
              onChange={(e) => {
                setStoreSlug(slugify(e.target.value));
                setSlugManuallyEdited(true);
              }}
              placeholder="hearthwood"
              maxLength={32}
            />
          </div>
          <span className={`builder-slug-status builder-slug-${slugStatus}`}>
            {slugStatus === "checking" && "Checking…"}
            {slugStatus === "available" && "✓ Available"}
            {slugStatus === "taken" && "✗ Already taken — try another"}
            {slugStatus === "invalid" && "3–30 chars: lowercase letters, digits, hyphens"}
            {slugStatus === "unchecked" && " "}
          </span>
        </label>
      </section>

      {/* ── 2. Look ───────────────────────────────────────────────────── */}
      <section className="flow-card builder-section">
        <h2>2. Look</h2>
        <p className="flow-help">A theme sets the layout. Colors are tweakable.</p>

        <div className="builder-theme-grid">
          {THEME_PRESETS.map((t) => (
            <button
              key={t.id}
              className={`builder-theme-card ${themeId === t.id ? "is-active" : ""}`}
              onClick={() => {
                setThemeId(t.id);
                setPaletteOverride(null);
              }}
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
          <span className="flow-field-hint">Palette (overrides the theme defaults — click to change):</span>
          <div className="builder-palette-row">
            <PaletteSwatch
              label="bg"
              color={palette.primary}
              onChange={(c) => setPaletteOverride({ ...palette, primary: c })}
            />
            <PaletteSwatch
              label="accent"
              color={palette.accent}
              onChange={(c) => setPaletteOverride({ ...palette, accent: c })}
            />
            <PaletteSwatch
              label="text"
              color={palette.text}
              onChange={(c) => setPaletteOverride({ ...palette, text: c })}
            />
            <PaletteSwatch
              label="muted"
              color={palette.muted}
              onChange={(c) => setPaletteOverride({ ...palette, muted: c })}
            />
            {paletteOverride && (
              <button
                className="builder-palette-reset"
                onClick={() => setPaletteOverride(null)}
                title="Reset to theme defaults"
              >
                reset
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── 3. Logo ───────────────────────────────────────────────────── */}
      <section className="flow-card builder-section">
        <h2>3. Logo</h2>
        <p className="flow-help">
          Generated by gpt-image-1 from your store name. Regenerate freely until you like one.
        </p>

        <div className="builder-logo-controls">
          <label className="flow-field flow-field-half">
            <span>Style</span>
            <select value={logoStyle} onChange={(e) => setLogoStyle(e.target.value as "wordmark" | "mark" | "combined")}>
              <option value="wordmark">Wordmark (text only)</option>
              <option value="mark">Mark (icon only)</option>
              <option value="combined">Combined (icon + text)</option>
            </select>
          </label>
          <label className="flow-field flow-field-half">
            <span>Vibe</span>
            <input
              type="text"
              value={logoVibe}
              onChange={(e) => setLogoVibe(e.target.value)}
              placeholder="e.g. warm rustic, modernist, industrial"
              maxLength={80}
            />
          </label>
        </div>

        <button
          className="flow-btn flow-btn-primary builder-logo-btn"
          onClick={handleGenerateLogo}
          disabled={logoStatus === "generating" || !storeName.trim()}
        >
          {logoStatus === "generating" ? "Generating logo…" : logoUrl ? "Regenerate" : "Generate logo"}
        </button>

        {logoError && <div className="flow-error">{logoError}</div>}

        {logoUrl && (
          <div
            className="builder-logo-preview"
            style={{ background: palette.primary }}
          >
            <img src={logoUrl} alt="Generated logo" />
          </div>
        )}
      </section>

      {/* ── 4. About ──────────────────────────────────────────────────── */}
      <section className="flow-card builder-section">
        <h2>4. About</h2>
        <p className="flow-help">Shown on your storefront below the hero.</p>

        <label className="flow-field">
          <span>Tagline</span>
          <input
            type="text"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. Hand-built oak furniture, made one piece at a time."
            maxLength={120}
          />
        </label>

        <label className="flow-field">
          <span>About</span>
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            rows={5}
            placeholder="Tell visitors who you are, where you work, what you care about. 2–4 sentences is plenty."
            maxLength={600}
          />
        </label>
      </section>

      {submitError && <div className="flow-error builder-submit-error">{submitError}</div>}

      <footer className="flow-footer">
        <Link className="flow-btn flow-btn-ghost" to="/app/published">
          ‹ Back
        </Link>
        <button
          className="flow-btn flow-btn-primary"
          onClick={handleSubmit}
          disabled={!canSubmit || submitState === "submitting" || submitState === "done"}
        >
          {submitState === "submitting"
            ? "Publishing your store…"
            : submitState === "done"
              ? "✓ Live — redirecting…"
              : "Publish store →"}
        </button>
      </footer>
    </main>
  );
}

function PaletteSwatch({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (c: string) => void;
}) {
  return (
    <label className="builder-swatch">
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="builder-swatch-color" style={{ background: color }} />
      <span className="builder-swatch-label">{label}</span>
      <span className="builder-swatch-hex">{color}</span>
    </label>
  );
}
