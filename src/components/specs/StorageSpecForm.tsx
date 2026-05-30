import type { StorageSpec } from "../../lib/spec";
import {
  NumberField,
  SelectField,
  SpecGroup,
} from "../SpecFields";
import { MaterialSelectField } from "../MaterialSelectField";
import { MATERIAL_OPTIONS } from "../../lib/materialMapping";

interface Props {
  spec: StorageSpec;
  onChange: (s: StorageSpec) => void;
}

const STORAGE_TYPES = ["shelf", "cabinet", "dresser", "wardrobe", "bookcase", "sideboard"] as const;

export function StorageSpecForm({ spec, onChange }: Props) {
  const set = <K extends keyof StorageSpec>(k: K, v: StorageSpec[K]) =>
    onChange({ ...spec, [k]: v });
  const setOverall = (k: "width_mm" | "height_mm" | "depth_mm", v: number) =>
    onChange({ ...spec, overall: { ...spec.overall, [k]: v } });

  const showDrawers = ["dresser", "sideboard", "cabinet"].includes(spec.storage_type);
  const showShelves = ["shelf", "bookcase", "wardrobe", "cabinet"].includes(spec.storage_type);
  const showDoors = ["cabinet", "wardrobe", "sideboard"].includes(spec.storage_type);

  return (
    <>
      <SpecGroup title="Overall">
        <SelectField label="Type" value={spec.storage_type} options={STORAGE_TYPES} onChange={(v) => set("storage_type", v)} />
        <NumberField label="Width" value={spec.overall.width_mm} onChange={(v) => setOverall("width_mm", v)} />
        <NumberField label="Height" value={spec.overall.height_mm} onChange={(v) => setOverall("height_mm", v)} />
        <NumberField label="Depth" value={spec.overall.depth_mm} onChange={(v) => setOverall("depth_mm", v)} />
      </SpecGroup>

      <SpecGroup title="Compartments">
        {showShelves && (
          <>
            <NumberField label="Shelf count" value={spec.shelf_count} onChange={(v) => set("shelf_count", v)} unit="" min={0} max={20} />
            <NumberField label="Shelf spacing" value={spec.shelf_spacing_mm} onChange={(v) => set("shelf_spacing_mm", v)} />
          </>
        )}
        {showDrawers && (
          <NumberField label="Drawer count" value={spec.drawer_count} onChange={(v) => set("drawer_count", v)} unit="" min={0} max={20} />
        )}
        {showDoors && (
          <NumberField label="Door count" value={spec.door_count} onChange={(v) => set("door_count", v)} unit="" min={0} max={12} />
        )}
        {showDrawers && spec.drawer_dimensions_mm && (
          <>
            <NumberField label="Drawer width" value={spec.drawer_dimensions_mm.width} onChange={(v) => set("drawer_dimensions_mm", { ...spec.drawer_dimensions_mm!, width: v })} />
            <NumberField label="Drawer depth" value={spec.drawer_dimensions_mm.depth} onChange={(v) => set("drawer_dimensions_mm", { ...spec.drawer_dimensions_mm!, depth: v })} />
            <NumberField label="Drawer height" value={spec.drawer_dimensions_mm.height} onChange={(v) => set("drawer_dimensions_mm", { ...spec.drawer_dimensions_mm!, height: v })} />
          </>
        )}
        <p className="spec-rebuild-note">
          ⚠ Changing compartment counts only updates the spec — click <b>Rebuild
          mesh</b> at the bottom to regenerate the 3D model.
        </p>
      </SpecGroup>

      <SpecGroup title="Materials">
        <MaterialSelectField label="Frame" value={spec.frame_material} options={MATERIAL_OPTIONS.wood} onChange={(v) => set("frame_material", v)} />
        <MaterialSelectField label="Finish" value={spec.finish} options={MATERIAL_OPTIONS.finish} onChange={(v) => set("finish", v)} />
        <MaterialSelectField label="Hardware" value={spec.hardware_material} options={MATERIAL_OPTIONS.hardware} onChange={(v) => set("hardware_material", v)} />
        <MaterialSelectField label="Back panel" value={spec.back_panel_material} options={MATERIAL_OPTIONS.wood} onChange={(v) => set("back_panel_material", v)} />
      </SpecGroup>
    </>
  );
}
