import { useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import type { Model, ModelPart, Shape } from "../lib/model";
import { QUALITY_SEGMENTS, type Quality } from "../lib/settings";

function Geometry({ shape, segments }: { shape: Shape; segments: number }) {
  // Unit-sized primitives. The mesh's scale prop applies size × editScale.
  switch (shape) {
    case "box":
      return <boxGeometry args={[1, 1, 1]} />;
    case "cylinder":
      return <cylinderGeometry args={[0.5, 0.5, 1, segments]} />;
    case "sphere":
      return (
        <sphereGeometry args={[0.5, segments, Math.max(8, segments / 2)]} />
      );
    case "cone":
      return <coneGeometry args={[0.5, 1, segments]} />;
  }
}

interface PartProps {
  part: ModelPart;
  selected: boolean;
  onSelect: (id: string) => void;
  segments: number;
}

function PartMesh({ part, selected, onSelect, segments }: PartProps) {
  const [hovered, setHovered] = useState(false);
  const meshScale: [number, number, number] = [
    part.size[0] * part.scale[0],
    part.size[1] * part.scale[1],
    part.size[2] * part.scale[2],
  ];
  const adjPos: [number, number, number] = [
    part.position[0] + (part.anchor[0] * part.size[0] * (1 - part.scale[0])) / 2,
    part.position[1] + (part.anchor[1] * part.size[1] * (1 - part.scale[1])) / 2,
    part.position[2] + (part.anchor[2] * part.size[2] * (1 - part.scale[2])) / 2,
  ];
  return (
    <mesh
      position={adjPos}
      scale={meshScale}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(part.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "default";
      }}
    >
      <Geometry shape={part.shape} segments={segments} />
      <meshStandardMaterial
        color={part.color}
        emissive={hovered && !selected ? "#222" : "#000"}
      />
      {selected && <Edges color="#ffaa00" lineWidth={2} />}
    </mesh>
  );
}

interface ModelViewProps {
  model: Model;
  selected: string | null;
  onSelect: (id: string) => void;
  quality: Quality;
}

export function ModelView({ model, selected, onSelect, quality }: ModelViewProps) {
  const segments = QUALITY_SEGMENTS[quality];
  return (
    <group>
      {model.parts.map((p) => (
        <PartMesh
          key={p.id}
          part={p}
          selected={selected === p.id}
          onSelect={onSelect}
          segments={segments}
        />
      ))}
    </group>
  );
}
