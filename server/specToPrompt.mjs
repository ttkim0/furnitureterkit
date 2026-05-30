// Synthesize a natural-language prompt from a FurnitureSpec so the
// "Rebuild mesh" flow can re-run OpenAI image-edit + Hunyuan with the
// user's spec changes baked into the description.

export function specToPrompt(originalPrompt, spec) {
  const dims = spec.overall;
  const dimStr = `${(dims.width_mm / 10).toFixed(0)}cm wide × ${(dims.height_mm / 10).toFixed(0)}cm tall × ${(dims.depth_mm / 10).toFixed(0)}cm deep`;

  let categoryDetails = "";
  switch (spec.category) {
    case "sofa": {
      const arms = spec.arm_height_mm && spec.arm_height_mm > 0 ? "with armrests" : "armless";
      categoryDetails = `${spec.number_of_seats}-seat sofa, ${spec.cushion_count} cushions, ${arms}. Frame: ${spec.frame_material}. Fill: ${spec.fill_material}. Upholstery: ${spec.upholstery_material} in ${spec.upholstery_color}.`;
      break;
    }
    case "chair": {
      categoryDetails = `${spec.chair_type} chair on ${spec.leg_count} legs. Frame: ${spec.frame_material}. Seat: ${spec.seat_material}. Back: ${spec.back_material}.`;
      if (spec.has_armrests) categoryDetails += ` With armrests.`;
      if (spec.upholstery_color) categoryDetails += ` Upholstery color: ${spec.upholstery_color}.`;
      break;
    }
    case "table": {
      const apron = spec.has_apron ? "with apron" : "no apron";
      categoryDetails = `${spec.table_type} table, ${spec.leg_count}-leg ${spec.leg_style} base. Top: ${spec.top_material} with ${spec.top_finish} finish. Legs: ${spec.leg_material}. ${apron}.`;
      break;
    }
    case "bed": {
      const head = spec.has_headboard ? `headboard ${spec.headboard_height_mm ?? "?"}mm tall` : "no headboard";
      const foot = spec.has_footboard ? `footboard ${spec.footboard_height_mm ?? "?"}mm tall` : "no footboard";
      const uph = spec.upholstered_panels ? ` Upholstered panels in ${spec.upholstery_color}.` : "";
      categoryDetails = `${spec.mattress_size} bed (${spec.mattress_width_mm}×${spec.mattress_length_mm}mm). ${head}, ${foot}. Frame: ${spec.frame_material}, ${spec.finish}.${uph}`;
      break;
    }
    case "lamp": {
      categoryDetails = `${spec.lamp_type} lamp. Shade: ${spec.shade_material}, ${spec.shade_diameter_mm}mm diameter × ${spec.shade_height_mm}mm tall. Base: ${spec.base_material}. ${spec.bulb_count} × ${spec.bulb_socket} bulb up to ${spec.max_wattage}W.`;
      break;
    }
    case "storage": {
      const compartments = [];
      if (spec.shelf_count) compartments.push(`${spec.shelf_count} shelves`);
      if (spec.drawer_count) compartments.push(`${spec.drawer_count} drawers`);
      if (spec.door_count) compartments.push(`${spec.door_count} doors`);
      categoryDetails = `${spec.storage_type}${compartments.length ? " with " + compartments.join(", ") : ""}. Frame: ${spec.frame_material}, ${spec.finish} finish. Hardware: ${spec.hardware_material}.`;
      break;
    }
  }

  return `${originalPrompt}. ${dimStr}. ${categoryDetails}${spec.notes ? " Notes: " + spec.notes : ""}`;
}
