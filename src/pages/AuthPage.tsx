// Sign-in / sign-up page styled in the aurora palette to match the landing.
// Email + password auth via Supabase. Falls back to a "skip auth (dev)"
// button when Supabase isn't configured so the app stays usable while the
// user is still wiring keys.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  devSkipAuth,
  isConfigured,
  signInWithEmail,
  signUpWithEmail,
  signInWithMagicLink,
} from "../lib/supabase";
import { getLandingPrompt } from "./LandingPage";
import "./AuthPage.css";

type Mode = "signin" | "signup" | "magic";

export function AuthPage() {
  const navigate = useNavigate();
  const supabaseReady = isConfigured();
  const landingPrompt = getLandingPrompt();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    if (mode !== "magic" && !password) {
      setError("Password is required");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await signInWithEmail(email.trim(), password);
        if (error) throw error;
        navigate("/app");
      } else if (mode === "signup") {
        const { data, error } = await signUpWithEmail(email.trim(), password);
        if (error) throw error;
        if (data.session) {
          navigate("/app");
        } else {
          setInfo(
            "Check your email for a confirmation link, then sign in."
          );
        }
      } else {
        const { error } = await signInWithMagicLink(email.trim());
        if (error) throw error;
        setInfo(
          `Magic link sent to ${email.trim()}. Click it to finish signing in.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    devSkipAuth();
    navigate("/app");
  };

  return (
    <div className="auth-page">
      <Link to="/" className="auth-back" aria-label="Back to landing">
        ← Back
      </Link>

      <div className="auth-card">
        <div className="auth-brand">
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
          <span className="auth-brand-name">Ariadne</span>
        </div>

        <h1 className="auth-title">
          {mode === "signup" ? "Create your account." : "Welcome back."}
        </h1>
        <p className="auth-sub">
          {mode === "signup"
            ? "An account keeps your designs, specs, and meshes."
            : mode === "magic"
              ? "We'll email you a one-time link — no password needed."
              : "Pick up where you left off."}
        </p>

        {landingPrompt && (
          <div className="auth-prompt-preview">
            “{landingPrompt}” — we'll generate this once you're in.
          </div>
        )}

        {!supabaseReady && (
          <div className="auth-msg info">
            Supabase isn't configured yet. Use <b>Skip auth (dev)</b> below to
            continue, or set <code>VITE_SUPABASE_URL</code> +{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> in your <code>.env</code> and
            restart Vite.
          </div>
        )}

        <div className="auth-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "signin"}
            className={`auth-tab ${mode === "signin" ? "active" : ""}`}
            onClick={() => {
              setMode("signin");
              setError(null);
              setInfo(null);
            }}
          >
            Sign in
          </button>
          <button
            role="tab"
            aria-selected={mode === "signup"}
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => {
              setMode("signup");
              setError(null);
              setInfo(null);
            }}
          >
            Sign up
          </button>
          <button
            role="tab"
            aria-selected={mode === "magic"}
            className={`auth-tab ${mode === "magic" ? "active" : ""}`}
            onClick={() => {
              setMode("magic");
              setError(null);
              setInfo(null);
            }}
          >
            Magic link
          </button>
        </div>

        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="auth-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={busy}
              autoFocus
            />
          </div>
          {mode !== "magic" && (
            <div className="auth-field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                disabled={busy}
              />
            </div>
          )}
          <button
            type="submit"
            className="auth-submit"
            disabled={busy || !supabaseReady}
          >
            {busy
              ? "Working…"
              : mode === "signup"
                ? "Create account"
                : mode === "magic"
                  ? "Email me a link"
                  : "Sign in"}
          </button>
        </form>

        {error && <div className="auth-msg error">{error}</div>}
        {info && <div className="auth-msg success">{info}</div>}

        {!supabaseReady && (
          <>
            <div className="auth-divider">or</div>
            <button className="auth-skip" onClick={handleSkip}>
              Skip auth (dev mode) →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
