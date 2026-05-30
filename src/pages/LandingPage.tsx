// Landing page — ported from Ariadne design HTML "The Thread v4".
// Scroll-driven activation: scroll past beat 1 (1% sentence) → beat 2 (the
// question) → activation (typewriter input). Hitting Enter routes to /auth
// with the entered prompt persisted in sessionStorage so the editor can
// pre-fill it after sign-in.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./LandingPage.css";

type BeatIndex = 0 | 1 | 2; // 0 = beat 1, 1 = beat 2, 2 = activation

const PROMPT_STORAGE_KEY = "ariadne.landingPrompt";

export function LandingPage() {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const [activeBeat, setActiveBeat] = useState<BeatIndex>(0);
  const [activated, setActivated] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [idea, setIdea] = useState("");

  // Scroll progress drives which beat is shown + when the bloom activates.
  // The film is 500vh tall; we map scroll progress to:
  //   0–0.20  → beat 0 ("Ideas are 1% of making a product")
  //   0.20–0.50 → beat 1 ("What if that was all you needed?")
  //   0.50–1.0  → activation (bloom + typewriter)
  useEffect(() => {
    function onScroll() {
      const film = document.getElementById("landing-film");
      if (!film) return;
      const rect = film.getBoundingClientRect();
      const total = film.offsetHeight - window.innerHeight;
      const progress = Math.max(0, Math.min(1, -rect.top / total));
      let next: BeatIndex = 0;
      if (progress > 0.5) next = 2;
      else if (progress > 0.2) next = 1;
      setActiveBeat((prev) => (prev === next ? prev : next));
      setActivated(progress > 0.5);
      if (progress > 0.05) setShowHint(false);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) sessionStorage.setItem(PROMPT_STORAGE_KEY, trimmed);
    else sessionStorage.removeItem(PROMPT_STORAGE_KEY);
    navigate("/auth");
  };

  return (
    <div className="landing" data-palette="aurora">
      <section
        className="landing-film"
        id="landing-film"
        aria-label="The story"
      >
        <div
          className={`landing-stage ${activated ? "activated" : ""}`}
          ref={stageRef}
        >
          <div className="landing-vignette" />
          <div className="landing-bloom" />
          <div className="landing-spark" />

          {/* Brand mark — top-left, fades in with the bloom */}
          <div className="landing-brand" aria-label="Ariadne">
            <span className="landing-brand-mark" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13.2 3.1 a9 9 0 1 1 -2.4 0" />
                <path d="M11 20.4 a6 6 0 1 1 2 0" />
                <path d="M13 6.6 a3 3 0 1 1 -2 0" />
                <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="landing-brand-name">Ariadne</span>
          </div>

          {/* Beat 1 */}
          <div className={`landing-beat ${activeBeat === 0 ? "show" : ""}`}>
            <p className="landing-line">Ideas are 1% of making a product.</p>
          </div>

          {/* Beat 2 */}
          <div className={`landing-beat ${activeBeat === 1 ? "show" : ""}`}>
            <p className="landing-line">What if that was all you needed?</p>
          </div>

          {/* Activation: prompt + typewriter input */}
          <div className="landing-activation">
            <div className="landing-activation-stack">
              <p className="landing-prompt">What&rsquo;s your idea?</p>
              <div className="landing-typewriter">
                <input
                  type="text"
                  className="landing-typewriter-input"
                  aria-label="Your idea"
                  placeholder="A modern brass floor lamp with a black conical shade…"
                  spellCheck={false}
                  autoComplete="off"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit(idea);
                    }
                  }}
                />
              </div>
              <div className="landing-activation-submit">Enter to start</div>
            </div>
          </div>
        </div>
      </section>

      <div className={`landing-hint ${showHint ? "show" : ""}`} aria-hidden="true">
        <svg
          viewBox="0 0 14 22"
          width="14"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 2 L7 18" />
          <path d="M2 13 L7 19 L12 13" />
        </svg>
      </div>
    </div>
  );
}

export function getLandingPrompt(): string | null {
  return sessionStorage.getItem(PROMPT_STORAGE_KEY);
}

export function clearLandingPrompt(): void {
  sessionStorage.removeItem(PROMPT_STORAGE_KEY);
}
