// Compare two FurnitureSpecs and produce a list of human-readable changes.
// Used by "Rebuild mesh" so OpenAI receives a focused diff prompt
// ("change to 5-seat sofa with 6 cushions; switch frame to walnut") instead
// of a full re-description that would lose the current design.

import type {
  BedSpec,
  ChairSpec,
  FurnitureSpec,
  LampSpec,
  SofaSpec,
  StorageSpec,
  TableSpec,
} from "./spec";

const DIM_THRESHOLD = 0.05; // 5% — only flag dimension changes above this
const SIGNIFICANT_DIM_DELTA_MM = 30; // … OR an absolute jump of 30mm+

function dimChanged(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a !== b;
  if (a === 0 && b === 0) return false;
  const abs = Math.abs(a - b);
  if (abs < SIGNIFICANT_DIM_DELTA_MM) return false;
  const ratio = abs / Math.max(Math.abs(a), Math.abs(b), 1);
  return ratio >= DIM_THRESHOLD;
}

function dimDelta(label: string, a: number | undefined, b: number | undefined): string | null {
  if (!dimChanged(a, b)) return null;
  return `change ${label} to ${b}mm (was ${a}mm)`;
}

function strChanged(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").trim().toLowerCase() !== (b ?? "").trim().toLowerCase();
}

function diffOverall(baseline: FurnitureSpec, current: FurnitureSpec): string[] {
  const out: string[] = [];
  const d1 = dimDelta("overall width", baseline.overall.width_mm, current.overall.width_mm);
  const d2 = dimDelta("overall height", baseline.overall.height_mm, current.overall.height_mm);
  const d3 = dimDelta("overall depth", baseline.overall.depth_mm, current.overall.depth_mm);
  if (d1) out.push(d1);
  if (d2) out.push(d2);
  if (d3) out.push(d3);
  return out;
}

function diffSofa(b: SofaSpec, c: SofaSpec): string[] {
  const out: string[] = [];
  if (b.number_of_seats !== c.number_of_seats)
    out.push(`change to a ${c.number_of_seats}-seat sofa (was ${b.number_of_seats}-seat)`);
  if (b.cushion_count !== c.cushion_count)
    out.push(`use ${c.cushion_count} cushions (was ${b.cushion_count})`);
  const sw = dimDelta("seat width", b.seat_width_mm, c.seat_width_mm);
  const sd = dimDelta("seat depth", b.seat_depth_mm, c.seat_depth_mm);
  const sh = dimDelta("seat height", b.seat_height_mm, c.seat_height_mm);
  const bh = dimDelta("back height", b.back_height_mm, c.back_height_mm);
  if (sw) out.push(sw);
  if (sd) out.push(sd);
  if (sh) out.push(sh);
  if (bh) out.push(bh);
  if (strChanged(b.frame_material, c.frame_material))
    out.push(`switch frame to ${c.frame_material}`);
  if (strChanged(b.fill_material, c.fill_material))
    out.push(`switch fill to ${c.fill_material}`);
  if (strChanged(b.upholstery_material, c.upholstery_material))
    out.push(`switch upholstery to ${c.upholstery_material}`);
  if (strChanged(b.upholstery_color, c.upholstery_color))
    out.push(`change upholstery color to ${c.upholstery_color}`);
  if (strChanged(b.leg_material, c.leg_material))
    out.push(`switch leg material to ${c.leg_material}`);
  return out;
}

function diffChair(b: ChairSpec, c: ChairSpec): string[] {
  const out: string[] = [];
  if (b.chair_type !== c.chair_type)
    out.push(`change to a ${c.chair_type} chair (was ${b.chair_type})`);
  if (b.has_armrests !== c.has_armrests)
    out.push(c.has_armrests ? "add armrests" : "remove armrests");
  if (b.leg_count !== c.leg_count)
    out.push(`use ${c.leg_count} legs (was ${b.leg_count})`);
  const sw = dimDelta("seat width", b.seat_width_mm, c.seat_width_mm);
  const sh = dimDelta("seat height", b.seat_height_mm, c.seat_height_mm);
  const bh = dimDelta("back height", b.back_height_mm, c.back_height_mm);
  if (sw) out.push(sw);
  if (sh) out.push(sh);
  if (bh) out.push(bh);
  if (strChanged(b.frame_material, c.frame_material))
    out.push(`switch frame to ${c.frame_material}`);
  if (strChanged(b.seat_material, c.seat_material))
    out.push(`switch seat material to ${c.seat_material}`);
  if (strChanged(b.back_material, c.back_material))
    out.push(`switch back material to ${c.back_material}`);
  if (strChanged(b.upholstery_color, c.upholstery_color))
    out.push(`change upholstery color to ${c.upholstery_color}`);
  return out;
}

