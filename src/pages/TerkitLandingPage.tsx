// Terkit AI — public waitlist landing page.
//
// Direct adaptation of the WISA scroll-driven-video pattern. The page is
// layered:
//   1. Fixed full-viewport video behind everything (z-index 0)
//   2. Fixed header on top (z-index 20) — slides out after the user scrolls
//   3. Scrollable content sections layered above the video (z-index 10)
//
// As the user scrolls, video.currentTime is driven by scroll position
// (the WISA seeking-guard pattern). When the footer card hits 20% of the
// viewport from the top, the video has reached its final frame.
//
// One CTA only: "Join the waitlist". The form lives in the footer card;
// the top button anchors to it.

import { useCallback, useEffect, useRef, useState } from "react";
import { joinWaitlist } from "../lib/waitlist";

const VIDEO_URL = "/terkit-hero.mp4";

export function TerkitLandingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  // Email form state
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState<string>("");

  // ── 1) Wait for the video to be ready before scrubbing ──────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onReady = () => setVideoReady(true);
    v.addEventListener("canplaythrough", onReady);
    v.load();
    return () => v.removeEventListener("canplaythrough", onReady);
  }, []);

  // ── 2) Drive video.currentTime from scroll position (WISA pattern) ─
  useEffect(() => {
    if (!videoReady) return;
    const v = videoRef.current;
    if (!v || !v.duration) return;

    function onScroll() {
      // CRITICAL: skip while the browser is still seeking — otherwise
      // queued .currentTime assignments produce frame tearing.
      if (!v || v.seeking || !footerRef.current) return;
      const rect = footerRef.current.getBoundingClientRect();
      const absoluteTop = window.scrollY + rect.top;
      // The video reaches its final frame when the footer is still a full
      // viewport BELOW the current scroll position. This gives the user
      // breathing room to look at the final frame before the footer card
      // slides up into view as they continue scrolling.
      // Video reaches its final frame when the footer is still ~2 viewports
      // below the current scroll position. That gives the user enough scroll
      // runway through the "Everything" + "Reasons" sections to view + read
      // them with the final video frame frozen behind, before the footer
      // card slides up.
      const stopScroll = Math.max(1, absoluteTop - window.innerHeight * 2.0);
      const fraction = Math.max(0, Math.min(1, window.scrollY / stopScroll));
      v.currentTime = fraction * v.duration;

      // Header slides up + fades as the user moves past the hero.
      if (headerRef.current) {
        const y = Math.min(150, Math.max(0, window.scrollY - 400) * 0.6);
        const op = Math.max(0, 1 - Math.max(0, window.scrollY - 600) / 200);
        headerRef.current.style.transform = `translate(-50%, -${y}px)`;
        headerRef.current.style.opacity = String(op);
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [videoReady]);

  // ── Scroll the page to the waitlist form ────────────────────────────
  const scrollToWaitlist = useCallback(() => {
    footerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // ── Submit handler ──────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("submitting");
    setStatusMsg("");
    const result = await joinWaitlist(email);
    if (!result.ok) {
      setStatus("error");
      setStatusMsg(result.error ?? "Something went wrong.");
      return;
    }
    setStatus("done");
    setStatusMsg(result.alreadyOnList ? "You're already on the list. We'll be in touch." : "You're in. Look for an email soon.");
    setEmail("");
  }

  return (
    <main className="tk-page">
      {/* ─────────── Loading screen ─────────── */}
      {!videoReady && (
        <div className="tk-loading">
          <span className="tk-loading-label">LOADING</span>
          <div className="tk-loading-bar">
            <div className="tk-loading-fill" />
          </div>
        </div>
      )}

      {/* ─────────── Fixed video background (z 0) ─────────── */}
      <div className="tk-video-wrap">
        <video
          ref={videoRef}
          src={VIDEO_URL}
          muted
          playsInline
          preload="auto"
          className="tk-video"
        />
        <div className="tk-video-grad" />
      </div>

      {/* ─────────── Fixed header (z 20) ─────────── */}
      <header ref={headerRef} className="tk-header">
        <a href="#top" className="tk-wordmark" aria-label="Terkit AI home">
          <svg viewBox="0 0 90 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Simple geometric TERKIT AI wordmark — five paths */}
            <text
              x="0"
              y="14"
              fontFamily="Manrope, sans-serif"
              fontWeight="700"
              fontSize="15"
              letterSpacing="0.04em"
              fill="white"
            >
              TERKIT
            </text>
            <text
              x="60"
              y="14"
              fontFamily="JetBrains Mono, monospace"
              fontWeight="500"
              fontSize="11"
              letterSpacing="0.06em"
              fill="rgba(255,255,255,0.65)"
            >
              AI
            </text>
          </svg>
        </a>

        <button onClick={scrollToWaitlist} className="tk-cta-pill">
          <span>Join the waitlist</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </header>

      {/* ─────────── Scrollable content (z 10) ─────────── */}
      <div className="tk-scroll" id="top">
        {/* HERO */}
        <section className="tk-hero">
          <div className="tk-hero-bottom">
            <h1 className="tk-headline">
              Turn your idea
              <br />
              into a real
              <br />
              business.
            </h1>
          </div>
          <div className="tk-hero-aside">
            <p>
              You bring the idea. We design the product, make it, ship it, and run the store.{" "}
              <strong>The easiest way to start selling something you imagined.</strong>
            </p>
            <button onClick={scrollToWaitlist} className="tk-cta-double">
              <span className="tk-cta-text">JOIN THE WAITLIST</span>
              <span className="tk-cta-arrow">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          </div>
        </section>

        {/* SPACER (lets the video advance between sections) */}
        <div className="tk-spacer" />

        {/* MIDDLE — scroll-reveal copy + 3 columns */}
        <section className="tk-middle">
          <p className="tk-bigprose">
            From a sketch on a napkin to a real product in a real store with real customers.
            We handle the design, the manufacturing, the site, the payments — everything.
            You just have to want to start.
          </p>
          <div className="tk-cols">
            <div className="tk-col">
              <span className="tk-coltag">01 — START WITH AN IDEA</span>
              <h3>Drawing. Prompt. Photo.</h3>
              <p>
                Sketch it on a napkin, type a description, or drop a photo of
                something you wish existed. Anything works — just tell us what you want to make.
              </p>
            </div>
            <div className="tk-col">
              <span className="tk-coltag">02 — WATCH IT BECOME REAL</span>
              <h3>We make the product.</h3>
              <p>
                We turn your idea into a real 3D product and team up with our manufacturer
                partners to actually build it. You see it come to life and approve every step.
              </p>
            </div>
            <div className="tk-col">
              <span className="tk-coltag">03 — START SELLING</span>
              <h3>We run the whole business.</h3>
              <p>
                We build your storefront, take payments, handle shipping, manage your
                customers, and track your sales. Your business is ready. You just sell.
              </p>
            </div>
          </div>
        </section>

        {/* Spacer so the video can settle into its final frame BEFORE
            the "everything" section starts overlapping. */}
        <div className="tk-spacer" />

        {/* EVERYTHING — what we handle, presented over the final video frame */}
        <section className="tk-everything">
          <div className="tk-everything-header">
            <span className="tk-everything-eyebrow">WHAT YOU GET</span>
            <h2 className="tk-everything-headline">
              Everything you'd normally
              <br />
              need a team for.
              <br />
              <em>We do it.</em>
            </h2>
            <p className="tk-everything-sub">
              You'd usually need a designer, a manufacturer, a developer, an accountant,
              a marketer, and a warehouse to start selling something. Or you could just
              tell us your idea.
            </p>
          </div>

          <div className="tk-everything-grid">
            <div className="tk-everything-cell">
              <span className="tk-everything-num">01</span>
              <strong>Design</strong>
              <p>We turn your sketch, prompt, or photo into a real product. You approve every angle.</p>
            </div>
            <div className="tk-everything-cell">
              <span className="tk-everything-num">02</span>
              <strong>Manufacturing</strong>
              <p>We match your product with a trusted maker. No factory hunting. No minimums you can't meet.</p>
            </div>
            <div className="tk-everything-cell">
              <span className="tk-everything-num">03</span>
              <strong>Quality</strong>
              <p>Every batch goes through inspection before it ships. You never see a bad product reach your customer.</p>
            </div>
            <div className="tk-everything-cell">
              <span className="tk-everything-num">04</span>
              <strong>Shipping</strong>
              <p>Door-to-door logistics handled. Storage, packing, tracking — all taken care of.</p>
            </div>
            <div className="tk-everything-cell">
              <span className="tk-everything-num">05</span>
              <strong>Storefront</strong>
              <p>Your own beautifully-designed store, with your brand, on your domain. Built in minutes.</p>
            </div>
            <div className="tk-everything-cell">
              <span className="tk-everything-num">06</span>
              <strong>Payments</strong>
              <p>Customers check out, you get paid. We handle the gateway, the fees, the chargebacks.</p>
            </div>
            <div className="tk-everything-cell">
              <span className="tk-everything-num">07</span>
              <strong>Marketing</strong>
              <p>SEO, social, email, ads — set up and running from day one. We even write the copy.</p>
            </div>
            <div className="tk-everything-cell">
              <span className="tk-everything-num">08</span>
              <strong>Analytics</strong>
              <p>Live dashboard of sales, visitors, where they're from, what they look at, what they buy.</p>
            </div>
            <div className="tk-everything-cell">
              <span className="tk-everything-num">09</span>
              <strong>Support</strong>
              <p>Customer emails answered, returns processed, questions handled. You stay focused on the next idea.</p>
            </div>
          </div>

          <div className="tk-everything-close">
            <p>You bring the idea. We bring the business.</p>
          </div>
        </section>

        {/* Why be early — quiet reasons strip before the form */}
        <section className="tk-reasons">
          <div className="tk-reasons-headline">
            <span className="tk-everything-eyebrow">WHY GET IN EARLY</span>
            <h3>You're early. That means a few real perks.</h3>
          </div>
          <div className="tk-reasons-grid">
            <div className="tk-reason">
              <strong>Founder pricing</strong>
              <p>Our lowest fees, locked in for as long as you're on the platform.</p>
            </div>
            <div className="tk-reason">
              <strong>Direct line to the team</strong>
              <p>You get a real human, not a help-desk ticket. Tell us what's missing, we'll build it.</p>
            </div>
            <div className="tk-reason">
              <strong>First in line</strong>
              <p>First access to new manufacturer partners, new product categories, new tooling.</p>
            </div>
            <div className="tk-reason">
              <strong>Shape the platform</strong>
              <p>Early users vote on what we build next. Your feedback literally moves the roadmap.</p>
            </div>
          </div>
        </section>

        {/* Small breathing room before the footer slides up */}
        <div className="tk-spacer" />

        {/* FOOTER — the waitlist form lives here (scroll-end anchor) */}
        <section className="tk-foot-wrap" ref={footerRef}>
          <div className="tk-foot-card">
            <div className="tk-foot-top">
              <div className="tk-foot-headline">
                <h2>
                  Be one
                  <br />
                  of the first.
                </h2>
                <p>
                  We're opening early access in waves. Drop your email and we'll let
                  you know the moment it's your turn to start building.
                </p>
              </div>

              <form className="tk-foot-form" onSubmit={handleSubmit}>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@yourstudio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === "submitting" || status === "done"}
                  className="tk-foot-input"
                />
                <button
                  type="submit"
                  className="tk-foot-submit"
                  disabled={status === "submitting" || status === "done"}
                >
                  {status === "submitting" ? "Adding…" : status === "done" ? "✓ On the list" : "Join the waitlist"}
                  {status === "idle" && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
                {statusMsg && (
                  <p className={`tk-foot-msg ${status === "error" ? "is-error" : "is-ok"}`}>{statusMsg}</p>
                )}
              </form>
            </div>

            <div className="tk-foot-bottom">
              <div className="tk-foot-brand">
                <strong>TERKIT AI</strong>
                <span>Turn your idea into a real business.</span>
              </div>
              <div className="tk-foot-links">
                <span className="tk-foot-coltag">COMPANY</span>
                <a href="#top">Home</a>
                <a href="/shop">Marketplace</a>
              </div>
              <div className="tk-foot-links">
                <span className="tk-foot-coltag">PRODUCT</span>
                <a href="/app">Open the editor</a>
                <a href="#top">How it works</a>
              </div>
              <div className="tk-foot-links">
                <span className="tk-foot-coltag">LEGAL</span>
                <a href="#top">Privacy</a>
                <a href="#top">Terms</a>
              </div>
            </div>

            <div className="tk-foot-copyright">
              <span>© {new Date().getFullYear()} TERKIT AI · ALL RIGHTS RESERVED</span>
              <span>BUILT WITH CARE</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
