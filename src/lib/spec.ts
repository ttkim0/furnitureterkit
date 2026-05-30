// Manufacturer-ready furniture specifications.
//
// Each category has a typed shape. The LLM fills in the right one for the
// generated mesh, grounded in the GLB's real-unit bounding box. Users edit
// fields as metadata — these don't regenerate the mesh.

export type FurnitureCategory =
  | "sofa"
  | "chair"
  | "table"
  | "bed"
  | "lamp"
  | "storage";

export interface SpecOverall {
  width_mm: number;
  height_mm: number;
  depth_mm: number;
  weight_kg_estimate?: number;
}

export interface BaseSpec {
  category: FurnitureCategory;
  overall: SpecOverall;
  primary_material: string;
  notes?: string;
}

export interface SofaSpec extends BaseSpec {
  category: "sofa";
  seat_width_mm: number;
  seat_depth_mm: number;
  seat_height_mm: number;
  back_height_mm: number;
  arm_height_mm?: number;
  arm_width_mm?: number;
  number_of_seats: number;
  cushion_count: number;
  frame_material: string;
  fill_material: string;
  upholstery_material: string;
  upholstery_color: string;
  leg_material?: string;
  leg_count?: number;
  leg_height_mm?: number;
}

export interface ChairSpec extends BaseSpec {
  category: "chair";
  chair_type: "dining" | "lounge" | "office" | "stool" | "armchair" | "rocking";
  seat_width_mm: number;
  seat_depth_mm: number;
  seat_height_mm: number;
  back_height_mm: number;
  has_armrests: boolean;
  arm_height_mm?: number;
  leg_count: number;
  leg_height_mm: number;
  frame_material: string;
  seat_material: string;
  back_material: string;
  upholstery_color?: string;
}

export interface TableSpec extends BaseSpec {
  category: "table";
  table_type: "dining" | "coffee" | "side" | "desk" | "console" | "console";
  top_width_mm: number;
  top_depth_mm: number;
  top_height_mm: number;
  top_thickness_mm: number;
  top_material: string;
  top_finish: string;
  leg_count: number;
  leg_style: "straight" | "tapered" | "turned" | "pedestal" | "trestle";
  leg_material: string;
  has_apron: boolean;
}

export interface BedSpec extends BaseSpec {
  category: "bed";
  mattress_size:
    | "twin"
    | "twin_xl"
    | "full"
    | "queen"
    | "king"
    | "california_king"
    | "custom";
  mattress_width_mm: number;
  mattress_length_mm: number;
  mattress_height_mm: number;
  frame_height_mm: number;
  has_headboard: boolean;
  headboard_height_mm?: number;
  has_footboard: boolean;
  footboard_height_mm?: number;
  frame_material: string;
  finish: string;
  upholstered_panels: boolean;
  upholstery_color?: string;
}

export interface LampSpec extends BaseSpec {
  category: "lamp";
  lamp_type: "table" | "floor" | "pendant" | "wall_sconce" | "desk";
  base_diameter_mm?: number;
  shade_diameter_mm: number;
  shade_height_mm: number;
  pole_height_mm?: number;
  bulb_count: number;
  bulb_socket: "E26" | "E27" | "E12" | "E14" | "GU10" | "other";
  max_wattage: number;
  base_material: string;
  shade_material: string;
  cord_length_mm?: number;
}

export interface StorageSpec extends BaseSpec {
  category: "storage";
  storage_type:
    | "shelf"
    | "cabinet"
    | "dresser"
    | "wardrobe"
    | "bookcase"
    | "sideboard";
  shelf_count?: number;
  drawer_count?: number;
  door_count?: number;
  drawer_dimensions_mm?: { width: number; depth: number; height: number };
  shelf_spacing_mm?: number;
  frame_material: string;
  finish: string;
  hardware_material: string;
  back_panel_material?: string;
}

export type FurnitureSpec =
  | SofaSpec
  | ChairSpec
  | TableSpec
  | BedSpec
  | LampSpec
  | StorageSpec;

export const CATEGORY_LABELS: Record<FurnitureCategory, string> = {
  sofa: "Sofa / Couch",
  chair: "Chair",
  table: "Table",
  bed: "Bed",
  lamp: "Lamp",
  storage: "Storage",
};

export const COMMON_MATERIALS = {
  wood: ["Oak", "Walnut", "Maple", "Birch", "Pine", "Teak", "Mahogany", "Plywood", "MDF"],
  metal: ["Steel", "Stainless steel", "Brass", "Aluminum", "Iron", "Chrome"],
  upholstery: ["Velvet", "Linen", "Cotton", "Leather", "Faux leather", "Polyester knit", "Wool", "Boucle"],
  fill: ["HD foam", "Down", "Polyester fiber", "Memory foam", "Spring + foam"],
  finish: ["Matte lacquer", "Satin lacquer", "Gloss lacquer", "Oil", "Wax", "Stained", "Painted"],
  hardware: ["Brushed brass", "Polished brass", "Brushed nickel", "Polished chrome", "Matte black", "Antique bronze"],
} as const;
