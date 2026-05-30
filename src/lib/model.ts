export type Shape = "box" | "cylinder" | "sphere" | "cone";

export interface ModelPart {
  id: string;
  label: string;
  shape: Shape;
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  anchor: [number, number, number];
  scale: [number, number, number];
}

export type GenerationMode = "parts" | "scad" | "mesh-url";
export type QualityPreset = "max" | "draft" | "textureless";

export interface Model {
  id: string;
  template: string;
  prompt: string;
  parts: ModelPart[];
  mode?: GenerationMode;
  scad?: string;
  meshUrl?: string;
  meshContentType?: string;
  meshFileSize?: number;
  referenceImageUrl?: string;
  referencePath?: string;
  quality_preset?: QualityPreset;
  generation_model?: string;
  spec?: import("./spec").FurnitureSpec;
}
