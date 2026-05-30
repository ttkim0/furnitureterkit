// Terkit AI — public waitlist landing page.
//
// Design language is a near-direct port of Terminal Industries.
//
// ▸ ONE shared cinematic video fixed in the background of the page.
//   It is scrubbed by the user's scroll position — not autoplayed —
//   so the video advances only when the user is scrolling through a
//   "video-visible" section (hero or one of the three benefit panels).
//   When the user scrolls through a white section, the video stops
//   advancing (because no video-visible scroll is being consumed).
//   When they re-enter a video section, the cinematic continues from
//   exactly where they left off — never restarts.
//
// ▸ The four video-visible sections together cover the full duration
//   of the cinematic. By the time the user reaches the end of the
//   final benefit panel, the video has played through exactly once.
//
// ▸ Smoothness: cumulative scroll → target time. A requestAnimationFrame
//   loop eases video.currentTime toward the target, skipping while a
//   seek is in flight so we never queue up seek requests. The video
//   was re-encoded to H.264 with a keyframe every 0.5s, which makes
//   each seek resolve in ~10ms (instead of HEVC's ~100ms+).

import { useCallback, useEffect, useRef, useState } from "react";
import { joinWaitlist } from "../lib/waitlist";
import "../styles/terkit.css";

const VIDEO_URL = "/terkit-hero.mp4";

