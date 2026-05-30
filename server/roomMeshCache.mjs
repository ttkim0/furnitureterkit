// Per-category cache of AI-generated 3D room meshes. Each gen costs $0.30+
// in Hunyuan credits and takes 1–3 min, so we save the resulting GLB URL
// to disk and re-serve it forever (per category id). The user can force a
// re-generation by passing { force: true } to the endpoint.
//
// We ALSO download the GLB itself to public/rooms/<category>.glb so the
// frontend loads from localhost (instant) instead of refetching 40 MB
// from Fal's CDN every time the user picks a room. The local URL is stored
// alongside the original Fal URL in the cache entry.
//
// Stored as a flat JSON file at the repo root so it survives `node --watch`
// restarts. Not committed to git (gitignored).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_PATH = ".room-mesh-cache.json";
const PUBLIC_ROOMS_DIR = "public/rooms";

// Download a remote GLB and write it to public/rooms/<category>.glb. Returns
// the public URL path (e.g. "/rooms/home-3d.glb") that the frontend will
// fetch — Vite serves public/ at the root. The fetch is cheap (~40 MB from
// Fal's CDN) and we only do it once per category at generation time.
export async function downloadAndHostGlb(category, falUrl) {
  mkdirSync(PUBLIC_ROOMS_DIR, { recursive: true });
  const res = await fetch(falUrl);
  if (!res.ok) {
    throw new Error(`failed to fetch ${falUrl}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = `${category}.glb`;
  await writeFile(join(PUBLIC_ROOMS_DIR, filename), buf);
  return { localUrl: `/rooms/${filename}`, byteLength: buf.length };
}

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

export function getCachedRoomMesh(categoryId) {
  const cache = loadCache();
  return cache[categoryId] ?? null;
}

export function setCachedRoomMesh(categoryId, entry) {
  const cache = loadCache();
  cache[categoryId] = { ...entry, cached_at: new Date().toISOString() };
  saveCache(cache);
}

export function listCachedRoomMeshes() {
  return loadCache();
}
