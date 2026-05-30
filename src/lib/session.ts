const KEY = "ariadne.sessionId";

export function getOrCreateSessionId(): string {
  const existing = sessionStorage.getItem(KEY);
  if (existing) return existing;
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(KEY, id);
  return id;
}

export function clearSessionId(): void {
  sessionStorage.removeItem(KEY);
}
