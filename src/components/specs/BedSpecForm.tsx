import type { BedSpec } from "../../lib/spec";
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
  spec: BedSpec;
  onChange: (s: BedSpec) => void;
}

const SIZES = ["twin", "twin_xl", "full", "queen", "king", "california_king", "custom"] as const;

const formatSize = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function BedSpecForm({ spec, onChange }: Props) {
  const set = <K extends keyof BedSpec>(k: K, v: BedSpec[K]) =>
    onChange({ ...spec, [k]: v });
  const setOverall = (k: "width_mm" | "height_mm" | "depth_mm", v: number) =>
    onChange({ ...spec, overall: { ...spec.overall, [k]: v } });

  return (
    <>
      <SpecGroup title="Overall">
        <NumberField label="Width" value={spec.overall.width_mm} onChange={(v) => setOverall("width_mm", v)} />
        <NumberField label="Height" value={spec.overall.height_mm} onChange={(v) => setOverall("height_mm", v)} />
        <NumberField label="Depth (length)" value={spec.overall.depth_mm} onChange={(v) => setOverall("depth_mm", v)} />
      </SpecGroup>

      <SpecGroup title="Mattress">
        <SelectField label="Standard size" value={spec.mattress_size} options={SIZES} onChange={(v) => set("mattress_size", v)} formatOption={formatSize} />
        <NumberField label="Mattress width" value={spec.mattress_width_mm} onChange={(v) => set("mattress_width_mm", v)} />
        <NumberField label="Mattress length" value={spec.mattress_length_mm} onChange={(v) => set("mattress_length_mm", v)} />
        <NumberField label="Mattress height" value={spec.mattress_height_mm} onChange={(v) => set("mattress_height_mm", v)} />
        <NumberField label="Frame height" value={spec.frame_height_mm} onChange={(v) => set("frame_height_mm", v)} />
      </SpecGroup>

      <SpecGroup title="Headboard / Footboard">
        <BoolField label="Has headboard" value={spec.has_headboard} onChange={(v) => set("has_headboard", v)} />
        {spec.has_headboard && (
          <NumberField label="Headboard height" value={spec.headboard_height_mm} onChange={(v) => set("headboard_height_mm", v)} />
        )}
        <BoolField label="Has footboard" value={spec.has_footboard} onChange={(v) => set("has_footboard", v)} />
        {spec.has_footboard && (
          <NumberField label="Footboard height" value={spec.footboard_height_mm} onChange={(v) => set("footboard_height_mm", v)} />
        )}
      </SpecGroup>

      <SpecGroup title="Materials">
        <MaterialSelectField label="Frame material" value={spec.frame_material} options={MATERIAL_OPTIONS.wood} onChange={(v) => set("frame_material", v)} />
        <MaterialSelectField label="Finish" value={spec.finish} options={MATERIAL_OPTIONS.finish} onChange={(v) => set("finish", v)} />
        <BoolField label="Upholstered panels" value={spec.upholstered_panels} onChange={(v) => set("upholstered_panels", v)} />
        {spec.upholstered_panels && (
          <ColorField label="Upholstery color" value={spec.upholstery_color} onChange={(v) => set("upholstery_color", v)} />
        )}
      </SpecGroup>
    </>
  );
}
