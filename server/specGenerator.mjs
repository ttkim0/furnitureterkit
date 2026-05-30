// Generate a typed furniture spec from a prompt + GLB bbox + (optional) image.
// One Anthropic call returns the right shape for the chosen category. Server
// validates the result before handing back to the client.

import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `You generate manufacturer-ready furniture specifications.

You are given:
- A description of the piece (the user's prompt)
- The exact bounding-box dimensions of the 3D mesh in millimeters
- Optionally a reference image

Pick the right category from {sofa, chair, table, bed, lamp, storage}, then fill in the typed fields for that category. Use millimeters for all dimensions.

Rules:
- Use the bounding box as the source of truth for overall_width / overall_height / overall_depth — it's measured from the actual mesh.
- For internal dimensions (seat_height, leg_height, headboard_height, etc.), use realistic furniture proportions consistent with the bounding box and the piece's style.
- Fill EVERY required field for the chosen category. The tool's input schema enforces this.
- Material fields use plain English ("Oak", "Brushed brass", "Polyester knit fabric"). Be specific where the prompt or image suggests it.
- For colors, use hex like "#5a3a22".
- Don't over-explain — notes should be 1–2 sentences max if you include them.`;

const OVERALL_PROPS = {
  width_mm: { type: "number", minimum: 50, maximum: 5000 },
  height_mm: { type: "number", minimum: 50, maximum: 5000 },
  depth_mm: { type: "number", minimum: 50, maximum: 5000 },
  weight_kg_estimate: { type: "number", minimum: 0.1, maximum: 1000 },
};

const SPEC_TOOL = {
  name: "generate_spec",
  description:
    "Generate a typed furniture specification. Pick the category, then fill in only the fields object matching that category.",
  input_schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["sofa", "chair", "table", "bed", "lamp", "storage"],
      },
      overall: {
        type: "object",
        properties: OVERALL_PROPS,
        required: ["width_mm", "height_mm", "depth_mm"],
      },
      primary_material: { type: "string" },
      notes: { type: "string" },
      sofa: {
        type: "object",
        properties: {
          seat_width_mm: { type: "number" },
          seat_depth_mm: { type: "number" },
          seat_height_mm: { type: "number" },
          back_height_mm: { type: "number" },
          arm_height_mm: { type: "number" },
          arm_width_mm: { type: "number" },
          number_of_seats: { type: "integer", minimum: 1, maximum: 12 },
          cushion_count: { type: "integer", minimum: 0, maximum: 20 },
          frame_material: { type: "string" },
          fill_material: { type: "string" },
          upholstery_material: { type: "string" },
          upholstery_color: { type: "string" },
          leg_material: { type: "string" },
          leg_count: { type: "integer", minimum: 0, maximum: 12 },
          leg_height_mm: { type: "number" },
        },
        required: [
          "seat_width_mm", "seat_depth_mm", "seat_height_mm",
          "back_height_mm", "number_of_seats", "cushion_count",
          "frame_material", "fill_material", "upholstery_material", "upholstery_color",
        ],
      },
      chair: {
        type: "object",
        properties: {
          chair_type: { type: "string", enum: ["dining", "lounge", "office", "stool", "armchair", "rocking"] },
          seat_width_mm: { type: "number" },
          seat_depth_mm: { type: "number" },
          seat_height_mm: { type: "number" },
          back_height_mm: { type: "number" },
          has_armrests: { type: "boolean" },
          arm_height_mm: { type: "number" },
          leg_count: { type: "integer", minimum: 1, maximum: 8 },
          leg_height_mm: { type: "number" },
          frame_material: { type: "string" },
          seat_material: { type: "string" },
          back_material: { type: "string" },
          upholstery_color: { type: "string" },
        },
        required: [
          "chair_type", "seat_width_mm", "seat_depth_mm", "seat_height_mm",
          "back_height_mm", "has_armrests", "leg_count", "leg_height_mm",
          "frame_material", "seat_material", "back_material",
        ],
      },
      table: {
        type: "object",
        properties: {
          table_type: { type: "string", enum: ["dining", "coffee", "side", "desk", "console"] },
          top_width_mm: { type: "number" },
          top_depth_mm: { type: "number" },
          top_height_mm: { type: "number" },
          top_thickness_mm: { type: "number" },
          top_material: { type: "string" },
          top_finish: { type: "string" },
          leg_count: { type: "integer", minimum: 1, maximum: 8 },
          leg_style: { type: "string", enum: ["straight", "tapered", "turned", "pedestal", "trestle"] },
          leg_material: { type: "string" },
          has_apron: { type: "boolean" },
        },
        required: [
          "table_type", "top_width_mm", "top_depth_mm", "top_height_mm",
          "top_thickness_mm", "top_material", "top_finish", "leg_count",
          "leg_style", "leg_material", "has_apron",
        ],
      },
      bed: {
        type: "object",
        properties: {
          mattress_size: { type: "string", enum: ["twin", "twin_xl", "full", "queen", "king", "california_king", "custom"] },
          mattress_width_mm: { type: "number" },
          mattress_length_mm: { type: "number" },
          mattress_height_mm: { type: "number" },
          frame_height_mm: { type: "number" },
          has_headboard: { type: "boolean" },
          headboard_height_mm: { type: "number" },
          has_footboard: { type: "boolean" },
          footboard_height_mm: { type: "number" },
          frame_material: { type: "string" },
          finish: { type: "string" },
          upholstered_panels: { type: "boolean" },
          upholstery_color: { type: "string" },
        },
        required: [
          "mattress_size", "mattress_width_mm", "mattress_length_mm",
          "mattress_height_mm", "frame_height_mm",
          "has_headboard", "has_footboard", "frame_material", "finish", "upholstered_panels",
        ],
      },
      lamp: {
        type: "object",
        properties: {
          lamp_type: { type: "string", enum: ["table", "floor", "pendant", "wall_sconce", "desk"] },
          base_diameter_mm: { type: "number" },
          shade_diameter_mm: { type: "number" },
          shade_height_mm: { type: "number" },
          pole_height_mm: { type: "number" },
          bulb_count: { type: "integer", minimum: 1, maximum: 12 },
          bulb_socket: { type: "string", enum: ["E26", "E27", "E12", "E14", "GU10", "other"] },
          max_wattage: { type: "number" },
          base_material: { type: "string" },
          shade_material: { type: "string" },
          cord_length_mm: { type: "number" },
        },
        required: [
          "lamp_type", "shade_diameter_mm", "shade_height_mm",
          "bulb_count", "bulb_socket", "max_wattage",
          "base_material", "shade_material",
        ],
      },
      storage: {
        type: "object",
        properties: {
          storage_type: { type: "string", enum: ["shelf", "cabinet", "dresser", "wardrobe", "bookcase", "sideboard"] },
          shelf_count: { type: "integer", minimum: 0, maximum: 20 },
          drawer_count: { type: "integer", minimum: 0, maximum: 20 },
          door_count: { type: "integer", minimum: 0, maximum: 12 },
          drawer_dimensions_mm: {
            type: "object",
            properties: {
              width: { type: "number" },
              depth: { type: "number" },
              height: { type: "number" },
            },
          },
          shelf_spacing_mm: { type: "number" },
          frame_material: { type: "string" },
          finish: { type: "string" },
          hardware_material: { type: "string" },
          back_panel_material: { type: "string" },
        },
        required: [
          "storage_type", "frame_material", "finish", "hardware_material",
        ],
      },
    },
    required: ["category", "overall", "primary_material"],
  },
};

