import type { ChairSpec } from "../../lib/spec";
import {
  BoolField,
  ColorField,
  NumberField,
  SelectField,
  SpecGroup,
} from "../SpecFields";
import { MaterialSelectField } from "../MaterialSelectField";
import { MATERIAL_OPTIONS } from "../../lib/materialMapping";

interface Props {
  spec: ChairSpec;
  onChange: (s: ChairSpec) => void;
}

const CHAIR_TYPES = ["dining", "lounge", "office", "stool", "armchair", "rocking"] as const;

export function ChairSpecForm({ spec, onChange }: Props) {
  const set = <K extends keyof ChairSpec>(k: K, v: ChairSpec[K]) =>
    onChange({ ...spec, [k]: v });
  const setOverall = (k: "width_mm" | "height_mm" | "depth_mm", v: number) =>
    onChange({ ...spec, overall: { ...spec.overall, [k]: v } });

  return (
    <>
      <SpecGroup title="Overall">
        <SelectField label="Chair type" value={spec.chair_type} options={CHAIR_TYPES} onChange={(v) => set("chair_type", v)} />
        <NumberField label="Width" value={spec.overall.width_mm} onChange={(v) => setOverall("width_mm", v)} />
        <NumberField label="Height" value={spec.overall.height_mm} onChange={(v) => setOverall("height_mm", v)} />
        <NumberField label="Depth" value={spec.overall.depth_mm} onChange={(v) => setOverall("depth_mm", v)} />
      </SpecGroup>

      <SpecGroup title="Seat & Back">
        <NumberField label="Seat width" value={spec.seat_width_mm} onChange={(v) => set("seat_width_mm", v)} />
        <NumberField label="Seat depth" value={spec.seat_depth_mm} onChange={(v) => set("seat_depth_mm", v)} />
        <NumberField label="Seat height" value={spec.seat_height_mm} onChange={(v) => set("seat_height_mm", v)} />
        <NumberField label="Back height" value={spec.back_height_mm} onChange={(v) => set("back_height_mm", v)} />
      </SpecGroup>

      <SpecGroup title="Legs & Arms">
        <NumberField label="Leg count" value={spec.leg_count} onChange={(v) => set("leg_count", v)} unit="" min={1} max={8} />
        <NumberField label="Leg height" value={spec.leg_height_mm} onChange={(v) => set("leg_height_mm", v)} />
        <BoolField label="Has armrests" value={spec.has_armrests} onChange={(v) => set("has_armrests", v)} />
        {spec.has_armrests && (
          <NumberField label="Arm height" value={spec.arm_height_mm} onChange={(v) => set("arm_height_mm", v)} />
        )}
      </SpecGroup>

      <SpecGroup title="Materials">
        <MaterialSelectField label="Frame" value={spec.frame_material} options={MATERIAL_OPTIONS.wood} onChange={(v) => set("frame_material", v)} />
        <MaterialSelectField label="Seat material" value={spec.seat_material} options={MATERIAL_OPTIONS.upholstery} onChange={(v) => set("seat_material", v)} />
        <MaterialSelectField label="Back material" value={spec.back_material} options={MATERIAL_OPTIONS.upholstery} onChange={(v) => set("back_material", v)} />
        <ColorField label="Upholstery color" value={spec.upholstery_color} onChange={(v) => set("upholstery_color", v)} />
      </SpecGroup>
    </>
  );
}
