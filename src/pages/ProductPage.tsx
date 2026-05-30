// Per-product page on a storefront. URL: /shop/:slug/:productSlug
//
// Shows the mesh in 3D, full description, price, and a "Purchase" button
// that runs the same mock-checkout flow as Phase 0 (one-time listing
// purchase becomes per-buyer purchase here). Real Stripe Connect ships
// in Phase 4.

import { Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import { Bounds, Environment, OrbitControls, useGLTF } from "@react-three/drei";
import {
  getCreatorBySlug,
  getProductBySlug,
  updateProduct,
} from "../lib/storeDb";
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
import { ProductImageManager } from "../components/ProductImageManager";

export function ProductPage() {
  const { slug, productSlug } = useParams<{ slug: string; productSlug: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "notfound">("loading");
  const [galleryIdx, setGalleryIdx] = useState(0);

  const isOwner = !!(creator && auth.session?.user?.id === creator.user_id);

  async function saveProductField<K extends keyof Product>(field: K, val: Product[K]) {
    if (!product) return;
    const updated = await updateProduct(product.id, { [field]: val } as Partial<Product>);
    setProduct(updated);
  }

  useEffect(() => {
    if (!slug || !productSlug) return;
    (async () => {
      try {
        const c = await getCreatorBySlug(slug);
        if (!c) {
          setLoad("notfound");
          return;
        }
        const p = await getProductBySlug(c.id, productSlug);
        if (!p) {
          setLoad("notfound");
          return;
        }
        setCreator(c);
        setProduct(p);
        setLoad("ready");
        track(slug, "product_view", p.id);
      } catch {
        setLoad("notfound");
      }
    })();
  }, [slug, productSlug]);

  if (load === "loading") {
    return <main className="store-page store-loading">Loading…</main>;
  }
  if (load === "notfound" || !creator || !product) {
    return (
      <main className="store-page store-notfound">
        <div>
          <h1>Piece not found</h1>
          <Link to={`/shop/${slug ?? ""}`}>← Back to store</Link>
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

  function handleBuy() {
    if (!product || !creator) return;
    navigate(`/shop/${creator.store_slug}/${product.slug}/checkout`);
  }

  return (
    <main className="store-page product-page" style={themeStyles}>
      <Link to={`/shop/${creator.store_slug}`} className="store-back-link">
        ← {creator.store_name}
      </Link>

      {/* Scroll-scrubbed video hero — if the product has one, we show it
          full-bleed above the layout. Scrolling drives the video's
          currentTime via the WISA pattern (video.seeking guard included). */}
      {product.hero_video_url && (
        <ScrollScrubHero videoUrl={product.hero_video_url} title={product.title} />
      )}

      <div className="product-layout">
        <section className="product-mesh-pane">
          {(() => {
            // Build the visible gallery: hero + gallery_urls (deduped). If
            // empty, fall back to the 3D mesh viewer.
            const allImages = Array.from(
              new Set(
                [product.hero_image_url, ...(product.gallery_urls ?? [])].filter(
                  (u): u is string => !!u
                )
              )
            );
            if (allImages.length === 0) {
              return (
                <Canvas camera={{ position: [2.4, 1.8, 2.6], fov: 35 }} dpr={[1, 2]}>
                  <ambientLight intensity={0.5} />
                  <directionalLight position={[5, 10, 5]} intensity={1.0} />
                  <Suspense fallback={null}>
                    <Bounds fit clip observe margin={1.2}>
                      <MeshFromUrl url={product.mesh_url} />
                    </Bounds>
                    <Environment preset={theme.id === "studio-white" ? "city" : "studio"} />
                  </Suspense>
                  <OrbitControls makeDefault enablePan={false} minDistance={1.2} maxDistance={6} />
                </Canvas>
              );
            }
            const safeIdx = Math.min(galleryIdx, allImages.length - 1);
            return (
              <>
                <img
                  src={allImages[safeIdx]}
                  alt={product.title}
                  className="product-hero-image"
                />
                {allImages.length > 1 && (
                  <div className="product-gallery-thumbs">
                    {allImages.map((url, i) => (
                      <button
                        key={url}
                        className={`product-gallery-thumb ${i === safeIdx ? "is-active" : ""}`}
                        onClick={() => setGalleryIdx(i)}
                        aria-label={`Photo ${i + 1}`}
                      >
                        <img src={url} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </section>

        <section className="product-info-pane">
          <InlineEditable
            as="h1"
            className="product-title"
            value={product.title}
            editable={isOwner}
            maxLength={100}
            onSave={(v) => saveProductField("title", v)}
          />
          <div className="product-price">
            {isOwner ? (
              <InlineEditable
                value={String((product.price_cents / 100).toFixed(0))}
                editable
                onSave={async (v) => {
                  const n = Math.max(1, Math.round(Number(v) || 0));
                  await saveProductField("price_cents", n * 100);
                }}
              />
            ) : (
              formatPrice(product.price_cents, product.currency)
            )}
          </div>
          <InlineEditable
            as="p"
            className="product-description"
            value={product.description ?? ""}
            editable={isOwner}
            multiline
            placeholder={isOwner ? "Describe this piece…" : ""}
            maxLength={1000}
            onSave={(v) => saveProductField("description", v || null)}
          />

          {isOwner && (
            <ProductImageManager
              product={product}
              onChange={async (newUrl) => {
                await saveProductField("hero_image_url", newUrl);
              }}
            />
          )}

          {!isOwner && (
            <button className="product-buy-btn" onClick={handleBuy}>
              Purchase →
            </button>
          )}

          <div className="product-specs">
            <h3>Specifications</h3>
            <dl>
              <dt>Category</dt>
              <dd>{product.spec_json.category}</dd>
              <dt>Primary material</dt>
              <dd>{product.spec_json.primary_material}</dd>
              <dt>Dimensions</dt>
              <dd>
                {product.spec_json.overall.width_mm} × {product.spec_json.overall.depth_mm} ×{" "}
                {product.spec_json.overall.height_mm} mm
              </dd>
            </dl>
            {product.cad_summary_json && (
              <p className="product-cad-note">
                Includes manufacturing CAD bundle ({product.cad_summary_json.part_count}{" "}
                parts, STEP + DXF + cutlist).
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function MeshFromUrl({ url }: { url: string }) {
  const gltf = useGLTF(url);
  return <primitive object={gltf.scene} />;
}

/**
 * Scroll-scrubbed video hero (WISA pattern). The video doesn't autoplay;
 * scroll position drives currentTime, so scrolling reveals the piece in
 * motion. Critical detail: the `video.seeking` guard prevents frame
 * tearing during rapid scroll. Without it, queued .currentTime updates
 * cause visible flicker.
 */
function ScrollScrubHero({ videoUrl, title }: { videoUrl: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onCanPlay = () => setLoaded(true);
    v.addEventListener("canplaythrough", onCanPlay);
    v.load();
    return () => v.removeEventListener("canplaythrough", onCanPlay);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const v = videoRef.current;
    if (!v || !v.duration) return;

    function onScroll() {
      // CRITICAL: skip while the browser is still seeking — otherwise queued
      // currentTime assignments cause frame tearing during fast scroll.
      if (!v || v.seeking || !endRef.current) return;
      const rect = endRef.current.getBoundingClientRect();
      const absoluteTop = window.scrollY + rect.top;
      const stopScroll = Math.max(1, absoluteTop - window.innerHeight * 0.2);
      const fraction = Math.max(0, Math.min(1, window.scrollY / stopScroll));
      v.currentTime = fraction * v.duration;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [loaded]);

  return (
    <>
      <div className="product-scrub-hero">
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="auto"
          className="product-scrub-hero-video"
        />
        <div className="product-scrub-hero-overlay" />
        <div className="product-scrub-hero-text">
          <span className="product-scrub-hero-eyebrow">Now showing</span>
          <h2 className="product-scrub-hero-title">{title}</h2>
          <p className="product-scrub-hero-hint">Scroll to play ↓</p>
        </div>
      </div>
      {/* Scroll-end anchor: when this enters the top of the viewport, the
          video has reached its final frame. */}
      <div ref={endRef} aria-hidden="true" />
    </>
  );
}
