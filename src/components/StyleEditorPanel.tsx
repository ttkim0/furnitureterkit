// Cursor-style live style editor for the custom storefront.
//
// Floats over the iframe (owner-only). Changes apply live — we re-render
// the iframe with new palette/typography overrides. "Save" persists the
// changes to the creator row so visitors see them too.
//
// Critically: this works on ANY Claude-generated design without
// re-running Claude. The render function injects CSS custom property
// overrides + a heavy-specificity rule that wins over inline colors in
// the generated HTML.

import { useEffect, useState } from "react";
import type { Creator, Palette } from "../lib/marketplace";
import { updateCreator } from "../lib/storeDb";

interface FontPair {
  id: string;
  name: string;
  display: string;
  body: string;
  googleFamilies: string[];
  sample: string;
}

const FONT_PAIRS: FontPair[] = [
  {
    id: "serif-classic",
    name: "Serif Classic",
    display: '"EB Garamond", Georgia, serif',
    body: '"Inter", -apple-system, sans-serif',
    googleFamilies: ["EB+Garamond:ital,wght@0,400;0,500;1,400", "Inter:wght@400;500"],
    sample: "Quiet, editorial",
  },
  {
    id: "modern-sans",
    name: "Modern Sans",
    display: '"Inter", -apple-system, sans-serif',
    body: '"Inter", -apple-system, sans-serif',
    googleFamilies: ["Inter:wght@400;500;700"],
    sample: "Clean, technical",
  },
  {
    id: "editorial-mag",
    name: "Editorial Magazine",
    display: '"Playfair Display", Georgia, serif',
    body: '"Source Sans 3", -apple-system, sans-serif',
    googleFamilies: [
      "Playfair+Display:ital,wght@0,400;0,700;1,400",
      "Source+Sans+3:wght@300;400;600",
    ],
    sample: "Magazine-like, expressive",
  },
  {
    id: "mono-modernist",
    name: "Mono Modernist",
    display: '"JetBrains Mono", "SF Mono", monospace',
    body: '"Inter", sans-serif',
    googleFamilies: ["JetBrains+Mono:wght@400;500", "Inter:wght@400;500"],
    sample: "Industrial, schematic",
  },
  {
    id: "warm-rustic",
    name: "Warm Rustic",
    display: '"Cormorant Garamond", Georgia, serif',
    body: '"Crimson Pro", Georgia, serif',
    googleFamilies: [
      "Cormorant+Garamond:ital,wght@0,400;0,500;1,400",
      "Crimson+Pro:wght@400;500",
    ],
    sample: "Hand-crafted, slow",
  },
  {
    id: "japanese-grid",
    name: "Japanese Grid",
    display: '"Noto Serif JP", "EB Garamond", serif',
    body: '"Noto Sans JP", "Inter", sans-serif',
    googleFamilies: ["Noto+Serif+JP:wght@400;500", "Noto+Sans+JP:wght@300;400"],
    sample: "Spacious, considered",
  },
  {
    id: "italian-display",
    name: "Italian Display",
    display: '"DM Serif Display", Georgia, serif',
    body: '"DM Sans", -apple-system, sans-serif',
    googleFamilies: ["DM+Serif+Display:ital@0;1", "DM+Sans:wght@400;500"],
    sample: "Bold, glamorous",
  },
  {
    id: "scandi-soft",
    name: "Scandi Soft",
    display: '"Manrope", -apple-system, sans-serif',
    body: '"Manrope", -apple-system, sans-serif',
    googleFamilies: ["Manrope:wght@300;400;500;700"],
    sample: "Soft, residential",
  },
];

const PALETTE_PRESETS: Array<{ name: string; palette: Palette }> = [
  { name: "Charcoal & cream", palette: { primary: "#06070d", accent: "#ffc88c", text: "#fff7e6", muted: "#a89b85" } },
  { name: "Warm paper", palette: { primary: "#f6f1e8", accent: "#c95b4b", text: "#1a1814", muted: "#6e6557" } },
  { name: "Pure white", palette: { primary: "#ffffff", accent: "#1a1a1a", text: "#1a1a1a", muted: "#888888" } },
  { name: "Black & brass", palette: { primary: "#0a0908", accent: "#d4a574", text: "#f5e8d0", muted: "#7a6e5d" } },
  { name: "Bauhaus", palette: { primary: "#fafafa", accent: "#e63946", text: "#1d1d1d", muted: "#666666" } },
  { name: "Forest", palette: { primary: "#1c2924", accent: "#c4a373", text: "#f0e8d8", muted: "#8b9a90" } },
  { name: "Linen", palette: { primary: "#f0ebe0", accent: "#7a5c3e", text: "#2a2620", muted: "#8a7e6e" } },
  { name: "Slate", palette: { primary: "#2a2d34", accent: "#e8b04b", text: "#ebe6dc", muted: "#9aa0ab" } },
];

