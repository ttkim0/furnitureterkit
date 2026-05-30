import {
  MODEL_LABELS,
  QUALITY_LABELS,
  type Quality,
  type Settings,
} from "../lib/settings";
import type { HealthResponse } from "../lib/api";

interface SettingsBarProps {
  settings: Settings;
  health: HealthResponse | null;
  onChange: (next: Settings) => void;
}

export function SettingsBar({ settings, health, onChange }: SettingsBarProps) {
  const llmOn = health?.llm_available ?? false;
  const models = health?.models ?? [
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6",
    "claude-opus-4-7",
  ];

  return (
    <div className="settings-bar">
      <div className="setting">
        <label>Quality</label>
        <select
          value={settings.quality}
          onChange={(e) =>
            onChange({ ...settings, quality: e.target.value as Quality })
          }
          title="Affects how smooth cylinders/spheres/cones render and how fine STL exports are."
        >
          {(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => (
            <option key={q} value={q}>
              {QUALITY_LABELS[q]}
            </option>
          ))}
        </select>
      </div>
      <div className="setting" title={llmOn ? "" : "Set ANTHROPIC_API_KEY to enable"}>
        <label className={llmOn ? "" : "dim"}>Generation</label>
        <select
          value={settings.generationModel}
          onChange={(e) =>
            onChange({ ...settings, generationModel: e.target.value })
          }
          disabled={!llmOn}
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABELS[m] ?? m}
            </option>
          ))}
        </select>
      </div>
      <div className="setting" title={llmOn ? "" : "Set ANTHROPIC_API_KEY to enable"}>
        <label className={llmOn ? "" : "dim"}>Editing</label>
        <select
          value={settings.editModel}
          onChange={(e) =>
            onChange({ ...settings, editModel: e.target.value })
          }
          disabled={!llmOn}
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABELS[m] ?? m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