let _client = null;
function getClient() {
  if (_client) return _client;
  _client = new Anthropic();
  return _client;
}

export async function generateSpec({ prompt, bboxMm, image, model }) {
  const client = getClient();
  const usedModel = model || "claude-sonnet-4-6";

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
  }
  userContent.push({
    type: "text",
    text: `Description: ${prompt}

Mesh bounding box (use as truth for overall dimensions):
  width:  ${bboxMm.width_mm.toFixed(0)} mm
  height: ${bboxMm.height_mm.toFixed(0)} mm
  depth:  ${bboxMm.depth_mm.toFixed(0)} mm

Generate a manufacturer-ready spec. Pick the category, then call the tool with the matching fields object.`,
  });

  const response = await client.messages.create({
    model: usedModel,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [SPEC_TOOL],
    tool_choice: { type: "tool", name: "generate_spec" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("LLM did not return tool_use");
  const data = toolUse.input;

  const cat = data.category;
  if (!["sofa", "chair", "table", "bed", "lamp", "storage"].includes(cat)) {
    throw new Error(`unknown category from LLM: ${cat}`);
  }
  const fields = data[cat];
  if (!fields || typeof fields !== "object") {
    throw new Error(`LLM did not provide '${cat}' fields object`);
  }

  // Flatten: { category, overall, primary_material, notes, ...categoryFields }
  return {
    category: cat,
    overall: data.overall,
    primary_material: data.primary_material,
    notes: data.notes,
    ...fields,
    _generated_by: usedModel,
    _generated_at: new Date().toISOString(),
  };
}
