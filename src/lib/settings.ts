// User-level preferences. Stored in localStorage so they survive reloads.
// All fields are optional in storage — defaults applied on read.

export type Quality = "low" | "medium" | "high" | "ultra";

export const QUALITY_SEGMENTS: Record<Quality, number> = {
  low: 8,
  medium: 16,
  high: 32,
  ultra: 64,
};

export interface Settings {
  generationModel: string;
  editModel: string;
  quality: Quality;
}

const DEFAULTS: Settings = {
  generationModel: "claude-sonnet-4-6",
  editModel: "claude-haiku-4-5-20251001",
  quality: "medium",
};

const KEY = "ariadne.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      generationModel: parsed.generationModel ?? DEFAULTS.generationModel,
      editModel: parsed.editModel ?? DEFAULTS.editModel,
      quality: parsed.quality ?? DEFAULTS.quality,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export const MODEL_LABELS: Record<string, string> = {
  "claude-haiku-4-5-20251001": "Haiku 4.5 (fast, cheap)",
  "claude-sonnet-4-6": "Sonnet 4.6 (balanced)",
  "claude-opus-4-7": "Opus 4.7 (best, slow + costly)",
};

export const QUALITY_LABELS: Record<Quality, string> = {
  low: "Low (8 sides)",
  medium: "Medium (16 sides)",
  high: "High (32 sides)",
  ultra: "Ultra (64 sides)",
};
