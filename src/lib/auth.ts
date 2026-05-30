// Tiny React hook around the Supabase auth state, with the dev-skip fallback.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  getCurrentSession,
  isConfigured,
  isDevSkipAuth,
  onAuthChange,
} from "./supabase";

export interface AuthState {
  ready: boolean;
  authed: boolean;
  session: Session | null;
  devSkip: boolean;
  supabaseConfigured: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [devSkip, setDevSkip] = useState(isDevSkipAuth());

  useEffect(() => {
    let cancelled = false;
    getCurrentSession()
      .then((s) => {
        if (!cancelled) {
          setSession(s);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    const unsub = onAuthChange((s) => {
      setSession(s);
    });
    // Watch dev-skip marker (mostly for explicit log-out)
    const i = setInterval(() => setDevSkip(isDevSkipAuth()), 1000);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(i);
    };
  }, []);

  return {
    ready,
    authed: !!session || devSkip,
    session,
    devSkip,
    supabaseConfigured: isConfigured(),
  };
}