interface StyleEditorPanelProps {
  creator: Creator;
  onLiveChange: (overrides: {
    palette: Palette;
    fontPair: FontPair;
  }) => void;
  onSaved: (creator: Creator) => void;
}

export function StyleEditorPanel({ creator, onLiveChange, onSaved }: StyleEditorPanelProps) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState<Palette>(creator.palette);
  const [fontPairId, setFontPairId] = useState<string>(
    pickFontPairForTypography(creator.typography).id
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fontPair = FONT_PAIRS.find((f) => f.id === fontPairId) ?? FONT_PAIRS[0];

  // Whenever the picker state changes, push the overrides up so the
  // iframe re-renders with the new look immediately.
  useEffect(() => {
    onLiveChange({ palette, fontPair });
  }, [palette, fontPair, onLiveChange]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateCreator(creator.id, {
        palette,
        typography: mapFontPairToTypography(fontPair.id),
      });
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        className={`style-editor-fab ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Edit style"
      >
        {open ? "✕" : "✎"}
      </button>

      {open && (
        <aside className="style-editor-panel">
          <header className="style-editor-header">
            <h3>Style</h3>
            <span className="style-editor-hint">Changes preview live</span>
          </header>

          <section className="style-editor-section">
            <label>Palette preset</label>
            <div className="style-editor-presets">
              {PALETTE_PRESETS.map((p) => (
                <button
                  key={p.name}
                  className="style-editor-preset"
                  onClick={() => setPalette(p.palette)}
                  title={p.name}
                >
                  <span className="style-editor-preset-swatches">
                    <span style={{ background: p.palette.primary }} />
                    <span style={{ background: p.palette.accent }} />
                    <span style={{ background: p.palette.text }} />
                  </span>
                  <span className="style-editor-preset-name">{p.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="style-editor-section">
            <label>Custom colors</label>
            <div className="style-editor-colors">
              <ColorRow label="Background" color={palette.primary} onChange={(c) => setPalette({ ...palette, primary: c })} />
              <ColorRow label="Accent" color={palette.accent} onChange={(c) => setPalette({ ...palette, accent: c })} />
              <ColorRow label="Text" color={palette.text} onChange={(c) => setPalette({ ...palette, text: c })} />
              <ColorRow label="Muted text" color={palette.muted} onChange={(c) => setPalette({ ...palette, muted: c })} />
            </div>
          </section>

          <section className="style-editor-section">
            <label>Typography</label>
            <div className="style-editor-fonts">
              {FONT_PAIRS.map((f) => (
                <button
                  key={f.id}
                  className={`style-editor-font ${fontPairId === f.id ? "is-active" : ""}`}
                  onClick={() => setFontPairId(f.id)}
                  style={{ fontFamily: f.display }}
                >
                  <span className="style-editor-font-name">{f.name}</span>
                  <span className="style-editor-font-sample">{f.sample}</span>
                </button>
              ))}
            </div>
          </section>

          <footer className="style-editor-footer">
            <button
              className="flow-btn flow-btn-primary style-editor-save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
            </button>
          </footer>
        </aside>
      )}
    </>
  );
}

function ColorRow({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (c: string) => void;
}) {
  return (
    <label className="style-editor-color-row">
      <span>{label}</span>
      <span className="style-editor-color-swatch" style={{ background: color }}>
        <input type="color" value={color} onChange={(e) => onChange(e.target.value)} />
      </span>
      <input
        type="text"
        className="style-editor-color-hex"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        maxLength={9}
      />
    </label>
  );
}

export function fontPairById(id: string): FontPair {
  return FONT_PAIRS.find((f) => f.id === id) ?? FONT_PAIRS[0];
}

// Crude mapping between the existing creator.typography enum and the new
// FontPair set. Lets us keep the old column but show richer options here.
function pickFontPairForTypography(
  typo: Creator["typography"]
): FontPair {
  switch (typo) {
    case "serif-italic":
      return FONT_PAIRS[0];
    case "modern-sans":
      return FONT_PAIRS[1];
    case "editorial":
      return FONT_PAIRS[2];
    case "monospace-modernist":
      return FONT_PAIRS[3];
    default:
      return FONT_PAIRS[0];
  }
}

function mapFontPairToTypography(id: string): Creator["typography"] {
  switch (id) {
    case "modern-sans":
    case "scandi-soft":
      return "modern-sans";
    case "editorial-mag":
    case "italian-display":
    case "warm-rustic":
    case "japanese-grid":
      return "editorial";
    case "mono-modernist":
      return "monospace-modernist";
    case "serif-classic":
    default:
      return "serif-italic";
  }
}
