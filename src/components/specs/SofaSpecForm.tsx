import type { SofaSpec } from "../../lib/spec";
import {
  BoolField,
  ColorField,
  NumberField,
  SpecGroup,
} from "../SpecFields";
import { MaterialSelectField } from "../MaterialSelectField";
import { MATERIAL_OPTIONS } from "../../lib/materialMapping";

interface Props {
  spec: SofaSpec;
  onChange: (s: SofaSpec) => void;
}

export function SofaSpecForm({ spec, onChange }: Props) {
  const set = <K extends keyof SofaSpec>(k: K, v: SofaSpec[K]) =>
    onChange({ ...spec, [k]: v });
  const setOverall = (k: "width_mm" | "height_mm" | "depth_mm", v: number) =>
    onChange({ ...spec, overall: { ...spec.overall, [k]: v } });

  return (
    <>
      <SpecGroup title="Overall">
        <NumberField label="Width" value={spec.overall.width_mm} onChange={(v) => setOverall("width_mm", v)} />
        <NumberField label="Height" value={spec.overall.height_mm} onChange={(v) => setOverall("height_mm", v)} />
        <NumberField label="Depth" value={spec.overall.depth_mm} onChange={(v) => setOverall("depth_mm", v)} />
        <NumberField label="Weight (est.)" value={spec.overall.weight_kg_estimate} onChange={(v) => onChange({ ...spec, overall: { ...spec.overall, weight_kg_estimate: v } })} unit="kg" step={1} />
      </SpecGroup>

      <SpecGroup title="Seat">
        <NumberField label="Seat width" value={spec.seat_width_mm} onChange={(v) => set("seat_width_mm", v)} />
        <NumberField label="Seat depth" value={spec.seat_depth_mm} onChange={(v) => set("seat_depth_mm", v)} />
        <NumberField label="Seat height" value={spec.seat_height_mm} onChange={(v) => set("seat_height_mm", v)} />
        <NumberField label="Number of seats" value={spec.number_of_seats} onChange={(v) => set("number_of_seats", v)} unit="" min={1} max={12} />
        <NumberField label="Cushion count" value={spec.cushion_count} onChange={(v) => set("cushion_count", v)} unit="" min={0} max={20} />
      </SpecGroup>

      <SpecGroup title="Back & Arms">
        <NumberField label="Back height" value={spec.back_height_mm} onChange={(v) => set("back_height_mm", v)} />
        <NumberField label="Arm height" value={spec.arm_height_mm} onChange={(v) => set("arm_height_mm", v)} />
        <NumberField label="Arm width" value={spec.arm_width_mm} onChange={(v) => set("arm_width_mm", v)} />
      </SpecGroup>

      <SpecGroup title="Legs">
        <NumberField label="Leg count" value={spec.leg_count} onChange={(v) => set("leg_count", v)} unit="" min={0} max={12} />
        <NumberField label="Leg height" value={spec.leg_height_mm} onChange={(v) => set("leg_height_mm", v)} />
        <MaterialSelectField label="Leg material" value={spec.leg_material} options={MATERIAL_OPTIONS.wood} onChange={(v) => set("leg_material", v)} />
      </SpecGroup>

      <SpecGroup title="Materials">
        <MaterialSelectField label="Frame" value={spec.frame_material} options={MATERIAL_OPTIONS.wood} onChange={(v) => set("frame_material", v)} />
        <MaterialSelectField label="Fill" value={spec.fill_material} options={MATERIAL_OPTIONS.fill} onChange={(v) => set("fill_material", v)} />
        <MaterialSelectField label="Upholstery" value={spec.upholstery_material} options={MATERIAL_OPTIONS.upholstery} onChange={(v) => set("upholstery_material", v)} />
        <ColorField label="Upholstery color" value={spec.upholstery_color} onChange={(v) => set("upholstery_color", v)} />
        <BoolField label="Has armrests" value={spec.arm_height_mm !== undefined && spec.arm_height_mm > 0} onChange={(v) => set("arm_height_mm", v ? (spec.arm_height_mm ?? 600) : undefined)} />
      </SpecGroup>
    </>
  );
}