function diffTable(b: TableSpec, c: TableSpec): string[] {
  const out: string[] = [];
  if (b.table_type !== c.table_type)
    out.push(`change to a ${c.table_type} table (was ${b.table_type})`);
  if (b.leg_count !== c.leg_count)
    out.push(`use ${c.leg_count} legs (was ${b.leg_count})`);
  if (b.leg_style !== c.leg_style)
    out.push(`use ${c.leg_style} legs (was ${b.leg_style})`);
  if (b.has_apron !== c.has_apron)
    out.push(c.has_apron ? "add an apron / skirt" : "remove the apron");
  const tw = dimDelta("top width", b.top_width_mm, c.top_width_mm);
  const td = dimDelta("top depth", b.top_depth_mm, c.top_depth_mm);
  const th = dimDelta("top height", b.top_height_mm, c.top_height_mm);
  const tt = dimDelta("top thickness", b.top_thickness_mm, c.top_thickness_mm);
  if (tw) out.push(tw);
  if (td) out.push(td);
  if (th) out.push(th);
  if (tt) out.push(tt);
  if (strChanged(b.top_material, c.top_material))
    out.push(`switch top material to ${c.top_material}`);
  if (strChanged(b.top_finish, c.top_finish))
    out.push(`switch top finish to ${c.top_finish}`);
  if (strChanged(b.leg_material, c.leg_material))
    out.push(`switch leg material to ${c.leg_material}`);
  return out;
}

function diffBed(b: BedSpec, c: BedSpec): string[] {
  const out: string[] = [];
  if (b.mattress_size !== c.mattress_size)
    out.push(`change to ${c.mattress_size.replace(/_/g, " ")} (was ${b.mattress_size.replace(/_/g, " ")})`);
  if (b.has_headboard !== c.has_headboard)
    out.push(c.has_headboard ? "add a headboard" : "remove the headboard");
  if (b.has_footboard !== c.has_footboard)
    out.push(c.has_footboard ? "add a footboard" : "remove the footboard");
  if (b.upholstered_panels !== c.upholstered_panels)
    out.push(c.upholstered_panels ? "add upholstered panels" : "remove upholstered panels");
  if (strChanged(b.frame_material, c.frame_material))
    out.push(`switch frame to ${c.frame_material}`);
  if (strChanged(b.finish, c.finish))
    out.push(`switch finish to ${c.finish}`);
  if (strChanged(b.upholstery_color, c.upholstery_color))
    out.push(`change upholstery color to ${c.upholstery_color}`);
  return out;
}

function diffLamp(b: LampSpec, c: LampSpec): string[] {
  const out: string[] = [];
  if (b.lamp_type !== c.lamp_type)
    out.push(`change to a ${c.lamp_type} lamp (was ${b.lamp_type})`);
  if (b.bulb_count !== c.bulb_count)
    out.push(`use ${c.bulb_count} bulbs (was ${b.bulb_count})`);
  const sd = dimDelta("shade diameter", b.shade_diameter_mm, c.shade_diameter_mm);
  const sh = dimDelta("shade height", b.shade_height_mm, c.shade_height_mm);
  if (sd) out.push(sd);
  if (sh) out.push(sh);
  if (strChanged(b.base_material, c.base_material))
    out.push(`switch base material to ${c.base_material}`);
  if (strChanged(b.shade_material, c.shade_material))
    out.push(`switch shade material to ${c.shade_material}`);
  return out;
}

function diffStorage(b: StorageSpec, c: StorageSpec): string[] {
  const out: string[] = [];
  if (b.storage_type !== c.storage_type)
    out.push(`change to a ${c.storage_type} (was ${b.storage_type})`);
  if (b.shelf_count !== c.shelf_count)
    out.push(`use ${c.shelf_count ?? 0} shelves (was ${b.shelf_count ?? 0})`);
  if (b.drawer_count !== c.drawer_count)
    out.push(`use ${c.drawer_count ?? 0} drawers (was ${b.drawer_count ?? 0})`);
  if (b.door_count !== c.door_count)
    out.push(`use ${c.door_count ?? 0} doors (was ${b.door_count ?? 0})`);
  if (strChanged(b.frame_material, c.frame_material))
    out.push(`switch frame to ${c.frame_material}`);
  if (strChanged(b.finish, c.finish))
    out.push(`switch finish to ${c.finish}`);
  if (strChanged(b.hardware_material, c.hardware_material))
    out.push(`switch hardware to ${c.hardware_material}`);
  return out;
}

export function diffSpec(
  baseline: FurnitureSpec,
  current: FurnitureSpec
): string[] {
  if (baseline.category !== current.category) {
    return [
      `change category to ${current.category} (was ${baseline.category})`,
    ];
  }
  const overall = diffOverall(baseline, current);
  let categorySpecific: string[] = [];
  switch (current.category) {
    case "sofa":
      categorySpecific = diffSofa(baseline as SofaSpec, current);
      break;
    case "chair":
      categorySpecific = diffChair(baseline as ChairSpec, current);
      break;
    case "table":
      categorySpecific = diffTable(baseline as TableSpec, current);
      break;
    case "bed":
      categorySpecific = diffBed(baseline as BedSpec, current);
      break;
    case "lamp":
      categorySpecific = diffLamp(baseline as LampSpec, current);
      break;
    case "storage":
      categorySpecific = diffStorage(baseline as StorageSpec, current);
      break;
  }
  return [...overall, ...categorySpecific];
}
