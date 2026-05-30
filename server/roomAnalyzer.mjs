// Claude vision pass over many room frames → structured room description.
//
// Architecture sits between video-frame extraction (browser) and the
// image-generation step (gpt-image-1). gpt-image-1's edit endpoint caps
// at 10 input images; Claude Sonnet vision comfortably handles 50+ per
// request. So we use Claude as the "many-frames understanding" stage and
// pipe its structured output as ground-truth context into gpt-image-1.
//
// The output is intentionally STRUCTURED JSON, not free-form prose —
// gpt-image-1 follows specific dimensions and feature lists much more
// reliably than vague descriptions like "a cozy living room".
//
// Cost (Claude Sonnet 4.6, 50 frames at ~768px each):
//   ~50 K input tokens × $3/M + ~1.5 K output × $15/M ≈ $0.17 per scan

import Anthropic from "@anthropic-ai/sdk";

export class AnthropicUnavailable extends Error {}

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AnthropicUnavailable("ANTHROPIC_API_KEY not set");
  }
  _client = new Anthropic();
  return _client;
}

const ANALYZER_MODEL = "claude-sonnet-4-6";
const MAX_IMAGES_PER_REQUEST = 50;

const SYSTEM_PROMPT = `You are a spatial-reasoning assistant that looks at many photos of a single real room and writes a precise structured description of it.

You will receive 5 to 50 images that are all of the SAME room, captured from different angles. Build a coherent mental model of the room from across all the views, then output a STRICT JSON object matching the schema. Do not output anything outside the JSON.

Be specific about measurements: walls, windows, doors should have approximate sizes in meters where possible. If you can't infer a dimension, give your best estimate.

Schema:
{
  "room_type": string,                    // e.g. "living room", "bedroom", "small office"
  "approximate_dimensions_m": {
    "width": number,                       // longest horizontal dim
    "depth": number,                       // perpendicular horizontal dim
    "ceiling_height": number               // vertical, typically 2.4 - 3.5
  },
  "floor": {
    "material": string,                    // "oak hardwood" / "polished concrete" / "beige carpet" / "marble tile"
    "color": string,                       // hex or short name e.g. "warm beige"
    "finish": string                       // "matte" | "glossy" | "natural"
  },
  "walls": {
    "primary_color": string,               // dominant wall paint/material
    "material": string,                    // "painted drywall" / "exposed brick" / "wood paneling"
    "notable_features": [string]           // e.g. ["white wainscoting on lower 1m", "single brick accent wall"]
  },
  "ceiling": {
    "color": string,
    "features": [string]                   // ["recessed downlights", "exposed beams", "skylight"]
  },
  "openings": [
    {
      "kind": "door" | "window" | "archway",
      "wall": "north" | "east" | "south" | "west" | string,
      "approximate_width_m": number,
      "approximate_height_m": number,
      "notes": string                      // e.g. "double-pane, frosted bottom half"
    }
  ],
  "architectural_features": [string],     // ["fireplace on east wall (1.2m wide brick surround)", "ceiling beams running N-S"]
  "lighting": {
    "natural_sources": [string],          // ["large south-facing window", "skylight"]
    "fixtures": [string]                   // ["3 ceiling recessed lights", "wall sconces flanking fireplace"]
  },
  "overall_style": string,                 // free-form: "Mid-century modern", "industrial loft", "Scandinavian minimalist"
  "confidence": number,                    // 0-1, how confident you are the description matches across views
  "ambiguities": [string]                  // anything you couldn't see well or guessed at
}

Be honest about confidence. If only 3 of the 50 frames show the same wall and the rest are of a different wall, say so in ambiguities and lower your confidence.`;

/**
 * Analyze a batch of room frames with Claude vision.
 *
 * @param {Array<{mediaType: string, data: string}>} frames - Up to 50 base64 ImageRefs
 * @returns {Promise<object>} Structured room description matching the schema above
 */
