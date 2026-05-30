// Supabase client + auth helpers. Configured from VITE_SUPABASE_URL +
// VITE_SUPABASE_ANON_KEY at build time. If either is missing, isConfigured()
// returns false and the auth flow gracefully degrades to a local "skip auth"
// path so dev work can continue without a Supabase account.

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _client: SupabaseClient | null = null;
function get(): SupabaseClient {
  if (_client) return _client;
  if (!URL || !KEY) {
    throw new Error(
      "Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY"
    );
  }
  _client = createClient(URL, KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return _client;
}

export function isConfigured(): boolean {
  return !!URL && !!KEY;
}

/** Lazy-initialized Supabase client for query usage (storeDb, etc). */
export function getSupabase(): SupabaseClient {
  return get();
}

export async function getCurrentSession(): Promise<Session | null> {
  if (!isConfigured()) return null;
  const { data } = await get().auth.getSession();
  return data.session ?? null;
}

export function onAuthChange(cb: (s: Session | null) => void): () => void {
  if (!isConfigured()) return () => {};
  const { data } = get().auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmail(email: string, password: string) {
  return await get().auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email: string, password: string) {
  return await get().auth.signUp({ email, password });
}

export async function signInWithMagicLink(email: string, redirectTo?: string) {
  return await get().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo ?? `${window.location.origin}/app` },
  });
}

export async function signOut() {
  if (!isConfigured()) return;
  await get().auth.signOut();
}

// Dev-only "skip auth" — sets a marker in localStorage so the auth guard lets
// you through without Supabase configured. Useful while building/testing
// without a Supabase account.
const SKIP_KEY = "ariadne.skipAuth";
export function devSkipAuth(): void {
  localStorage.setItem(SKIP_KEY, "1");
}
export function isDevSkipAuth(): boolean {
  return localStorage.getItem(SKIP_KEY) === "1";
}
export function clearDevSkipAuth(): void {
  localStorage.removeItem(SKIP_KEY);
}