export function TerkitLandingPage() {
  const [loadingDone, setLoadingDone] = useState(false);
  const [logoAppeared, setLogoAppeared] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLogoAppeared(true), 400);
    const t2 = setTimeout(() => setLoadingDone(true), 2100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Waitlist form state
  const [email, setEmail] = useState("");
  const [idea, setIdea] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !idea.trim()) return;
    setStatus("submitting");
    setStatusMsg("");
    const result = await joinWaitlist(email, idea);
    if (!result.ok) {
      setStatus("error");
      setStatusMsg(result.error ?? "Something went wrong.");
      return;
    }
    setStatus("done");
    setStatusMsg(
      result.alreadyOnList
        ? "You're already on the list. We'll be in touch."
        : "You're in. We'll review your idea and reach out soon."
    );
    setEmail("");
    setIdea("");
  }

  const formRef = useRef<HTMLDivElement>(null);
  const scrollToWaitlist = useCallback(() => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // ── Shared video → canvas, scroll-driven scrub ─────────────────────
  // We draw the video frames onto a <canvas> rather than displaying the
  // <video> element directly. Reason: paused HTML5 videos can be wiped
  // by the browser at any moment (Chrome + Safari both do this — the
  // displayed frame briefly flashes black during seeks and stays black
  // when paused). The canvas holds the LAST successfully drawn frame
  // forever, so the user always sees a continuous image.
  //
  // The video stays in the DOM (underneath the canvas) so the browser
  // keeps its decoder warm. We don't rely on it being visible — the
  // canvas does all the visible work.
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const benefitsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    // alpha: true so that BEFORE the first frame is painted, the canvas
    // is transparent (the visible <video> + dark-green container show
    // through) instead of opaque black.
    const ctx = c.getContext("2d", { alpha: true });
    if (!ctx) return;

    // ── Mobile / touch devices ─────────────────────────────────────
    // Scrubbing a video via currentTime is janky or outright blocked on
    // iOS Safari + Android Chrome, and touch-momentum scrolling makes it
    // worse — which is why phones showed only the dark-green container.
    // On coarse-pointer devices we instead autoplay + loop the video
    // directly. The canvas is left untouched (transparent), so the
    // playing <video> shows straight through it.
    const isTouch =
      window.matchMedia("(pointer: coarse)").matches ||
      ("ontouchstart" in window && window.innerWidth < 1024);
    if (isTouch) {
      v.loop = true;
      v.muted = true;
      v.setAttribute("playsinline", "");
      const tryPlay = () => {
        v.play().catch(() => {});
      };
      tryPlay();
      // iOS sometimes withholds autoplay until a user gesture — retry on
      // the first touch/scroll/click so the video starts as soon as the
      // user interacts.
      const onGesture = () => tryPlay();
      window.addEventListener("touchstart", onGesture, { once: true, passive: true });
      window.addEventListener("scroll", onGesture, { once: true, passive: true });
      window.addEventListener("click", onGesture, { once: true });
      return () => {
        window.removeEventListener("touchstart", onGesture);
        window.removeEventListener("scroll", onGesture);
        window.removeEventListener("click", onGesture);
      };
    }

    const targetTime = { current: 0 };
    let lastDrawnTime = -1;

    function sizeCanvas() {
      if (!c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      c.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      // Redraw at new size so the canvas doesn't go blank on resize.
      drawCover();
    }

    // Draw the video's current frame onto the canvas with object-fit:
    // cover semantics so the 4K source fills the viewport without
    // distortion. Called on every seeked event AND defensively on
    // every rAF tick if the time has changed.
    function drawCover() {
      if (!v || !c || !ctx) return;
      if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const cw = c.width;
      const ch = c.height;
      const vAspect = vw / vh;
      const cAspect = cw / ch;
      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;
      if (vAspect > cAspect) {
        sw = vh * cAspect;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / cAspect;
        sy = (vh - sh) / 2;
      }
      try {
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, cw, ch);
        lastDrawnTime = v.currentTime;
      } catch {
        // drawImage can throw if the video frame isn't decoded yet —
        // just skip; we'll catch it on the next tick.
      }
    }

    function compute() {
      if (!v) return;
      const heroEl = heroRef.current;
      const benEl = benefitsRef.current;
      if (!heroEl || !benEl) return;
      // Map the video to ONE continuous scroll range: from the very top
      // of the hero down to the bottom of the benefits section. Because
      // the hero and benefits are adjacent (no white section between
      // them), the video advances smoothly the whole way — it never
      // freezes and restarts at an intersection. After the benefits end
      // it simply holds on the last frame (hidden under the white
      // sections anyway).
      const y = window.scrollY || window.pageYOffset;
      const heroTop = heroEl.getBoundingClientRect().top + y;
      const benRect = benEl.getBoundingClientRect();
      const benBottom = benRect.top + y + benRect.height - window.innerHeight;
      const range = Math.max(1, benBottom - heroTop);
      const p = Math.max(0, Math.min(1, (y - heroTop) / range));
      if (v.duration > 0 && Number.isFinite(v.duration)) {
        targetTime.current = p * v.duration;
      }
    }

    let raf: number | null = null;
    function tick() {
      if (v && v.duration > 0 && !v.seeking) {
        const delta = targetTime.current - v.currentTime;
        // Tolerance band: only seek when the difference is meaningful.
        // 0.04s ≈ 1 frame at 24fps. Smaller deltas would just trigger
        // pointless seeks that introduce visible stutter.
        if (Math.abs(delta) > 0.04) {
          v.currentTime = targetTime.current;
        }
      }
      // If the video advanced since the last draw, refresh the canvas.
      if (v && Math.abs(v.currentTime - lastDrawnTime) > 0.001) {
        drawCover();
      }
      raf = requestAnimationFrame(tick);
    }

    function onSeeked() { drawCover(); }
    function onLoadedData() {
      // First decoded frame is now in the video — draw it to the canvas
      // immediately so we never show empty/black.
      drawCover();
    }

    // requestVideoFrameCallback fires once per actually-rendered video
    // frame — the most reliable signal that a fresh frame is available
    // to draw. We use it (when supported) to capture frames during the
    // brief warm-up play, then hand off to the scrub loop.
    type RVFCVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    function onCanPlay() {
      const rv = v as RVFCVideo;
      // Kickstart: play briefly so the decoder produces real frames.
      v!.play().then(() => {
        if (rv.requestVideoFrameCallback) {
          // Draw the first rendered frame, then stop playback and scrub.
          rv.requestVideoFrameCallback(() => {
            drawCover();
            v!.pause();
          });
        } else {
          // Fallback: draw a couple of frames over ~120ms, then pause.
          drawCover();
          setTimeout(() => { drawCover(); v!.pause(); }, 120);
        }
      }).catch(() => {
        // Autoplay rejected — nudge currentTime to force a seek+decode.
        if (v) v.currentTime = 0.001;
      });
    }

    v.addEventListener("loadeddata", onLoadedData);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("canplay", onCanPlay, { once: true });
    // If video was already past these states before we attached, run them now.
    if (v.readyState >= 2) onLoadedData();
    if (v.readyState >= 3) onCanPlay();

    window.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", sizeCanvas);
    sizeCanvas();
    compute();
    raf = requestAnimationFrame(tick);

    return () => {
      v.removeEventListener("loadeddata", onLoadedData);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("canplay", onCanPlay);
      window.removeEventListener("scroll", compute);
      window.removeEventListener("resize", sizeCanvas);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <LoadingScreen done={loadingDone} appeared={logoAppeared} />

      {/* ONE fixed canvas (with hidden source video) that everything
          else floats above. */}
      <BackgroundVideo videoRef={videoRef} canvasRef={canvasRef} />

      <Header onWaitlistClick={scrollToWaitlist} />

      <main className={`tk-page ${loadingDone ? "is-revealed" : ""}`} id="top">
        {/* Hero and Benefits are adjacent and both transparent so the
            background video plays continuously and smoothly across the
            two — no white section interrupts it. */}
        <Hero sectionRef={heroRef} onWaitlistClick={scrollToWaitlist} />

        <Benefits sectionRef={benefitsRef} />

        <NotchSeparator />

        <SectionIntro
          eyebrow={null}
          title={
            <>
              Imagine your idea as a finished product —{" "}
              <strong>designed, made, and shipped</strong> while you sleep.
            </>
          }
        />

        <SectionIntro
          eyebrow="How It Works"
          title={
            <>
              Revolutionary technology that turns a sketch into a{" "}
              <strong>real business</strong>
            </>
          }
          cta={{ label: "Take a closer look", onClick: scrollToWaitlist }}
        />

        <WaitlistForm
          formRef={formRef}
          email={email}
          idea={idea}
          status={status}
          statusMsg={statusMsg}
          onEmailChange={setEmail}
          onIdeaChange={setIdea}
          onSubmit={handleSubmit}
        />

        <Footer onWaitlistClick={scrollToWaitlist} />
      </main>
    </>
  );
}

