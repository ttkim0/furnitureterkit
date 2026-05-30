// IP geolocation + hashing for the analytics pipeline.
//
// We use ipapi.co's free tier — 1,000 requests/day, no API key, returns
// country + region + city + lat/lon from any IPv4/v6. For production we'd
// either pay for a plan or bundle MaxMind GeoLite2 locally; both are
// straightforward to swap in later.
//
// Privacy: IPs are HASHED before storage (SHA-256 + monthly salt). We
// keep the country/region/city derived from the IP but not the IP itself,
// so we can show per-country stats without holding raw addresses.

import { createHash } from "node:crypto";

const LOOKUP_CACHE = new Map(); // ip → { country, country_name, city, region } | null
const CACHE_MAX = 5000;
const SALT = `ariadne-geo-${new Date().getUTCFullYear()}-${new Date().getUTCMonth()}`;

/**
 * @param {string} ip - IPv4 or IPv6
 * @returns {Promise<{ country: string|null, country_name: string|null, city: string|null, region: string|null }>}
 */
export async function lookupGeo(ip) {
  if (!ip || isPrivateOrLocal(ip)) {
    return { country: null, country_name: null, city: null, region: null };
  }
  if (LOOKUP_CACHE.has(ip)) {
    return LOOKUP_CACHE.get(ip);
  }
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { Accept: "application/json", "User-Agent": "ariadne-furniture/1.0" },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      LOOKUP_CACHE.set(ip, null);
      return { country: null, country_name: null, city: null, region: null };
    }
    const j = await res.json();
    const result = {
      country: j.country_code ?? null,
      country_name: j.country_name ?? null,
      city: j.city ?? null,
      region: j.region ?? null,
    };
    if (LOOKUP_CACHE.size >= CACHE_MAX) {
      // Drop oldest insertion (Maps preserve insertion order).
      const first = LOOKUP_CACHE.keys().next().value;
      LOOKUP_CACHE.delete(first);
    }
    LOOKUP_CACHE.set(ip, result);
    return result;
  } catch {
    return { country: null, country_name: null, city: null, region: null };
  }
}

/** SHA-256 hash with monthly salt — same IP → same hash within a month
 *  for dedup; rotates to break cross-month correlation. */
export function hashIp(ip) {
  if (!ip) return null;
  return createHash("sha256").update(`${SALT}:${ip}`).digest("hex").slice(0, 32);
}

function isPrivateOrLocal(ip) {
  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("fe80:")) return true;
  return false;
}

/** Extract the client IP from a Node IncomingMessage, honoring proxy headers. */
export function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "";
}
