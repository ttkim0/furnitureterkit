// LLM-backed edit interpreter. Uses Anthropic's Claude with structured tool
// output to translate a user's edit prompt into a {color, scale} mutation.
// If ANTHROPIC_API_KEY is missing or the call fails, the caller should fall
// back to the keyword interpreter — this module surfaces that as a thrown
// LLMUnavailable.

import Anthropic from "@anthropic-ai/sdk";

export class LLMUnavailable extends Error {}

export const ALLOWED_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
];

export const DEFAULT_GENERATION_MODEL = "claude-sonnet-4-6";
export const DEFAULT_EDIT_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_TEMPLATE_ROUTE_MODEL = "claude-haiku-4-5-20251001";

function pickModel(requested, fallback) {
  if (requested && ALLOWED_MODELS.includes(requested)) return requested;
  return fallback;
}

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LLMUnavailable("ANTHROPIC_API_KEY not set");
  }
  _client = new Anthropic();
  return _client;
}

const TOOL = {
  name: "apply_edit",
  description:
    "Apply a styling and/or sizing modification to a single furniture part.",
  input_schema: {
    type: "object",
    properties: {
      color: {
        type: "string",
        description:
          "Hex color in #rrggbb form. Pass the part's current color unchanged if the user did not ask for a color/material change.",
      },
      scale: {
        type: "array",
        items: { type: "number", minimum: 0.2, maximum: 5 },
        minItems: 3,
        maxItems: 3,
        description:
          "Three multipliers [x, y, z] applied to the part's BASE size. 1.0 means unchanged. Compose with the current scale (caller already passes you the current scale). Pass current scale unchanged for axes the user did not ask to modify. Use 1.2-1.5 for 'thicker', 1.5-2.0 for 'much thicker', 0.7-0.85 for 'thinner'. Stay within tasteful furniture proportions.",
      },
    },
    required: ["color", "scale"],
  },
};

const SYSTEM = `You translate furniture-edit instructions into structured part modifications.

You receive ONE part (id, label, current color, current scale multipliers, base size in meters) plus a short user instruction. Call the apply_edit tool exactly once with the new color and scale values.

Rules:
- Always emit BOTH color and scale. Pass current values unchanged for properties the user did not modify.
- Materials map to representative hex colors: walnut #5a3a22 (dark walnut #3d2615), oak #c9a574, marble #e8e6e0 (black marble #1a1a1a), brass #c9a967, gold #d4af37, leather #6b4423, chrome #d0d0d8, matte black #1a1a1a.
- "Thicker" affects the part's THIN axis (its smallest dimension). For legs that's x and z together. "Taller" is y. "Wider" is x. "Longer" or "deeper" is z.
- Be tasteful: realistic furniture proportions. Avoid extreme values unless explicitly asked ("much", "very", "way").`;

export async function interpretEditWithLLM(part, prompt, modelOverride) {
  const client = getClient();
  const model = pickModel(modelOverride, DEFAULT_EDIT_MODEL);

  const userMsg = `Part: ${part.id} (${part.label})
Current color: ${part.color}
Current scale (multipliers from base): [${part.scale.join(", ")}]
Base size in meters [x, y, z]: [${part.size.join(", ")}]

Edit instruction: ${prompt}`;

  const response = await client.messages.create({
    model,
    max_tokens: 256,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "apply_edit" },
    messages: [{ role: "user", content: userMsg }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("LLM did not return a tool_use block");
  }
  const { color, scale } = toolUse.input;
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`LLM returned invalid color: ${JSON.stringify(color)}`);
  }
  if (
    !Array.isArray(scale) ||
    scale.length !== 3 ||
    !scale.every((n) => typeof n === "number" && isFinite(n) && n > 0)
  ) {
    throw new Error(`LLM returned invalid scale: ${JSON.stringify(scale)}`);
  }
  return { color, scale };
}

