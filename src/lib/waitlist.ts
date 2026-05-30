// Waitlist signup helper — drops an email into Supabase's `waitlist` table.
//
// Anon-key safe: RLS lets anyone INSERT. Nobody (anon) can SELECT, so the
// list isn't readable from the browser. Read it via the Supabase dashboard
// or a server endpoint using the service-role key.

import { getSupabase, isConfigured } from "./supabase";

export interface WaitlistResult {
  ok: boolean;
  alreadyOnList?: boolean;
  error?: string;
}

export async function joinWaitlist(
  email: string,
  idea: string
): Promise<WaitlistResult> {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedIdea = idea.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return { ok: false, error: "That email looks off — double-check it." };
  }
  if (trimmedIdea.length < 8) {
    return { ok: false, error: "Tell us a bit more about your idea (at least a sentence)." };
  }
  if (!isConfigured()) {
    return { ok: false, error: "Supabase not configured" };
  }
  const sb = getSupabase();
  const { error } = await sb.from("waitlist").insert({
    email: trimmedEmail,
    idea: trimmedIdea.slice(0, 1000),
    source: "terkit-landing",
    referrer: document.referrer || null,
    user_agent: navigator.userAgent.slice(0, 280),
  });
  if (!error) return { ok: true };

  // Duplicate-email constraint = "you're already in" — treat as success-ish.
  // Supabase returns code '23505' (unique_violation) for the unique index.
  const code = (error as { code?: string }).code;
  if (code === "23505" || /duplicate|unique/i.test(error.message)) {
    return { ok: true, alreadyOnList: true };
  }

  return { ok: false, error: error.message || "Couldn't add you to the list." };
}
