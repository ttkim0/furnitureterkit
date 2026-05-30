import type { TableSpec } from "../../lib/spec";
import {
  BoolField,
  NumberField,
  SelectField,
  SpecGroup,
} from "../SpecFields";
import { MaterialSelectField } from "../MaterialSelectField";
import { MATERIAL_OPTIONS } from "../../lib/materialMapping";

interface Props {
  spec: TableSpec;
  onChange: (s: TableSpec) => void;
}

const TABLE_TYPES = ["dining", "coffee", "side", "desk", "console"] as const;
const LEG_STYLES = ["straight", "tapered", "turned", "pedestal", "trestle"] as const;

export function TableSpecForm({ spec, onChange }: Props) {
  const set = <K extends keyof TableSpec>(k: K, v: TableSpec[K]) =>
    onChange({ ...spec, [k]: v });
  const setOverall = (k: "width_mm" | "height_mm" | "depth_mm", v: number) =>
    onChange({ ...spec, overall: { ...spec.overall, [k]: v } });

  return (
    <>
      <SpecGroup title="Overall">
        <SelectField label="Table type" value={spec.table_type} options={TABLE_TYPES} onChange={(v) => set("table_type", v)} />
        <NumberField label="Overall width" value={spec.overall.width_mm} onChange={(v) => setOverall("width_mm", v)} />
        <NumberField label="Overall height" value={spec.overall.height_mm} onChange={(v) => setOverall("height_mm", v)} />
        <NumberField label="Overall depth" value={spec.overall.depth_mm} onChange={(v) => setOverall("depth_mm", v)} />
      </SpecGroup>

      <SpecGroup title="Top">
        <NumberField label="Top width" value={spec.top_width_mm} onChange={(v) => set("top_width_mm", v)} />
        <NumberField label="Top depth" value={spec.top_depth_mm} onChange={(v) => set("top_depth_mm", v)} />
        <NumberField label="Top height" value={spec.top_height_mm} onChange={(v) => set("top_height_mm", v)} />
        <NumberField label="Top thickness" value={spec.top_thickness_mm} onChange={(v) => set("top_thickness_mm", v)} />
        <MaterialSelectField label="Top material" value={spec.top_material} options={[...MATERIAL_OPTIONS.wood, ...MATERIAL_OPTIONS.stone, ...MATERIAL_OPTIONS.metal]} onChange={(v) => set("top_material", v)} />
        <MaterialSelectField label="Top finish" value={spec.top_finish} options={MATERIAL_OPTIONS.finish} onChange={(v) => set("top_finish", v)} />
      </SpecGroup>

      <SpecGroup title="Legs">
        <NumberField label="Leg count" value={spec.leg_count} onChange={(v) => set("leg_count", v)} unit="" min={1} max={8} />
        <SelectField label="Leg style" value={spec.leg_style} options={LEG_STYLES} onChange={(v) => set("leg_style", v)} />
        <MaterialSelectField label="Leg material" value={spec.leg_material} options={[...MATERIAL_OPTIONS.wood, ...MATERIAL_OPTIONS.metal]} onChange={(v) => set("leg_material", v)} />
        <BoolField label="Has apron / skirt" value={spec.has_apron} onChange={(v) => set("has_apron", v)} />
      </SpecGroup>
    </>
  );
}
