// Lovable-style storefront designer — /app/store-designer
//
// Split-pane interface:
//   LEFT  — design controls (brief, references, inspirations, chat)
//   RIGHT — live preview iframe of the generated site
//
// Flow:
//   1. First visit: user fills brief + uploads inspirations + pastes references.
//   2. Click "Generate" → Claude Sonnet works for 30s–3min, returns HTML.
//   3. Preview renders in sandboxed iframe (no scripts can touch parent).
//   4. User iterates via chat — each message refines parts.
//   5. "Publish" commits the latest HTML to creator.custom_homepage_html
//      → live at /shop/:slug.
//
// Themes are still available as quick-start vibes, but discardable. Users
// with a strong vision can skip them entirely.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isConfigured as isSupabaseConfigured } from "../lib/supabase";
import {
  THEME_PRESETS,
  themeById,
  slugify,
  type Palette,
  type ThemeId,
} from "../lib/marketplace";
import { designStorefrontApi, uploadProductImage, uploadProductImageDataUrl, autoGenerateProductGalleries, autoGenerateProductVideos } from "../lib/api";
import { MeshSnapshotter } from "../components/MeshSnapshotter";
import { getCheckoutSession, clearCheckoutSession } from "../lib/checkoutSession";
import {
  createCreator,
  getCreatorById,
  listCreatorsByUserId,
  updateCreator,
  updateProduct,
  isSlugAvailable,
  createProduct,
  getProductsByCreator,
} from "../lib/storeDb";
import { setActiveStoreId, resolveActiveStore } from "../lib/activeStore";
import { renderProductGridHtml, renderStorefrontHtml } from "../lib/storefrontRender";

type ChatMessage = { role: "user" | "assistant"; content: string; html?: string };

