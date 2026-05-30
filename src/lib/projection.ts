// 2D ↔ 3D screen-space helpers used by the lasso selector.

import { Vector3, type Camera } from "three";
import type { ModelPart } from "./model";

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export function partCenterWorld(part: ModelPart): [number, number, number] {
  return [
    part.position[0] + (part.anchor[0] * part.size[0] * (1 - part.scale[0])) / 2,
    part.position[1] + (part.anchor[1] * part.size[1] * (1 - part.scale[1])) / 2,
    part.position[2] + (part.anchor[2] * part.size[2] * (1 - part.scale[2])) / 2,
  ];
}

export function projectToScreen(
  worldPos: [number, number, number],
  camera: Camera,
  size: Size2D
): Point2D {
  const v = new Vector3(worldPos[0], worldPos[1], worldPos[2]);
  v.project(camera);
  return {
    x: (v.x + 1) * 0.5 * size.width,
    y: (1 - v.y) * 0.5 * size.height,
  };
}

// Standard ray-casting point-in-polygon test.
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(polygon: Point2D[]): Point2D {
  if (polygon.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of polygon) {
    x += p.x;
    y += p.y;
  }
  return { x: x / polygon.length, y: y / polygon.length };
}