export function isLLMConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const BUILD_MODEL_SYSTEM = `You build 3D models out of primitive parts. The user describes an object (and optionally attaches a reference image); you call build_model with a list of parts.

If a reference image is attached, treat it as the source of truth for shape, proportions, and color. The text prompt is supplementary. Reproduce the silhouette, mass distribution, and palette of the pictured object as best you can with the available primitives — it's fine to approximate organic surfaces with clusters of spheres or stacks of boxes/cylinders.

Each part is one of these primitives:
- "box": rectangular cuboid
- "cylinder": cylinder along the Y (vertical) axis
- "sphere": sphere (or ellipsoid via different size dimensions)
- "cone": cone along the Y axis, base on the bottom, tip pointing up

Each part has:
- id: snake_case unique identifier within this model (e.g. "left_leg", "lamp_shade")
- label: short human-readable name shown in the editor (e.g. "Left leg")
- shape: one of box/cylinder/sphere/cone
- position [x, y, z]: world center of the part in meters. y=0 is the floor; +y is up.
- size [x, y, z]: bounding-box extent in meters. For cylinder/cone use [diameter, height, diameter]; for sphere use [diameter, diameter, diameter] (or different values for an ellipsoid).
- color: 6-digit hex color "#rrggbb"
- anchor [a, a, a] where each a ∈ {-1, 0, 1}: which face of the part stays put when the user later edits its scale. -1 = min face stays put (e.g. legs use [0,-1,0] so "taller" grows upward), +1 = max face, 0 = center. Default to [0,-1,0] for floor-resting parts so they grow up rather than through the floor.

Rules:
- Build with 3–25 primitives. Most everyday objects are recognizable with under 15.
- Use realistic dimensions in meters: furniture spans 0.3–2.5m, tableware 0.05–0.3m, decor 0.1–1m.
- Pick representative hex colors. Examples: wood #5a3a22 / #7a5634, oak #c9a574, marble #e8e6e0, brass #c9a967, gold #d4af37, leather #6b4423, fabric #d8d0c4, metal #a0a0a8, chrome #d0d0d8, white #f5f5f0, black #1a1a1a, glass #c8e0e8.
- Ensure the model rests on or near the floor (some part touches y≈0). Avoid floating parts unless intentional (e.g. hanging lamp).
- Parts may overlap slightly for joinery; avoid large overlaps.

Output exactly one tool call to build_model.`;

const PICK_TEMPLATE_SYSTEM = `Pick the best matching furniture template for the user's request. Choose the closest match from the provided list. Reply with one tool call to pick_template.`;

const BUILD_MODEL_TOOL = {
  name: "build_model",
  description:
    "Emit a 3D model as a list of primitive parts assembled into a recognizable object.",
  input_schema: {
    type: "object",
    properties: {
      parts: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              pattern: "^[a-z][a-z0-9_]*$",
              description: "snake_case identifier, unique within the model",
            },
            label: { type: "string" },
            shape: {
              type: "string",
              enum: ["box", "cylinder", "sphere", "cone"],
            },
            position: {
              type: "array",
              items: { type: "number" },
              minItems: 3,
              maxItems: 3,
            },
            size: {
              type: "array",
              items: { type: "number", minimum: 0.005, maximum: 6 },
              minItems: 3,
              maxItems: 3,
            },
            color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
            anchor: {
              type: "array",
              items: { type: "number", minimum: -1, maximum: 1 },
              minItems: 3,
              maxItems: 3,
            },
          },
          required: ["id", "label", "shape", "position", "size", "color", "anchor"],
        },
      },
    },
    required: ["parts"],
  },
};

function validatePartsForRender(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error("parts must be a non-empty array");
  }
  const seen = new Set();
  for (const p of parts) {
    if (!p.id || seen.has(p.id)) {
      throw new Error(`duplicate or missing id: ${JSON.stringify(p.id)}`);
    }
    seen.add(p.id);
    for (const axis of ["position", "size", "anchor"]) {
      if (
        !Array.isArray(p[axis]) ||
        p[axis].length !== 3 ||
        !p[axis].every((n) => typeof n === "number" && isFinite(n))
      ) {
        throw new Error(`part ${p.id} has invalid ${axis}: ${JSON.stringify(p[axis])}`);
      }
    }
    if (!p.size.every((n) => n > 0)) {
      throw new Error(`part ${p.id} has non-positive size`);
    }
    if (!["box", "cylinder", "sphere", "cone"].includes(p.shape)) {
      throw new Error(`part ${p.id} has unknown shape: ${p.shape}`);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(p.color)) {
      throw new Error(`part ${p.id} has invalid color: ${p.color}`);
    }
  }
}

let freeformCounter = 0;
function freeformId() {
  return `freeform-${++freeformCounter}-${Date.now()}`;
}

// ─── Raw-SCAD generation (Max Quality mode) ───────────────────────────────
// LLM emits a complete OpenSCAD program directly. This unlocks loops, hull,
// minkowski and the full SCAD ecosystem — same approach CADAM uses. Trade:
// no clickable parts, edits regenerate from a refined prompt.

const BUILD_SCAD_SYSTEM = `You write OpenSCAD source for 3D models. The user describes an object (and may attach a reference image). Call build_scad with a complete OpenSCAD program.

Use the full language:
- Primitives: cube, sphere, cylinder, polyhedron
- Operations: union (auto), difference, intersection, hull, minkowski, translate, rotate, scale, mirror, color
- Structures: for loops, module() definitions, parameters

Rules:
- Use meters consistently. Furniture spans 0.3–2.5 m. Place ground at y=0 (or z=0 — pick one and stick with it; OpenSCAD's Z is up by default, use Z up).
- ALWAYS prefix every top-level primitive (or group) with color([r,g,b]) where each value is in [0,1]. With --enable=lazy-union, top-level objects keep separate colors in the OFF preview.
- Set high $fn at the top of the file ($fn=64 or higher) so curves are smooth. For organic forms aim for $fn=80-128.
- For organic forms (puffy sofas, vases, sculpted seats): use clusters of spheres + hull() to smoothly blend adjacent spheres. Loops let you place 50–500 spheres in 5 lines.
- For chamfered/rounded edges on rectilinear forms: use minkowski() with a small sphere.
- Use module() for reusable parts (a single bubble, a single leg, etc).
- Aim for 50–500 primitives in the output for high-quality results. Fewer is fine for very simple objects.
- Compile time of 30s–5min is acceptable. Don't sacrifice fidelity to be fast.

If a reference image is attached, match its silhouette, proportions, and color faithfully. Use hull() and clusters of spheres to approximate organic surfaces — that's how CADAM-style outputs reproduce things like bubble sofas.

Output exactly one tool call to build_scad. The 'scad' field must be a complete, compilable OpenSCAD program (no markdown fences).`;

