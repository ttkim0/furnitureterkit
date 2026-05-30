// Right-side panel with material/render controls and polygon count.
// Modeled on CADAM's "controls" panel: brightness, roughness, polygon count.
// Sliders are pure renderer controls — they don't trigger an OpenSCAD
// recompile.

import { useState } from "react";

export interface MaterialSettings {
  brightness: number; // 0–100, 50 is neutral
  roughness: number;  // 0–100
}

export type ColorScheme = "textured" | "plain" | "wireframe";

interface MaterialControlsProps {
  material: MaterialSettings;
  onChangeMaterial: (next: MaterialSettings) => void;
  colorScheme: ColorScheme;
  onChangeColorScheme: (next: ColorScheme) => void;
  polygonCount: number | null;
}

export function MaterialControls({
  material,
  onChangeMaterial,
  colorScheme,
  onChangeColorScheme,
  polygonCount,
}: MaterialControlsProps) {
  const [open, setOpen] = useState(true);

  const formatPolyCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
  };

  return (
    <div className="material-panel">
      <button
        className="material-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="dot" />
        <span>controls</span>
        <span className="caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="material-body">
          <div className="control">
            <label>
              <span className="icon">☀</span>
              brightness
              <span className="value">{material.brightness}</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={material.brightness}
              onChange={(e) =>
                onChangeMaterial({
                  ...material,
                  brightness: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="control">
            <label>
              <span className="icon">◆</span>
              roughness
              <span className="value">{material.roughness}</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={material.roughness}
              onChange={(e) =>
                onChangeMaterial({
                  ...material,
                  roughness: Number(e.target.value),
                })
              }
            />
          </div>
          {polygonCount !== null && (
            <div className="control polygon-row">
              <label>
                <span className="icon">#</span>
                polygons
                <span className="value">{formatPolyCount(polygonCount)}</span>
              </label>
            </div>
          )}
          <div className="scheme-pills" role="tablist">
            <button
              role="tab"
              aria-selected={colorScheme === "textured"}
              className={colorScheme === "textured" ? "active" : ""}
              onClick={() => onChangeColorScheme("textured")}
              title="Textured (per-part materials)"
            >
              ●
            </button>
            <button
              role="tab"
              aria-selected={colorScheme === "plain"}
              className={colorScheme === "plain" ? "active" : ""}
              onClick={() => onChangeColorScheme("plain")}
              title="Plain neutral"
            >
              ○
            </button>
            <button
              role="tab"
              aria-selected={colorScheme === "wireframe"}
              className={colorScheme === "wireframe" ? "active" : ""}
              onClick={() => onChangeColorScheme("wireframe")}
              title="Wireframe"
            >
              ⊞
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
