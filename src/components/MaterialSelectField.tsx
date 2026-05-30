// Spec-form field for material slots: a dropdown of named options with the
// LLM-generated value preserved as the first option (so the user can keep
// the specific text Sonnet wrote OR pick a known preset to override). Picking
// a preset name fires onChange and the parent (App) auto-tints the visual via
// applyMaterialName.

import { useState } from "react";

interface MaterialSelectFieldProps {
  label: string;
  value: string | undefined;
  options: readonly string[];
  onChange: (v: string) => void;
}

const CUSTOM_SENTINEL = "__custom__";

export function MaterialSelectField({
  label,
  value,
  options,
  onChange,
}: MaterialSelectFieldProps) {
  const isPreset = !!value && options.some((o) => o.toLowerCase() === value.toLowerCase());
  const [customMode, setCustomMode] = useState(false);

  if (customMode) {
    return (
      <div className="spec-field">
        <label>{label}</label>
        <div className="spec-input-row">
          <input
            type="text"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Custom material…"
            autoFocus
          />
          <button
            type="button"
            className="spec-mini-btn"
            onClick={() => setCustomMode(false)}
            title="Pick from preset list"
          >
            ▾
          </button>
        </div>
      </div>
    );
  }

  // Build options list: preserve LLM-generated value as the first option
  // (with an "(current)" suffix) if it isn't already a known preset, then
  // list all the standard presets.
  return (
    <div className="spec-field">
      <label>{label}</label>
      <select
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_SENTINEL) {
            setCustomMode(true);
          } else {
            onChange(v);
          }
        }}
      >
        {!isPreset && value && (
          <option value={value}>
            {value.length > 32 ? value.slice(0, 32) + "…" : value} (current)
          </option>
        )}
        {!value && <option value="">— pick —</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={CUSTOM_SENTINEL}>Custom…</option>
      </select>
    </div>
  );
}