export async function analyzeRoomFrames(frames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error("analyzeRoomFrames: need at least 1 frame");
  }
  if (frames.length > MAX_IMAGES_PER_REQUEST) {
    throw new Error(
      `too many frames: ${frames.length} (max ${MAX_IMAGES_PER_REQUEST})`
    );
  }
  const client = getClient();

  // Build content blocks: a text intro + N image blocks
  const content = [
    {
      type: "text",
      text: `Here are ${frames.length} photographs of the same room, taken from different angles. Build a coherent mental model and output the strict JSON described in the system prompt.`,
    },
    ...frames.map((f) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: f.mediaType,
        data: f.data,
      },
    })),
  ];

  const response = await client.messages.create({
    model: ANALYZER_MODEL,
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  // Extract the text response and parse the JSON
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  // Tolerant JSON extraction — strip markdown fencing if Claude added it
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `Claude returned no JSON. Raw: ${text.slice(0, 500)}…`
    );
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(
      `Claude returned malformed JSON: ${e.message}. Raw: ${jsonMatch[0].slice(0, 500)}…`
    );
  }
}

/**
 * Render a structured room description as a paragraph gpt-image-1 can
 * use as a high-fidelity prompt. Returns a clean string that captures
 * all the architectural ground-truth without LLM-friendly preamble.
 */
export function descriptionToPrompt(desc) {
  if (!desc) return "";
  const parts = [];

  if (desc.room_type) {
    parts.push(`A ${desc.room_type}.`);
  }
  if (desc.approximate_dimensions_m) {
    const d = desc.approximate_dimensions_m;
    parts.push(
      `Approximately ${d.width?.toFixed?.(1) || d.width} × ${
        d.depth?.toFixed?.(1) || d.depth
      } m floor area with a ${d.ceiling_height?.toFixed?.(1) || d.ceiling_height} m ceiling.`
    );
  }
  if (desc.floor) {
    parts.push(
      `Floor: ${desc.floor.material} in ${desc.floor.color}, ${desc.floor.finish} finish.`
    );
  }
  if (desc.walls) {
    parts.push(
      `Walls: ${desc.walls.material} painted ${desc.walls.primary_color}${
        desc.walls.notable_features?.length
          ? ` with ${desc.walls.notable_features.join(", ")}`
          : ""
      }.`
    );
  }
  if (desc.ceiling) {
    parts.push(
      `Ceiling: ${desc.ceiling.color}${
        desc.ceiling.features?.length
          ? `, featuring ${desc.ceiling.features.join(", ")}`
          : ""
      }.`
    );
  }
  if (desc.openings?.length) {
    const list = desc.openings
      .map(
        (o) =>
          `a ${o.approximate_width_m?.toFixed?.(1) || o.approximate_width_m}m wide × ${
            o.approximate_height_m?.toFixed?.(1) || o.approximate_height_m
          }m tall ${o.kind} on the ${o.wall} wall${
            o.notes ? ` (${o.notes})` : ""
          }`
      )
      .join("; ");
    parts.push(`Openings: ${list}.`);
  }
  if (desc.architectural_features?.length) {
    parts.push(
      `Architectural features: ${desc.architectural_features.join("; ")}.`
    );
  }
  if (desc.lighting) {
    const ls = [];
    if (desc.lighting.natural_sources?.length)
      ls.push(`natural light from ${desc.lighting.natural_sources.join(", ")}`);
    if (desc.lighting.fixtures?.length)
      ls.push(`fixtures including ${desc.lighting.fixtures.join(", ")}`);
    if (ls.length) parts.push(`Lighting: ${ls.join("; ")}.`);
  }
  if (desc.overall_style) {
    parts.push(`Style: ${desc.overall_style}.`);
  }
  return parts.join(" ");
}

