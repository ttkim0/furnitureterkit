import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { Camera } from "three";

export interface CameraInfo {
  camera: Camera;
  size: { width: number; height: number };
}

interface Props {
  exportRef: React.MutableRefObject<CameraInfo | null>;
}

// In-Canvas helper: writes the live camera + canvas size into a parent ref so
// the lasso (which lives outside the Canvas) can project world positions to
// screen coordinates.
export function CameraExporter({ exportRef }: Props) {
  const { camera, size } = useThree();
  useEffect(() => {
    exportRef.current = { camera, size };
  });
  return null;
}