export function StoreDesignerPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const userId = auth.session?.user?.id;
  const checkoutSession = getCheckoutSession();
  const [searchParams] = useSearchParams();
  // ?new=true forces a fresh creator row — used by the "Create a new store"
  // button on the Published page. Otherwise we edit the active one.
  const forceNew = searchParams.get("new") === "true";
  // Optional ?storeId=X targets a specific creator (e.g. from the
  // /app/stores picker).
  const targetStoreId = searchParams.get("storeId");

  // ── Existing-creator check (skip basics if they're iterating) ──────
  type Maybe<T> = T | null;
  const [existingCreator, setExistingCreator] = useState<Maybe<Awaited<ReturnType<typeof getCreatorById>>>>(null);
  useEffect(() => {
    if (!userId || !isSupabaseConfigured() || forceNew) return;
    (async () => {
      try {
        let target: Awaited<ReturnType<typeof getCreatorById>> = null;
        if (targetStoreId) {
          target = await getCreatorById(targetStoreId);
        } else {
          const all = await listCreatorsByUserId(userId);
          target = resolveActiveStore(all);
        }
        if (target) {
          setExistingCreator(target);
          setStoreName(target.store_name);
          setStoreSlug(target.store_slug);
          setTagline(target.tagline ?? "");
          setAbout(target.about ?? "");
          setDesignBrief(target.design_brief ?? "");
          setReferenceUrls(target.reference_urls ?? []);
          setInspirationImages(target.inspiration_image_urls ?? []);
          setPalette(target.palette);
          setThemeId(target.theme_id);
          if (target.custom_homepage_html) {
            setGeneratedHtml(target.custom_homepage_html);
            setHasGenerated(true);
          }
        }
      } catch {}
    })();
  }, [userId, forceNew, targetStoreId]);

  // ── Brand basics ────────────────────────────────────────────────────
  const [storeName, setStoreName] = useState("");
  const [storeSlug, setStoreSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"unchecked" | "available" | "taken" | "checking" | "invalid">("unchecked");
  const [tagline, setTagline] = useState("");
  const [about, setAbout] = useState("");

  useEffect(() => {
    if (existingCreator || slugManuallyEdited) return;
    setStoreSlug(slugify(storeName));
  }, [storeName, slugManuallyEdited, existingCreator]);

  useEffect(() => {
    if (existingCreator) {
      setSlugStatus("available"); // existing creator owns this slug
      return;
    }
    if (!storeSlug || !isSupabaseConfigured()) return setSlugStatus("unchecked");
    if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(storeSlug)) return setSlugStatus("invalid");
    setSlugStatus("checking");
    const t = setTimeout(async () => {
      try {
        const ok = await isSlugAvailable(storeSlug);
        setSlugStatus(ok ? "available" : "taken");
      } catch { setSlugStatus("unchecked"); }
    }, 400);
    return () => clearTimeout(t);
  }, [storeSlug, existingCreator]);

  // ── Design brief + references + inspirations ───────────────────────
  const [designBrief, setDesignBrief] = useState("");
  const [referenceUrls, setReferenceUrls] = useState<string[]>([]);
  const [referenceInput, setReferenceInput] = useState("");
  const [inspirationImages, setInspirationImages] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Optional theme + palette seed ───────────────────────────────────
  // null = "let Claude pick from the brief". Setting this only happens when
  // the creator explicitly clicks a quick-start tile. Otherwise we don't
  // pass any palette hint and Claude decides based on the brief alone.
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [themesCollapsed, setThemesCollapsed] = useState(true);

  // ── Generation state ────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [generationSummary, setGenerationSummary] = useState<string | null>(null);
  const [designNotes, setDesignNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Live elapsed counter while generating
  useEffect(() => {
    if (!generating || !generationStartedAt) return;
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - generationStartedAt) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [generating, generationStartedAt]);

  // Track auto-photo generation progress separately (runs in parallel
  // with Claude). When it finishes first, the preview re-renders with
  // real photos.
  const [photoStatus, setPhotoStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [photoUrlsByProductId, setPhotoUrlsByProductId] = useState<Record<string, string>>({});
  const [galleryByProductId, setGalleryByProductId] = useState<Record<string, string[]>>({});
  const [videoStatus, setVideoStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [videoUrlByProductId, setVideoUrlByProductId] = useState<Record<string, string>>({});

  // Mesh-snapshot queue: render each product's GLB to a PNG so photos/
  // videos depict the actual 3D piece, not a Hunyuan re-imagination.
  type SnapJob = { id: string; meshUrl: string; resolve: (url: string) => void; reject: (e: string) => void };
  const [snapQueue, setSnapQueue] = useState<SnapJob[]>([]);
  const [snapStatus, setSnapStatus] = useState<"idle" | "rendering" | "done">("idle");

  // Render meshes one at a time (browsers limit concurrent WebGL contexts).
  // Whenever the queue head changes, mount the snapshotter for it.
  const currentSnapJob = snapQueue[0] ?? null;

  function snapshotMesh(id: string, meshUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      setSnapQueue((q) => [...q, { id, meshUrl, resolve, reject }]);
    });
  }

  async function handleSnapshotComplete(dataUrl: string) {
    const job = snapQueue[0];
    if (!job) return;
    try {
      const uploaded = await uploadProductImageDataUrl(dataUrl, `mesh-${job.id}`);
      job.resolve(uploaded.url);
    } catch (e) {
      job.reject(e instanceof Error ? e.message : String(e));
    } finally {
      setSnapQueue((q) => q.slice(1));
    }
  }
  function handleSnapshotError(msg: string) {
    const job = snapQueue[0];
    if (job) {
      job.reject(msg);
      setSnapQueue((q) => q.slice(1));
    }
  }

  // ── Chat (iteration) ─────────────────────────────────────────────────
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  // ── Publish state ────────────────────────────────────────────────────
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // ── Live preview ─────────────────────────────────────────────────────
  // Resolved HTML with placeholders substituted (products, store_name, etc).
  const [previewProducts, setPreviewProducts] = useState<Awaited<ReturnType<typeof getProductsByCreator>>>([]);
  useEffect(() => {
    if (!existingCreator) return;
    getProductsByCreator(existingCreator.id).then(setPreviewProducts).catch(() => {});
  }, [existingCreator]);

  const previewHtml = useMemo(() => {
    if (!generatedHtml) return null;
    // Layer in auto-generated photos: a product gets the auto-photo if it
    // doesn't already have a hero set. This way the preview shows real
    // photos as soon as gpt-image-1 finishes (parallel to Claude).
    const productsForPreview =
      previewProducts.length > 0
        ? previewProducts.map((p) => ({
            ...p,
            hero_image_url: p.hero_image_url ?? photoUrlsByProductId[p.id] ?? null,
          }))
        : checkoutSession
          ? [{
              id: "preview",
              slug: "preview",
              title: checkoutSession.proposedTitle ?? "Your piece",
              price_cents: Math.round((checkoutSession.proposedPriceUsd ?? 0) * 100),
              currency: "USD",
              hero_image_url: photoUrlsByProductId["preview"] ?? null,
              description: checkoutSession.proposedDescription ?? null,
            }]
          : [];
    return renderStorefrontHtml(generatedHtml, {
      store_name: storeName,
      tagline,
      about,
      logo_url: existingCreator?.logo_url ?? "",
      products: renderProductGridHtml(productsForPreview, storeSlug || "preview"),
    });
  }, [generatedHtml, storeName, tagline, about, existingCreator?.logo_url, previewProducts, checkoutSession, storeSlug, photoUrlsByProductId]);

  // ── Handlers ─────────────────────────────────────────────────────────
  async function handleAddReference() {
    const u = referenceInput.trim();
    if (!u) return;
    // Permissive URL validation — accept anything that looks URL-ish.
    if (!/^https?:\/\//i.test(u) && !/^www\./i.test(u)) {
      setError("References should look like a URL (e.g. https://hem.com).");
      return;
    }
    setError(null);
    setReferenceUrls((prev) => [...prev.slice(0, 7), u]);
    setReferenceInput("");
  }

  async function handleImageUpload(file: File) {
    if (!file.type.startsWith("image/")) return;
    setUploadingImage(true);
    try {
      const result = await uploadProductImage(file); // reuse — same endpoint
      setInspirationImages((prev) => [...prev.slice(0, 5), result.url]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleGenerate(userMessageForIteration?: string) {
    if (!storeName.trim()) {
      setError("Add a store name first — Claude needs it to brand the design.");
      return;
    }
    setError(null);
    setGenerating(true);
    setGenerationStartedAt(Date.now());
    setElapsedSec(0);

    // Identify products that need auto-generated photos. Only the first
    // pass triggers this; subsequent iterations reuse existing photos.
    type PhotoTarget = {
      id: string;
      title: string;
      description?: string;
      category?: string;
      material?: string;
      style: "lifestyle";
      sourceImageUrl?: string;
      meshUrl?: string; // GLB to snapshot for higher fidelity
    };
    const photoTargets: PhotoTarget[] = [];
    if (!userMessageForIteration) {
      for (const p of previewProducts) {
        if (p.hero_image_url || photoUrlsByProductId[p.id]) continue;
        photoTargets.push({
          id: p.id,
          title: p.title,
          description: p.description ?? undefined,
          category: p.spec_json?.category,
          material: p.spec_json?.primary_material,
          style: "lifestyle",
          sourceImageUrl: p.source_image_url ?? undefined,
          meshUrl: p.mesh_url, // ⭐ render this to a PNG; use as source
        });
      }
      if (previewProducts.length === 0 && checkoutSession && !photoUrlsByProductId["preview"]) {
        photoTargets.push({
          id: "preview",
          title: checkoutSession.proposedTitle ?? "Untitled",
          description: checkoutSession.proposedDescription ?? undefined,
          category: checkoutSession.spec.category,
          material: checkoutSession.spec.primary_material,
          style: "lifestyle",
          sourceImageUrl: checkoutSession.sourceImageUrl,
          meshUrl: checkoutSession.meshUrl, // ⭐
        });
      }
    }

    // ⭐ MESH SNAPSHOT PASS — render the actual GLB for each target and
    //    replace sourceImageUrl with the snapshot. This is what makes the
    //    downstream photos + videos depict the ACTUAL piece, not an AI
    //    re-interpretation of it.
    if (photoTargets.length > 0) {
      setSnapStatus("rendering");
      for (const t of photoTargets) {
        if (!t.meshUrl) continue;
        try {
          const snappedUrl = await snapshotMesh(t.id, t.meshUrl);
          t.sourceImageUrl = snappedUrl;
          console.log(`[ariadne] mesh snapshot: ${t.title} → ${snappedUrl}`);
        } catch (e) {
          console.warn(`[ariadne] mesh snapshot failed for ${t.title}, falling back to Hunyuan source:`, e);
          // Keep existing sourceImageUrl as fallback
        }
      }
      setSnapStatus("done");
    }

    // ⭐ MEDIA MUST BE READY BEFORE CLAUDE DESIGNS.
    // Previously we kicked off photos/videos in parallel with the design
    // call → Claude never had the URLs → no video in the site, generic
    // placeholders, etc. Now we AWAIT both, capture URLs locally, and
    // pass them into the design call.
    const localPhotoUrls: Record<string, string> = { ...photoUrlsByProductId };
    const localGalleryUrls: Record<string, string[]> = { ...galleryByProductId };
    const localVideoUrls: Record<string, string> = { ...videoUrlByProductId };

    if (photoTargets.length > 0) {
      setPhotoStatus("generating");
      setVideoStatus("generating");
      const videoTargets = photoTargets.filter((t) => t.sourceImageUrl);
      try {
        // Run photo + video in parallel — they hit different APIs (OpenAI vs Fal),
        // so they don't compete. Photos: ~60–90s. Videos: ~120–180s. Total
        // wall time = max of the two ≈ 2–3 min for a small store.
        const [photoRes, videoRes] = await Promise.all([
          autoGenerateProductGalleries(photoTargets),
          videoTargets.length > 0
            ? autoGenerateProductVideos(
                videoTargets.map((t) => ({
                  id: t.id,
                  title: t.title,
                  sourceImageUrl: t.sourceImageUrl!,
                  category: t.category,
                  material: t.material,
                }))
              )
            : Promise.resolve({ results: {} as Record<string, { url: string }>, elapsed_ms: 0 }),
        ]);
        for (const [id, r] of Object.entries(photoRes.results)) {
          if (r.hero) localPhotoUrls[id] = r.hero;
          if (r.gallery && r.gallery.length > 0) localGalleryUrls[id] = r.gallery;
        }
        for (const [id, r] of Object.entries(videoRes.results)) {
          if (r.url) localVideoUrls[id] = r.url;
        }
        setPhotoUrlsByProductId(localPhotoUrls);
        setGalleryByProductId(localGalleryUrls);
        setVideoUrlByProductId(localVideoUrls);
        setPhotoStatus("done");
        setVideoStatus("done");
      } catch (e) {
        console.error("[ariadne] media gen failed:", e);
        setPhotoStatus("error");
        setVideoStatus("error");
        // Continue to design call anyway — partial media is better than none
      }
    }

    try {
      const result = await designStorefrontApi({
        storeBasics: {
          storeName: storeName.trim(),
          tagline: tagline.trim() || undefined,
          about: about.trim() || undefined,
          // Only send a palette hint when the creator explicitly picked
          // one. Otherwise Claude derives the palette from the brief +
          // references — much better variety per brief.
          paletteHint: palette ?? undefined,
        },
        designBrief: designBrief.trim() || undefined,
        referenceUrls,
        inspirationImages,
        // Use LOCAL URLs (not state) — state setters haven't re-rendered yet
        // by the time this synchronous code runs, so reading from state
        // would miss the URLs we just generated.
        products: previewProducts.length > 0
          ? previewProducts.map((p) => ({
              title: p.title,
              price_cents: p.price_cents,
              spec_json: p.spec_json,
              hero_image_url: localPhotoUrls[p.id] ?? p.hero_image_url ?? undefined,
              hero_video_url: localVideoUrls[p.id] ?? p.hero_video_url ?? undefined,
            }))
          : checkoutSession
            ? [{
                title: checkoutSession.proposedTitle ?? "Untitled",
                price_cents: Math.round((checkoutSession.proposedPriceUsd ?? 0) * 100),
                spec_json: {
                  category: checkoutSession.spec.category,
                  primary_material: checkoutSession.spec.primary_material,
                },
                hero_image_url: localPhotoUrls["preview"] ?? undefined,
                hero_video_url: localVideoUrls["preview"] ?? undefined,
              }]
            : [],
        priorHtml: userMessageForIteration ? generatedHtml : null,
        userMessage: userMessageForIteration ?? null,
        chatHistory: userMessageForIteration
          ? chat.map((m) => ({ role: m.role, content: m.content }))
          : [],
      });
      setGeneratedHtml(result.html);
      setGenerationSummary(result.summary);
      setDesignNotes(result.design_notes);
      setHasGenerated(true);
      if (userMessageForIteration) {
        setChat((prev) => [
          ...prev,
          { role: "user", content: userMessageForIteration },
          { role: "assistant", content: result.summary, html: result.html },
        ]);
        setChatInput("");
      } else {
        setChat([
          { role: "assistant", content: result.summary, html: result.html },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
      setGenerationStartedAt(null);
    }
  }

  async function handlePublish() {
    if (!generatedHtml) return;
    if (!isSupabaseConfigured()) {
      setPublishError("Supabase not configured.");
      return;
    }
    if (!userId) {
      setPublishError("Not signed in.");
      return;
    }
    setPublishing(true);
    setPublishError(null);
    try {
      let creator = existingCreator;
      if (!creator) {
        if (slugStatus !== "available") {
          throw new Error("Store URL isn't available — pick another.");
        }
        // When palette/theme weren't explicitly picked, fall back to a
        // neutral light default for the DB row. The actual storefront
        // rendering uses the custom HTML's :root, so this only matters
        // for the style-editor seed values.
        const effectiveTheme = themeId ?? "warm-paper";
        const effectivePalette = palette ?? themeById(effectiveTheme).palette;
        creator = await createCreator({
          user_id: userId,
          store_slug: storeSlug,
          store_name: storeName.trim(),
          tagline: tagline.trim() || undefined,
          about: about.trim() || undefined,
          theme_id: effectiveTheme,
          palette: effectivePalette,
          typography: themeById(effectiveTheme).typography,
        });
      }
      const effectiveTheme2 = themeId ?? creator.theme_id;
      const effectivePalette2 = palette ?? creator.palette;
      const updated = await updateCreator(creator.id, {
        store_name: storeName.trim(),
        tagline: tagline.trim() || null,
        about: about.trim() || null,
        design_brief: designBrief.trim() || null,
        reference_urls: referenceUrls,
        inspiration_image_urls: inspirationImages,
        custom_homepage_html: generatedHtml,
        palette: effectivePalette2,
        theme_id: effectiveTheme2,
        design_iteration_count: (creator.design_iteration_count ?? 0) + 1,
        last_designed_at: new Date().toISOString(),
      });
      // Mark this creator as the active store so subsequent pages (Dashboard,
      // Settings, AddProduct) open it by default.
      setActiveStoreId(updated.id);
      // Persist auto-generated photos + galleries + videos. The union of
      // all product IDs that got any media this session.
      const allProductIds = new Set([
        ...Object.keys(photoUrlsByProductId),
        ...Object.keys(galleryByProductId),
        ...Object.keys(videoUrlByProductId),
      ]);
      for (const productId of allProductIds) {
        if (productId === "preview") continue;
        const patch: Record<string, unknown> = {};
        if (photoUrlsByProductId[productId]) patch.hero_image_url = photoUrlsByProductId[productId];
        if (galleryByProductId[productId]) patch.gallery_urls = galleryByProductId[productId];
        if (videoUrlByProductId[productId]) patch.hero_video_url = videoUrlByProductId[productId];
        if (Object.keys(patch).length === 0) continue;
        try {
          await updateProduct(productId, patch);
        } catch (e) {
          console.warn("Failed to save media for product", productId, e);
        }
      }

      // First-time publish from the post-CAD flow: promote the pending product.
      if (!existingCreator && checkoutSession) {
        const productSlug = slugify(
          checkoutSession.proposedTitle ?? `${checkoutSession.spec.category}-${checkoutSession.modelId.slice(-6)}`
        ) || `piece-${checkoutSession.modelId.slice(-6)}`;
        await createProduct({
          creator_id: updated.id,
          slug: productSlug,
          title: checkoutSession.proposedTitle ?? `${checkoutSession.spec.category} piece`,
          description: checkoutSession.proposedDescription ?? undefined,
          price_cents: Math.round((checkoutSession.proposedPriceUsd ?? 0) * 100),
          currency: "USD",
          mesh_url: checkoutSession.meshUrl,
          cad_zip_url: checkoutSession.cadZipUrl,
          spec_json: checkoutSession.spec,
          cad_summary_json: checkoutSession.cadSummary,
          // Auto-generated hero + gallery + video from this session, if any landed.
          hero_image_url: photoUrlsByProductId["preview"] ?? undefined,
          gallery_urls: galleryByProductId["preview"] ?? [],
          hero_video_url: videoUrlByProductId["preview"] ?? undefined,
          source_image_url: checkoutSession.sourceImageUrl,
        });
        clearCheckoutSession();
      }
      navigate(`/shop/${updated.store_slug}`);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }

  const canGenerate = storeName.trim().length >= 2 && !generating;

  return (
    <main className="designer-page">
      {/* ── LEFT: controls ─────────────────────────────────────────── */}
      <aside className="designer-controls">
        <div className="designer-controls-scroll">
          <header className="designer-controls-header">
            <h1>{existingCreator ? "Redesign your store" : "Design your store"}</h1>
            <p>
              {existingCreator
                ? `Iterate on ${existingCreator.store_name}.`
                : "Like Lovable, but for furniture stores. Describe what you want, drop references, generate."}
            </p>
          </header>

          {/* Brand basics — collapsible after first generation */}
          <section className="designer-card">
            <h2>Brand</h2>
            <label className="flow-field">
              <span>Store name</span>
              <input value={storeName} onChange={(e) => setStoreName(e.target.value)} maxLength={60} placeholder="Hearthwood Studio" />
            </label>
            {!existingCreator && (
              <>
                <label className="flow-field">
                  <span>URL slug</span>
                  <div className="builder-slug-input">
                    <span className="builder-slug-prefix">ariadne.shop/</span>
                    <input value={storeSlug} onChange={(e) => { setStoreSlug(slugify(e.target.value)); setSlugManuallyEdited(true); }} maxLength={32} />
                  </div>
                  <span className={`builder-slug-status builder-slug-${slugStatus}`}>
                    {slugStatus === "available" && "✓ available"}
                    {slugStatus === "taken" && "✗ taken"}
                    {slugStatus === "checking" && "checking…"}
                    {slugStatus === "invalid" && "3–30 chars, a-z 0-9 -"}
                  </span>
                </label>
              </>
            )}
            <label className="flow-field">
              <span>Tagline</span>
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} placeholder="A short, evocative line." />
            </label>
            <label className="flow-field">
              <span>About</span>
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} maxLength={500} placeholder="Where you work. What you make. Who it's for." />
            </label>
          </section>

          {/* The MAIN input — design brief */}
          <section className="designer-card designer-card-primary">
            <h2>What do you want your store to feel like?</h2>
            <p className="flow-help">
              The more specific you are, the better. Talk about mood, materials,
              references, the kind of person you want browsing here.
            </p>
            <textarea
              className="designer-brief"
              value={designBrief}
              onChange={(e) => setDesignBrief(e.target.value)}
              rows={9}
              maxLength={3000}
              placeholder={`e.g. "Japanese minimalism meets Pacific Northwest woodshop. Lots of negative space, washi-paper backgrounds, photographs that look like they were taken in golden hour. The hero should be a single huge photo of one piece with the name set in a quiet serif beside it. The grid below should feel like a museum collection page — square images, lots of breathing room. No popups, no CTAs in your face. The mood is 'slow morning, single cup of coffee, you're not in a hurry to buy.'"`}
            />
          </section>

          {/* References */}
          <section className="designer-card">
            <h2>Sites you love</h2>
            <p className="flow-help">Paste URLs of stores or sites whose energy you want to channel. Up to 8.</p>
            <div className="designer-ref-input">
              <input
                value={referenceInput}
                onChange={(e) => setReferenceInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddReference(); } }}
                placeholder="https://hem.com"
              />
              <button onClick={handleAddReference} className="flow-btn flow-btn-ghost designer-ref-add">+ Add</button>
            </div>
            {referenceUrls.length > 0 && (
              <ul className="designer-ref-list">
                {referenceUrls.map((u, i) => (
                  <li key={i}>
                    <span className="designer-ref-url">{u}</span>
                    <button onClick={() => setReferenceUrls((prev) => prev.filter((_, j) => j !== i))}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Inspirations */}
          <section className="designer-card">
            <h2>Inspiration images</h2>
            <p className="flow-help">Photos that capture the mood. Claude will look at these. Up to 6.</p>
            <div className="designer-inspirations">
              {inspirationImages.map((url, i) => (
                <div key={i} className="designer-inspiration-thumb">
                  <img src={url} alt="" />
                  <button
                    onClick={() => setInspirationImages((prev) => prev.filter((_, j) => j !== i))}
                    className="designer-inspiration-remove"
                  >×</button>
                </div>
              ))}
              {inspirationImages.length < 6 && (
                <button
                  className="designer-inspiration-add"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                >
                  {uploadingImage ? "uploading…" : "+ image"}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImageUpload(f);
                  e.target.value = "";
                }}
              />
            </div>
          </section>

          {/* Optional theme seed */}
          <section className="designer-card">
            <button
              className="designer-toggle"
              onClick={() => setThemesCollapsed((v) => !v)}
            >
              {themesCollapsed ? "▸" : "▾"} Quick-start palette (optional — skip for best results)
            </button>
            {!themesCollapsed && (
              <div className="designer-themes">
                <p className="flow-help">
                  <strong>Recommended: leave blank.</strong> Claude picks the palette from your brief + references, which usually produces better variety. Only pick one if you have a specific look in mind that the brief alone can't communicate.
                </p>
                <div className="builder-theme-grid">
                  {themeId && (
                    <button
                      className="builder-theme-card"
                      onClick={() => { setThemeId(null); setPalette(null); }}
                      style={{ borderStyle: "dashed" }}
                    >
                      <div className="builder-theme-swatch" style={{ background: "transparent", border: "1px dashed rgba(255,247,230,0.30)" }}>
                        <span style={{ color: "rgba(255,247,230,0.55)", fontSize: 18 }}>none</span>
                      </div>
                      <div className="builder-theme-meta">
                        <strong>Let Claude pick</strong>
                      </div>
                    </button>
                  )}
                  {THEME_PRESETS.map((t) => (
                    <button
                      key={t.id}
                      className={`builder-theme-card ${themeId === t.id ? "is-active" : ""}`}
                      onClick={() => { setThemeId(t.id); setPalette(t.palette); }}
                    >
                      <div className="builder-theme-swatch" style={{ background: t.palette.primary, color: t.palette.text, borderColor: t.palette.accent }}>
                        <span style={{ color: t.palette.accent, fontSize: 22 }}>Aa</span>
                      </div>
                      <div className="builder-theme-meta">
                        <strong>{t.name}</strong>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Generate */}
          {error && <div className="flow-error designer-error">{error}</div>}
          <button
            className="flow-btn flow-btn-primary designer-generate-btn"
            onClick={() => handleGenerate()}
            disabled={!canGenerate}
          >
            {generating
              ? `Designing… ${elapsedSec}s`
              : hasGenerated ? "Regenerate from brief" : "Generate my store"}
          </button>

          {/* Chat iteration — only after first generation */}
          {hasGenerated && (
            <section className="designer-card designer-chat">
              <h2>Refine</h2>
              <p className="flow-help">Tell Claude what to change. "Make the hero photo bigger." "Use a warmer color palette." "Add a quote from a customer."</p>
              <div className="designer-chat-messages">
                {chat.map((m, i) => (
                  <div key={i} className={`designer-chat-msg designer-chat-msg-${m.role}`}>
                    <span className="designer-chat-role">{m.role}</span>
                    <span className="designer-chat-content">{m.content}</span>
                  </div>
                ))}
              </div>
              <div className="designer-chat-input">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  rows={2}
                  placeholder="What should change?"
                  disabled={generating}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && chatInput.trim()) {
                      e.preventDefault();
                      void handleGenerate(chatInput.trim());
                    }
                  }}
                />
                <button
                  className="flow-btn flow-btn-primary"
                  onClick={() => chatInput.trim() && handleGenerate(chatInput.trim())}
                  disabled={generating || !chatInput.trim()}
                >
                  {generating ? `${elapsedSec}s` : "Send"}
                </button>
              </div>
            </section>
          )}

          {/* Publish */}
          {hasGenerated && (
            <section className="designer-publish">
              {publishError && <div className="flow-error">{publishError}</div>}
              <button
                className="flow-btn flow-btn-primary designer-publish-btn"
                onClick={handlePublish}
                disabled={publishing || !generatedHtml}
              >
                {publishing ? "Publishing…" : existingCreator ? "Save & view live" : "Publish this store"}
              </button>
              <Link to="/app" className="designer-cancel">
                ‹ Cancel
              </Link>
            </section>
          )}
        </div>
      </aside>

      {/* ── RIGHT: live preview ──────────────────────────────────── */}
      <section className="designer-preview-pane">
        {!generatedHtml && !generating && (
          <div className="designer-preview-empty">
            <div>
              <h2>Live preview</h2>
              <p>
                Once you generate, your store appears here. You can iterate freely
                — every change re-renders inline.
              </p>
              <ul>
                <li>1. Name your store and write a brief</li>
                <li>2. Optional: paste references, drop inspiration photos</li>
                <li>3. Click "Generate my store"</li>
                <li>4. Refine via chat ("make the hero bigger")</li>
                <li>5. Publish when it feels right</li>
              </ul>
            </div>
          </div>
        )}
        {generating && (
          <div className="designer-preview-loading">
            <div className="designer-loading-spinner" />
            <div className="designer-loading-text">
              <h3>Building your store…</h3>
              <p>
                <span className="designer-elapsed">{elapsedSec}s</span>{" "}
                {snapStatus !== "done" ? "rendering meshes" :
                 photoStatus !== "done" || videoStatus !== "done" ? "generating photos + video" :
                 "Claude is designing the layout"}
              </p>
              <ol className="designer-loading-steps">
                <li className={snapStatus === "rendering" ? "is-active" : snapStatus === "done" ? "is-done" : ""}>
                  {snapStatus === "done" ? "✓" : "1."} Rendering your 3D pieces to studio snapshots
                </li>
                <li className={photoStatus === "generating" ? "is-active" : photoStatus === "done" ? "is-done" : ""}>
                  {photoStatus === "done" ? "✓" : "2."} Generating high-res photos of YOUR piece (3 per product)
                </li>
                <li className={videoStatus === "generating" ? "is-active" : videoStatus === "done" ? "is-done" : ""}>
                  {videoStatus === "done" ? "✓" : "3."} Filming a 10s cinematic video (Fal Seedance, ~2 min)
                </li>
                <li className={photoStatus === "done" && videoStatus === "done" ? "is-active" : ""}>
                  4. Claude designs the storefront with all media baked in
                </li>
              </ol>
              <p className="designer-loading-hint">
                Total: 3–6 min depending on store size. The wait is worth it — when this is done you'll have a complete site with cinematic video + premium photos.
              </p>
            </div>
          </div>
        )}
        {previewHtml && !generating && (
          <iframe
            className="designer-preview-frame"
            srcDoc={previewHtml}
            sandbox="allow-scripts allow-popups-to-escape-sandbox"
            title="Storefront preview"
          />
        )}
        {generationSummary && hasGenerated && !generating && (
          <div className="designer-preview-summary">
            <strong>{generationSummary}</strong>
            {designNotes.length > 0 && (
              <ul>
                {designNotes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Off-screen mesh snapshotter — mounts only when there's a mesh in
          the queue. Renders the GLB, snapshots, uploads, advances the
          queue. Each render takes ~1–2s. */}
      {currentSnapJob && (
        <MeshSnapshotter
          key={currentSnapJob.id}
          meshUrl={currentSnapJob.meshUrl}
          onSnapshot={handleSnapshotComplete}
          onError={handleSnapshotError}
        />
      )}
    </main>
  );
}
