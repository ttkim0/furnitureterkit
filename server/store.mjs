// In-memory session store. Sessions live until the server restarts.
// When real persistence is needed, swap this for a DB-backed store with the
// same get/set/delete shape.

const sessions = new Map();

export function getModel(sessionId) {
  return sessions.get(sessionId) ?? null;
}

export function setModel(sessionId, model) {
  sessions.set(sessionId, model);
  return model;
}

export function clearSession(sessionId) {
  sessions.delete(sessionId);
}

export function updatePart(sessionId, partId, override) {
  const model = sessions.get(sessionId);
  if (!model) return null;
  const idx = model.parts.findIndex((p) => p.id === partId);
  if (idx < 0) return null;
  const part = model.parts[idx];
  const next = { ...part };
  if (override.color !== undefined) next.color = override.color;
  if (override.scale !== undefined) next.scale = override.scale;
  model.parts[idx] = next;
  return model;
}