export function isAnthropicConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ─── Claude analysis → procedural room layout ────────────────────────────
//
// The output here matches the ScannedRoomLayout shape the frontend's
// RoomLayout3D component already renders (originally built for SpatialLM).
// By converting Claude's analysis to that shape, the same renderer turns
// it into proper walls / doors / windows in Three.js — clean architectural
// geometry instead of a Roblox-looking Hunyuan blob.
//
// Coordinate convention (matches SpatialLM):
//   - z-up, y is depth (north-south), x is width (east-west)
//   - origin at room center, floor at z = 0
//   - Walls are line segments (a → b) at z = 0 with a vertical height
//
// SpatialLM Wall(ax, ay, az, bx, by, bz, height, thickness):
//   - a → b is the wall's line on the floor (z = 0)
//   - height is the wall's vertical extent
//   - thickness is just visual padding

// Map compass-direction strings Claude uses to wall indexes
const COMPASS_TO_WALL = {
  north: "wall_n",
  south: "wall_s",
  east: "wall_e",
  west: "wall_w",
};

// CSS-color-ish vocabulary Claude tends to use. Map to hex so the
// renderer can apply real materials.
const COLOR_HINTS = [
  ["off-white", "#f5f1e8"], ["off white", "#f5f1e8"], ["eggshell", "#f3eedf"],
  ["cream", "#f5ecd9"], ["ivory", "#f8f4e3"], ["bone", "#e8dfc8"],
  ["white", "#f4f1ea"], ["beige", "#e6d7b8"], ["taupe", "#b8a78a"],
  ["gray", "#9aa0a6"], ["grey", "#9aa0a6"], ["charcoal", "#3a3a3e"],
  ["black", "#1a1a1c"], ["navy", "#1e3a5f"], ["blue", "#5a7ea3"],
  ["green", "#6a8a72"], ["sage", "#9aac8e"], ["olive", "#6a6b3a"],
  ["red", "#a04250"], ["brick", "#9a4a3a"], ["terracotta", "#b86f4a"],
  ["pink", "#e6b8b0"], ["yellow", "#e8c870"], ["mustard", "#c89a3a"],
  ["brown", "#8a6a4a"], ["walnut", "#5a3a26"], ["oak", "#c9a878"],
  ["honey", "#d4a878"], ["pine", "#d8b890"], ["mahogany", "#5a2a20"],
  ["concrete", "#a8a8a8"], ["marble", "#e8e3d8"], ["tile", "#d8d2c5"],
];