const BUILD_SCAD_TOOL = {
  name: "build_scad",
  description:
    "Emit a complete OpenSCAD program that builds the requested 3D object. Will be compiled by openscad-wasm with --backend=manifold --enable=lazy-union.",
  input_schema: {
    type: "object",
    properties: {
      scad: {
        type: "string",
        description:
          "Complete OpenSCAD source code, no markdown fences, no commentary outside SCAD comments.",
      },
    },
    required: ["scad"],
  },
};

let scadCounter = 0;
function scadModelId() {
  return `scad-${++scadCounter}-${Date.now()}`;
}

export async function generateScadWithLLM(prompt, image, modelOverride, qualityPreset) {
  const client = getClient();
  // Default to Opus for raw SCAD — it's the right model for code/spatial reasoning.
  const fallback =
    qualityPreset === "max" ? "claude-opus-4-7" : DEFAULT_GENERATION_MODEL;
  const model = pickModel(modelOverride, fallback);

  const userContent = [];
  if (image) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    });
    userContent.push({
      type: "text",
      text: prompt && prompt.trim()
        ? `Reference image above. Generate OpenSCAD that recreates the object — match silhouette, proportions, color. Additional notes:\n\n${prompt}`
        : "Reference image above. Generate OpenSCAD that recreates the object — match silhouette, proportions, color as faithfully as you can.",
    });
  } else {
    userContent.push({ type: "text", text: prompt });
  }

  const response = await client.messages.create({
    model,
    max_tokens: qualityPreset === "max" ? 16000 : 4096,
    system: BUILD_SCAD_SYSTEM,
    tools: [BUILD_SCAD_TOOL],
    tool_choice: { type: "tool", name: "build_scad" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("LLM did not return a tool_use block");
  const { scad } = toolUse.input;
  if (typeof scad !== "string" || scad.trim().length < 10) {
    throw new Error(`LLM returned invalid SCAD: ${JSON.stringify(scad)?.slice(0, 200)}`);
  }

  return {
    id: scadModelId(),
    template: image ? "scad-image" : "scad",
    prompt,
    mode: "scad",
    parts: [],
    scad,
    generation_model: model,
    quality_preset: qualityPreset ?? "max",
  };
}

export async function generateModelWithLLM(prompt, image, modelOverride) {
  const client = getClient();
  const model = pickModel(modelOverride, DEFAULT_GENERATION_MODEL);

  const userContent = [];
  if (image) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    });
    userContent.push({
      type: "text",
      text: prompt && prompt.trim()
        ? `Reference image above. Build a 3D model matching the object shown — match the silhouette, proportions, and color. Additional notes from the user:\n\n${prompt}`
        : `Reference image above. Build a 3D model matching the object shown — match the silhouette, proportions, and color as closely as you can with the available primitives.`,
    });
  } else {
    userContent.push({ type: "text", text: prompt });
  }

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: BUILD_MODEL_SYSTEM,
    tools: [BUILD_MODEL_TOOL],
    tool_choice: { type: "tool", name: "build_model" },
    messages: [{ role: "user", content: userContent }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("LLM did not return a tool_use block");
  const { parts } = toolUse.input;
  validatePartsForRender(parts);

  const normalized = parts.map((p) => ({
    ...p,
    scale: [1, 1, 1],
  }));

  return {
    id: freeformId(),
    template: image ? "llm-freeform-image" : "llm-freeform",
    prompt,
    parts: normalized,
    generation_model: model,
  };
}

export async function pickTemplateWithLLM(prompt, availableTemplates, modelOverride) {
  const client = getClient();
  const model = pickModel(modelOverride, DEFAULT_TEMPLATE_ROUTE_MODEL);

  const tool = {
    name: "pick_template",
    description: "Choose the best furniture template for the user prompt.",
    input_schema: {
      type: "object",
      properties: {
        template: {
          type: "string",
          enum: availableTemplates,
          description: "The chosen template id.",
        },
      },
      required: ["template"],
    },
  };

  const response = await client.messages.create({
    model,
    max_tokens: 128,
    system: PICK_TEMPLATE_SYSTEM,
    tools: [tool],
    tool_choice: { type: "tool", name: "pick_template" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("LLM did not return a tool_use block");
  const { template } = toolUse.input;
  if (!availableTemplates.includes(template)) {
    throw new Error(`LLM returned unknown template: ${JSON.stringify(template)}`);
  }
  return template;
}