/* ─────────────────────────── BackgroundVideo ─────────────────────────── */
//
// Single <video> tag, position: fixed across the viewport, behind every
// section. White sections cover it; transparent sections (hero, feature
// panels) reveal it. preload="auto" + no autoplay/loop — we drive
// currentTime ourselves so each user gets the cinematic to play through
// exactly once across the entire scroll of the page.

function BackgroundVideo({
  videoRef,
  canvasRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  return (
    <div className="tk-bg-video" aria-hidden="true">
      {/* Hidden source video — stays mounted so the browser's decoder
          stays warm. We never display it directly; we paint its frames
          onto the canvas above. */}
      <video
        ref={videoRef}
        src={VIDEO_URL}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        className="tk-bg-video-source"
      />
      <canvas ref={canvasRef} className="tk-bg-canvas" />
    </div>
  );
}

/* ─────────────────────────── Loading screen ─────────────────────────── */

function LoadingScreen({ done, appeared }: { done: boolean; appeared: boolean }) {
  return (
    <div className={`tk-loader ${done ? "is-done" : ""}`}>
      <div className={`tk-loader-mark ${appeared ? "is-in" : ""}`}>
        <BrandGlyph size={64} />
        <span className="tk-loader-word" aria-label="Terkit">
          {"TERKIT".split("").map((c, i) => (
            <span
              key={i}
              className="tk-loader-letter"
              style={{ animationDelay: `${i * 70 + 350}ms` }}
            >
              {c}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────── Header ─────────────────────────── */

function Header({ onWaitlistClick }: { onWaitlistClick: () => void }) {
  return (
    <header className="tk-header">
      <div className="tk-header-inner">
        <a href="#top" className="tk-header-brand" aria-label="Terkit home">
          <BrandGlyph size={24} />
          <span className="tk-header-brand-word">Terkit</span>
        </a>

        <nav className="tk-header-nav">
          <a href="#system">System</a>
          <a href="#makers">Makers</a>
          <a href="#waitlist">Waitlist</a>
          <a href="#about">About</a>
        </nav>

        <div className="tk-header-actions">
          <button className="tk-cta tk-cta-secondary" onClick={onWaitlistClick}>
            Demo
          </button>
          <button className="tk-cta tk-cta-primary" onClick={onWaitlistClick}>
            Join Waitlist
          </button>
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────────── Hero ─────────────────────────── */
//
// Tall transparent section. The background video shows through. Like
// Terminal, the page OPENS on the cinematic alone — the headline is
// invisible at the very top and FADES IN as a whole block as you start
// scrolling (a clean opacity fade, not a messy per-character reveal).
// A small "Scroll" prompt is visible up top and fades out as the copy
// fades in.

function Hero({
  sectionRef,
  onWaitlistClick,
}: {
  sectionRef: React.RefObject<HTMLDivElement | null>;
  onWaitlistClick: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onScroll() {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dist = Math.max(1, rect.height - window.innerHeight);
      const p = Math.max(0, Math.min(1, -rect.top / dist));
      // Copy fades IN over 4%–32% of the hero scroll, then fades back
      // OUT over 82%–98% — so by the time the sticky overlay un-pins
      // (at p≈1) the headline is gone and doesn't visibly slide away
      // under the header; the cinematic just carries into the benefits.
      // Direct DOM writes (no React re-render) keep scrolling buttery.
      const copyIn = Math.max(0, Math.min(1, (p - 0.04) / 0.28));
      const copyOut = Math.max(0, Math.min(1, (p - 0.82) / 0.16));
      const copyOpacity = copyIn * (1 - copyOut);
      if (contentRef.current) {
        contentRef.current.style.opacity = String(copyOpacity);
        contentRef.current.style.transform = `translateY(${(1 - copyIn) * 16}px)`;
      }
      if (promptRef.current) {
        promptRef.current.style.opacity = String(Math.max(0, 1 - p * 6));
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [sectionRef]);

  return (
    <section ref={sectionRef} className="tk-hero" id="top-hero">
      {/* Scroll prompt — visible while the cinematic plays alone, fades
          out as the headline fades in. */}
      <div ref={promptRef} className="tk-hero-prompt">
        <span className="tk-hero-prompt-label">Scroll to begin</span>
        <span className="tk-hero-prompt-line" />
      </div>

      {/* Sticky overlay holds the headline at the bottom of the viewport. */}
      <div className="tk-hero-overlay">
        <div ref={contentRef} className="tk-hero-content" style={{ opacity: 0 }}>
          <p className="tk-hero-eyebrow">
            <span className="tk-hero-dot" />
            Idea → Product → Business
          </p>
          <h1 className="tk-hero-title">
            Make what you imagine.
            <br />
            Sell it <u>tomorrow</u>.
          </h1>
          <p className="tk-hero-sub">
            AI-native technology that turns a sentence into a real product —
            designed, manufactured, and shipped while you build the next idea.
          </p>
          <div className="tk-hero-cta">
            <button
              className="tk-cta tk-cta-primary tk-cta-lg"
              onClick={onWaitlistClick}
            >
              Join the Waitlist
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── Notch Separator ─────────────────────────── */

function NotchSeparator({ flipped = false }: { flipped?: boolean }) {
  return (
    <div className={`tk-notch ${flipped ? "is-flipped" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 100 6" preserveAspectRatio="none">
        <path d="M0,6 L0,3 Q50,-3 100,3 L100,6 Z" fill="var(--tk-paper)" />
      </svg>
    </div>
  );
}

/* ─────────────────────────── Section Intro ─────────────────────────── */

function SectionIntro({
  eyebrow,
  title,
  cta,
}: {
  eyebrow: string | null;
  title: React.ReactNode;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <section className="tk-section-intro">
      <div className="tk-section-intro-inner">
        {eyebrow && <p className="tk-label">{eyebrow}</p>}
        <h2 className="tk-title-si">{title}</h2>
        {cta && (
          <div className="tk-section-cta">
            <button className="tk-underlined-cta" onClick={cta.onClick}>
              {cta.label}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────── Fullscreen Features ─────────────────────────── */
//
// Three stacked panels. They are TRANSPARENT — the fixed background
// video shows through. Each panel has a dark-green caption bar at the
// bottom of its sticky viewport with the benefit's title + body.

const FEATURES = [
  {
    preTitle: "Benefit 01",
    title: (
      <>
        A single <strong>workflow</strong> for
        <br /> turning sketches into <u>products</u>
      </>
    ),
    body:
      "Drop in a sketch, a photo, or a one-line description. Our AI handles industrial design, CAD, BOMs, and renders — then matches you with maker partners we already trust. You approve every step.",
  },
  {
    preTitle: "Benefit 02",
    title: (
      <>
        <u><strong>Easy</strong></u>, scalable
        <br /> <strong>production</strong>
      </>
    ),
    body:
      "No factory hunting. No spreadsheets. No minimums you can't meet. Terkit's network handles small runs and scale-ups alike — woodworkers, ceramicists, CNC shops, soft-goods. One contract, one quality bar.",
  },
  {
    preTitle: "Benefit 03",
    title: (
      <>
        <strong>Rapid</strong>, <strong>repeatable</strong>
        <br /> <u>revenue</u>
      </>
    ),
    body:
      "We build your store, take payments, ship orders, run support, and handle returns. You bring the idea. We bring the business — and you keep the brand.",
  },
];

// ONE sticky section that the video plays continuously behind. A single
// dark-green caption bar is pinned to the bottom of the viewport, and
// the three benefits cross-fade through it back-to-back as you scroll —
// no gaps, no separate panels, so you read straight through 01 → 02 →
// 03 while the cinematic keeps moving above.

function Benefits({
  sectionRef,
}: {
  sectionRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    function onScroll() {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dist = Math.max(1, rect.height - window.innerHeight);
      const p = Math.max(0, Math.min(0.9999, -rect.top / dist));
      // Three equal thirds → benefit index 0,1,2.
      const idx = Math.min(FEATURES.length - 1, Math.floor(p * FEATURES.length));
      setActive((prev) => (prev === idx ? prev : idx));
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [sectionRef]);

  return (
    <section ref={sectionRef} className="tk-features" id="system">
      <div className="tk-features-sticky">
        {/* Transparent — the fixed background video shows through. */}
        <div className="tk-features-vignette" />

        {/* Persistent caption bar; the three benefits cross-fade inside. */}
        <div className="tk-features-bar">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className={`tk-feature-caption ${i === active ? "is-active" : ""}`}
              aria-hidden={i !== active}
            >
              <div className="tk-feature-title-block">
                <p className="tk-feature-pre">{f.preTitle}</p>
                <div className="tk-feature-title">{f.title}</div>
              </div>
              <div className="tk-feature-body">
                <p>{f.body}</p>
                <p className="tk-feature-progress">
                  {String(i + 1).padStart(2, "0")} /{" "}
                  {String(FEATURES.length).padStart(2, "0")}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Step dots so the reader can see progress through the three. */}
        <div className="tk-features-dots" aria-hidden="true">
          {FEATURES.map((_, i) => (
            <span
              key={i}
              className={`tk-features-dot ${i === active ? "is-active" : ""}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── Waitlist Form ─────────────────────────── */

function WaitlistForm({
  formRef,
  email,
  idea,
  status,
  statusMsg,
  onEmailChange,
  onIdeaChange,
  onSubmit,
}: {
  formRef: React.RefObject<HTMLDivElement | null>;
  email: string;
  idea: string;
  status: "idle" | "submitting" | "done" | "error";
  statusMsg: string;
  onEmailChange: (v: string) => void;
  onIdeaChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <section ref={formRef} className="tk-form-section" id="waitlist">
      <div className="tk-form-inner">
        <h2 className="tk-form-title">
          <strong>Demo, waitlist, conversation —</strong>
          <br />
          <strong>you decide how to Terkit</strong>
        </h2>

        <div className="tk-form-content">
          <div className="tk-form-info">
            <h3>Drop your email and we'll get back to you, your way.</h3>
            <p>
              Tell us what you want to make. We'll review your idea and reach
              out about:
            </p>
            <ul className="tk-form-list">
              <li>15-minute product walkthrough</li>
              <li>Early-access waitlist invitation</li>
              <li>Maker-partner network introduction</li>
            </ul>
            <p className="tk-form-info-muted">
              Trusted by makers across furniture, ceramics, lighting, and more.
            </p>
          </div>

          <div className="tk-form-card">
            <form onSubmit={onSubmit} className="tk-form">
              <div className="tk-field">
                <label htmlFor="tk-email">
                  Email <span>*</span>
                </label>
                <input
                  id="tk-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@email.com"
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                  disabled={status === "submitting" || status === "done"}
                />
              </div>

              <div className="tk-field">
                <label htmlFor="tk-idea">
                  What do you want to make? <span>*</span>
                </label>
                <textarea
                  id="tk-idea"
                  rows={4}
                  required
                  maxLength={1000}
                  placeholder="A walnut bookshelf that holds vinyl records, a ceramic mug with a thumb rest, …"
                  value={idea}
                  onChange={(e) => onIdeaChange(e.target.value)}
                  disabled={status === "submitting" || status === "done"}
                />
              </div>

              <button
                type="submit"
                className="tk-form-submit"
                disabled={status === "submitting" || status === "done"}
              >
                {status === "submitting"
                  ? "SUBMITTING…"
                  : status === "done"
                    ? "✓ ON THE LIST"
                    : "SUBMIT"}
              </button>

              {statusMsg && (
                <p
                  className={`tk-form-status ${
                    status === "error" ? "is-error" : "is-ok"
                  }`}
                >
                  {statusMsg}
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── Footer ─────────────────────────── */

function Footer({ onWaitlistClick }: { onWaitlistClick: () => void }) {
  return (
    <footer className="tk-footer" id="about">
      <div className="tk-footer-header">
        <h2 className="tk-footer-title">
          The future of making starts today.
        </h2>
        <button onClick={onWaitlistClick} className="tk-footer-cta">
          Take charge of your studio
        </button>
      </div>

      <div className="tk-footer-content">
        <div className="tk-footer-brand">
          <BrandGlyph size={48} />
          <span className="tk-footer-brand-word">Terkit</span>
        </div>

        <div className="tk-footer-links">
          <div className="tk-footer-col">
            <p className="tk-label tk-label-on-dark">System</p>
            <ul>
              <li><a href="#top">Homepage</a></li>
              <li><a href="#system">How it works</a></li>
              <li><a href="#waitlist">Waitlist</a></li>
            </ul>
          </div>
          <div className="tk-footer-col">
            <p className="tk-label tk-label-on-dark">Company</p>
            <ul>
              <li><a href="#about">About</a></li>
              <li><a href="#waitlist">Contact</a></li>
            </ul>
          </div>
        </div>

        <div className="tk-footer-contact">
          <p className="tk-label tk-label-on-dark">Reach us</p>
          <a href="#waitlist" className="tk-footer-contact-link">
            Ready to make what you imagine?
          </a>
          <p className="tk-footer-contact-text">We reply within a day.</p>
        </div>
      </div>

      <div className="tk-footer-bottom">
        <p>© {new Date().getFullYear()} Terkit — All rights reserved</p>
      </div>
    </footer>
  );
}

/* ─────────────────────────── Brand Glyph ─────────────────────────── */

function BrandGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className="tk-brand-glyph"
    >
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M7 8h10M12 8v9M12 13.5l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