function colorStringToHex(s) {
  if (!s || typeof s !== "string") return null;
  const lower = s.toLowerCase().trim();
  // If it's already a hex code, return as-is
  if (/^#[0-9a-f]{6}$/i.test(lower)) return lower;
  if (/^#[0-9a-f]{3}$/i.test(lower)) return lower;
  // Otherwise look for a color word
  for (const [keyword, hex] of COLOR_HINTS) {
    if (lower.includes(keyword)) return hex;
  }
  return null;
}

/**
 * Convert a Claude room-analysis JSON into the SpatialLM-shaped layout
 * the frontend RoomLayout3D component renders directly.
 *
 * Returns { layout, theme } where:
 *   layout = { walls, doors, windows, bboxes }
 *   theme  = { floorColor, wallColor, ceilingColor } — hex strings
 *            for the RoomLayout3D renderer to use as material colors
 */
export function claudeAnalysisToLayout(analysis) {
  if (!analysis) {
    return { layout: { walls: [], doors: [], windows: [], bboxes: [] }, theme: {} };
  }

  const dims = analysis.approximate_dimensions_m || {};
  // Clamp to reasonable residential bounds so we don't get a 50m mega-room
  // if Claude was over-confident
  const width = clamp(toNumber(dims.width, 4.5), 2, 25);
  const depth = clamp(toNumber(dims.depth, 4.5), 2, 25);
  const ceilingHeight = clamp(toNumber(dims.ceiling_height, 2.6), 2, 6);

  const halfW = width / 2;
  const halfD = depth / 2;

  // 4 walls (N/E/S/W). SpatialLM uses z-up: walls are line segments on
  // the floor plane with az=bz=0 and a height.
  // Coordinate sketch:                       N (back, +y)
  //                                     ┌────────────────────┐
  //                                     │                    │
  //                                  W ─│   center (0,0,0)   │─ E (+x)
  //                                     │                    │
  //                                     └────────────────────┘
  //                                       S (front, -y)
  const walls = [
    { id: "wall_n", ax: -halfW, ay: +halfD, az: 0, bx: +halfW, by: +halfD, bz: 0, height: ceilingHeight, thickness: 0.1 },
    { id: "wall_e", ax: +halfW, ay: +halfD, az: 0, bx: +halfW, by: -halfD, bz: 0, height: ceilingHeight, thickness: 0.1 },
    { id: "wall_s", ax: +halfW, ay: -halfD, az: 0, bx: -halfW, by: -halfD, bz: 0, height: ceilingHeight, thickness: 0.1 },
    { id: "wall_w", ax: -halfW, ay: -halfD, az: 0, bx: -halfW, by: +halfD, bz: 0, height: ceilingHeight, thickness: 0.1 },
  ];

  // Openings → doors + windows. We place each at the midpoint of its
  // wall and at a sensible vertical height (door bottom on floor, window
  // bottom at sill height ~0.9 m).
  const doors = [];
  const windows = [];
  const openings = Array.isArray(analysis.openings) ? analysis.openings : [];
  let doorIdx = 0;
  let windowIdx = 0;
  // Track how many openings on each wall so we can spread them apart
  const openingsPerWall = { wall_n: 0, wall_e: 0, wall_s: 0, wall_w: 0 };
  for (const o of openings) {
    const wallId = COMPASS_TO_WALL[String(o.wall || "").toLowerCase().trim()];
    if (!wallId) continue;
    const wall = walls.find((w) => w.id === wallId);
    if (!wall) continue;
    // Offset successive openings on the same wall along its length so
    // they don't stack on top of each other
    const count = openingsPerWall[wallId]++;
    const wallLen =
      wall.id === "wall_n" || wall.id === "wall_s" ? width : depth;
    const offset = ((count - 0.5) * wallLen) / 4; // -wallLen/8, +wallLen/8, ...
    // Position = midpoint of the wall + offset along the wall direction
    const midX = (wall.ax + wall.bx) / 2;
    const midY = (wall.ay + wall.by) / 2;
    const horiz = wall.id === "wall_n" || wall.id === "wall_s" ? "x" : "y";
    const posX = horiz === "x" ? midX + offset : midX;
    const posY = horiz === "y" ? midY + offset : midY;
    const w = clamp(toNumber(o.approximate_width_m, 0.9), 0.3, 4);
    const h = clamp(
      toNumber(o.approximate_height_m, o.kind === "window" ? 1.4 : 2.0),
      0.3,
      ceilingHeight - 0.1
    );
    const z = o.kind === "window" ? 0.9 : 0; // window sill at 0.9 m

    const entry = {
      id: `${o.kind}_${o.kind === "door" ? doorIdx++ : windowIdx++}`,
      wall_id: wallId,
      position_x: posX,
      position_y: posY,
      position_z: z,
      width: w,
      height: h,
    };
    if (o.kind === "window") windows.push(entry);
    else doors.push(entry); // doors + archways both get rendered as openings
  }

  // Theme — colors for the renderer to apply to floor/walls/ceiling
  const theme = {
    floorColor:
      colorStringToHex(analysis.floor?.color) ||
      colorStringToHex(analysis.floor?.material) ||
      "#e7d6bf",
    wallColor:
      colorStringToHex(analysis.walls?.primary_color) ||
      colorStringToHex(analysis.walls?.material) ||
      "#f3eee4",
    ceilingColor:
      colorStringToHex(analysis.ceiling?.color) || "#fbf8f1",
    floorMaterial: analysis.floor?.material || "",
    overallStyle: analysis.overall_style || "",
  };

  return {
    layout: { walls, doors, windows, bboxes: [] },
    theme,
  };
}

function toNumber(v, fallback) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
