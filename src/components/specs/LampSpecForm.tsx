import type { LampSpec } from "../../lib/spec";
import {
  NumberField,
  SelectField,
  SpecGroup,
} from "../SpecFields";
import { MaterialSelectField } from "../MaterialSelectField";
import { MATERIAL_OPTIONS } from "../../lib/materialMapping";

interface Props {
  spec: LampSpec;
  onChange: (s: LampSpec) => void;
}

const LAMP_TYPES = ["table", "floor", "pendant", "wall_sconce", "desk"] as const;
const SOCKETS = ["E26", "E27", "E12", "E14", "GU10", "other"] as const;

export function LampSpecForm({ spec, onChange }: Props) {
  const set = <K extends keyof LampSpec>(k: K, v: LampSpec[K]) =>
    onChange({ ...spec, [k]: v });
  const setOverall = (k: "width_mm" | "height_mm" | "depth_mm", v: number) =>
    onChange({ ...spec, overall: { ...spec.overall, [k]: v } });

  return (
    <>
      <SpecGroup title="Overall">
        <SelectField label="Lamp type" value={spec.lamp_type} options={LAMP_TYPES} onChange={(v) => set("lamp_type", v)} />
        <NumberField label="Width" value={spec.overall.width_mm} onChange={(v) => setOverall("width_mm", v)} />
        <NumberField label="Height" value={spec.overall.height_mm} onChange={(v) => setOverall("height_mm", v)} />
        <NumberField label="Depth" value={spec.overall.depth_mm} onChange={(v) => setOverall("depth_mm", v)} />
      </SpecGroup>

      <SpecGroup title="Shade & Pole">
        <NumberField label="Shade diameter" value={spec.shade_diameter_mm} onChange={(v) => set("shade_diameter_mm", v)} />
        <NumberField label="Shade height" value={spec.shade_height_mm} onChange={(v) => set("shade_height_mm", v)} />
        {spec.lamp_type !== "pendant" && spec.lamp_type !== "wall_sconce" && (
          <NumberField label="Base diameter" value={spec.base_diameter_mm} onChange={(v) => set("base_diameter_mm", v)} />
        )}
        {(spec.lamp_type === "floor" || spec.lamp_type === "table" || spec.lamp_type === "desk") && (
          <NumberField label="Pole height" value={spec.pole_height_mm} onChange={(v) => set("pole_height_mm", v)} />
        )}
      </SpecGroup>

      <SpecGroup title="Electrical">
        <NumberField label="Bulb count" value={spec.bulb_count} onChange={(v) => set("bulb_count", v)} unit="" min={1} max={12} />
        <SelectField label="Bulb socket" value={spec.bulb_socket} options={SOCKETS} onChange={(v) => set("bulb_socket", v)} />
        <NumberField label="Max wattage per bulb" value={spec.max_wattage} onChange={(v) => set("max_wattage", v)} unit="W" />
        <NumberField label="Cord length" value={spec.cord_length_mm} onChange={(v) => set("cord_length_mm", v)} />
      </SpecGroup>

      <SpecGroup title="Materials">
        <MaterialSelectField label="Base material" value={spec.base_material} options={[...MATERIAL_OPTIONS.metal, ...MATERIAL_OPTIONS.wood]} onChange={(v) => set("base_material", v)} />
        <MaterialSelectField label="Shade material" value={spec.shade_material} options={MATERIAL_OPTIONS.upholstery} onChange={(v) => set("shade_material", v)} />
      </SpecGroup>
    </>
  );
}
