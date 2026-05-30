// Material picker panel — color, preset material (fabric / leather / marble /
// metal / etc.), and procedural pattern overlay. Lives below the existing
// MaterialControls (brightness/roughness/polygon count).

import {
  PATTERN_LABELS,
  PRESET_LABELS,
  type MaterialOverride,
  type MaterialPreset,
  type PatternType,
} from "../lib/materials";

interface MaterialPickerProps {
  override: MaterialOverride;
  onChange: (next: MaterialOverride) => void;
}

const SWATCHES = [
  "#cdd97a", // bubble-sofa green
  "#5a3a22", // walnut
  "#a87b4f", // light wood
  "#1a1a1a", // black
  "#f5f5f0", // off-white
  "#a83232", // red
  "#3a4f6e", // navy blue
  "#3d5f3d", // forest green
  "#d4af37", // gold
  "#c9a967", // brass
  "#6b4423", // leather brown
  "#888888", // grey
];

const PRESETS: MaterialPreset[] = [
  "original",
  "solid",
  "fabric",
  "leather",
  "marble",
  "wood",
  "metal",
  "plastic",
];

const PATTERNS: PatternType[] = ["none", "knit", "weave", "dots", "noise"];

export function MaterialPicker({ override, onChange }: MaterialPickerProps) {
  const isOriginal = override.preset === "original";

  return (
    <div className="material-picker">
      <div className="picker-section">
        <label>material</label>
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button
              key={p}
              className={`preset-chip ${override.preset === p ? "active" : ""}`}
              onClick={() => onChange({ ...override, preset: p })}
              title={PRESET_LABELS[p]}
            >
              {p === "original" ? "PBR" : p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {!isOriginal && (
        <>
          <div className="picker-section">
            <label>
              color
              <input
                type="color"
                value={override.color}
                onChange={(e) => onChange({ ...override, color: e.target.value })}
                aria-label="custom color"
              />
            </label>
            <div className="swatch-grid">
              {SWATCHES.map((hex) => (
                <button
                  key={hex}
                  className={`swatch ${override.color === hex ? "active" : ""}`}
                  style={{ background: hex }}
                  onClick={() => onChange({ ...override, color: hex })}
                  title={hex}
                />
              ))}
            </div>
          </div>

          <div className="picker-section">
            <label>
              pattern
              <select
                value={override.pattern}
                onChange={(e) =>
                  onChange({
                    ...override,
                    pattern: e.target.value as PatternType,
                  })
                }
              >
                {PATTERNS.map((p) => (
                  <option key={p} value={p}>
                    {PATTERN_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            {override.pattern !== "none" && (
              <>
                <div className="control compact">
                  <label>
                    intensity
                    <span className="value">{override.patternIntensity}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={override.patternIntensity}
                    onChange={(e) =>
                      onChange({
                        ...override,
                        patternIntensity: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="control compact">
                  <label>
                    scale
                    <span className="value">{override.patternScale}×</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={32}
                    step={1}
                    value={override.patternScale}
                    onChange={(e) =>
                      onChange({
                        ...override,
                        patternScale: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
