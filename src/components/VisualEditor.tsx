// Onlook-style visual editor — parent side.
//
// Drawn over the storefront iframe when the owner is viewing their own
// store. Responsibilities:
//   • Toggle "edit mode" on/off (sends enable/disable to iframe)
//   • Render a Figma-style selection box over the hovered/selected element
//   • Show a property panel with: text (if leaf), color, font, size, weight
//   • Send style mutations to the iframe live (no re-render needed)
//   • Persist accumulated overrides to creator row on Save
//
// All cross-iframe messaging is plain postMessage — no penpal dep needed
// for our minimal scope.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Creator } from "../lib/marketplace";
import type { VisualOverrides } from "../lib/visualEditorPreload";
import { updateCreator } from "../lib/storeDb";

interface VisualEditorProps {
  creator: Creator;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onSaved: (updated: Creator) => void;
}

interface SelectionState {
  aid: string;
  tagName: string;
  rect: { x: number; y: number; width: number; height: number };
  text: string | null;
  computedStyle: Record<string, string>;
}

interface HoverState {
  aid: string;
  rect: { x: number; y: number; width: number; height: number };
  tagName: string;
}

const COLOR_PRESETS = [
  "#06070d", "#1a1814", "#2a2620", "#6e6557", "#a89b85", "#ffffff",
  "#fff7e6", "#f5e8d0", "#ffc88c", "#d4a574", "#c95b4b", "#7a5c3e",
  "#1c2924", "#3a5a40", "#283618", "#dda15e", "#bc6c25", "#9d8189",
];

const FONT_SIZE_PRESETS = [
  { label: "xs", value: "12px" },
  { label: "sm", value: "14px" },
  { label: "base", value: "16px" },
  { label: "lg", value: "18px" },
  { label: "xl", value: "22px" },
  { label: "2xl", value: "30px" },
  { label: "3xl", value: "42px" },
  { label: "4xl", value: "60px" },
  { label: "5xl", value: "84px" },
];

const FONT_WEIGHT_PRESETS = [
  { label: "Thin", value: "200" },
  { label: "Regular", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Bold", value: "700" },
  { label: "Black", value: "900" },
];

export function VisualEditor({ creator, iframeRef, onSaved }: VisualEditorProps) {
  const [enabled, setEnabled] = useState(false);
  const [overrides, setOverrides] = useState<VisualOverrides>(creator.custom_overrides ?? {});
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [iframeRect, setIframeRect] = useState({ x: 0, y: 0 });

  // Track the iframe's position so we can convert iframe-space rects to
  // viewport-space for overlay drawing.
  useEffect(() => {
    function updateIframeRect() {
      const el = iframeRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setIframeRect({ x: r.left, y: r.top });
    }
    updateIframeRect();
    window.addEventListener("resize", updateIframeRect);
    window.addEventListener("scroll", updateIframeRect, true);
    const ro = new ResizeObserver(updateIframeRect);
    if (iframeRef.current) ro.observe(iframeRef.current);
    return () => {
      window.removeEventListener("resize", updateIframeRect);
      window.removeEventListener("scroll", updateIframeRect, true);
      ro.disconnect();
    };
  }, [iframeRef]);

  // postMessage listener — receives events from the iframe preload script.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = ev.data;
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
      if (!msg.type.startsWith("editor:")) return;
      switch (msg.type) {
        case "editor:ready":
          // Once the iframe is ready, enable editing if our local state says so.
          if (enabled) sendToIframe({ type: "editor:enable" });
          break;
        case "editor:hover":
          setHover({ aid: msg.aid, rect: msg.rect, tagName: msg.tagName });
          break;
        case "editor:select":
          setSelection({
            aid: msg.aid,
            tagName: msg.tagName,
            rect: msg.rect,
            text: msg.text,
            computedStyle: msg.computedStyle,
          });
          break;
        case "editor:text-changed":
          setOverrides((prev) => ({
            ...prev,
            text: { ...(prev.text ?? {}), [msg.aid]: msg.text },
          }));
          break;
        case "editor:viewport-change":
          // Re-request the selected element's rect so the overlay tracks scroll
          if (selection) sendToIframe({ type: "editor:request-element", aid: selection.aid });
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, selection]);

  const sendToIframe = useCallback(
    (msg: Record<string, unknown>) => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(msg, "*");
    },
    [iframeRef]
  );

  function toggleEditor() {
    const next = !enabled;
    setEnabled(next);
    sendToIframe({ type: next ? "editor:enable" : "editor:disable" });
    if (!next) {
      setSelection(null);
      setHover(null);
    }
  }

  function setStyle(prop: string, value: string) {
    if (!selection) return;
    const aid = selection.aid;
    setOverrides((prev) => {
      const cur = prev.style?.[aid] ?? {};
      const next: VisualOverrides = {
        ...prev,
        style: {
          ...(prev.style ?? {}),
          [aid]: { ...cur, [prop]: value },
        },
      };
      return next;
    });
    sendToIframe({ type: "editor:set-style", aid, style: { [prop]: value } });
  }

  function startEditText() {
    if (!selection) return;
    sendToIframe({ type: "editor:start-edit-text", aid: selection.aid });
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateCreator(creator.id, {
        custom_overrides: overrides,
      });
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      console.error("Failed to save overrides", e);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardAll() {
    setOverrides({});
    sendToIframe({ type: "editor:apply-overrides", overrides: {} });
    setSelection(null);
  }

  // Translate iframe-space rect to viewport-space for the overlay.
  const overlayRect = useMemo(() => {
    if (!selection) return null;
    return {
      left: iframeRect.x + selection.rect.x,
      top: iframeRect.y + selection.rect.y,
      width: selection.rect.width,
      height: selection.rect.height,
    };
  }, [selection, iframeRect]);

  const hoverRect = useMemo(() => {
    if (!hover || (selection && selection.aid === hover.aid)) return null;
    return {
      left: iframeRect.x + hover.rect.x,
      top: iframeRect.y + hover.rect.y,
      width: hover.rect.width,
      height: hover.rect.height,
    };
  }, [hover, selection, iframeRect]);

  return (
    <>
      <button
        className={`ve-toggle ${enabled ? "is-on" : ""}`}
        onClick={toggleEditor}
        title={enabled ? "Exit visual editor" : "Edit any element"}
      >
        {enabled ? "✕ Exit edit mode" : "✎ Edit elements"}
      </button>

      {enabled && (
        <>
          {/* Hover indicator — thin outline */}
          {hoverRect && (
            <div
              className="ve-overlay ve-overlay-hover"
              style={{
                left: hoverRect.left,
                top: hoverRect.top,
                width: hoverRect.width,
                height: hoverRect.height,
              }}
            />
          )}

          {/* Selection indicator — thicker outline + handles */}
          {overlayRect && (
            <>
              <div
                className="ve-overlay ve-overlay-select"
                style={{
                  left: overlayRect.left,
                  top: overlayRect.top,
                  width: overlayRect.width,
                  height: overlayRect.height,
                }}
              >
                <span className="ve-overlay-tag">{selection?.tagName}</span>
              </div>
            </>
          )}

          {/* Property panel */}
          {selection ? (
            <PropertyPanel
              selection={selection}
              overrides={overrides}
              onSetStyle={setStyle}
              onStartEditText={startEditText}
              onClearSelection={() => setSelection(null)}
            />
          ) : (
            <div className="ve-empty-panel">
              <p>Click any element in the page to edit it.</p>
              <p className="ve-empty-panel-hint">
                Hover shows what's editable. Click selects. Double-click on
                text to edit it in place.
              </p>
            </div>
          )}

          {/* Save bar — bottom of viewport */}
          <div className="ve-save-bar">
            <span className="ve-save-status">
              {Object.keys(overrides.style ?? {}).length +
                Object.keys(overrides.text ?? {}).length}{" "}
              edit(s)
            </span>
            <button
              className="ve-save-discard"
              onClick={handleDiscardAll}
              disabled={!overrides.style && !overrides.text}
            >
              Discard all
            </button>
            <button
              className="ve-save-btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : saved ? "✓ Saved" : "Save edits"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ── Property panel ─────────────────────────────────────────────────────
function PropertyPanel({
  selection,
  overrides,
  onSetStyle,
  onStartEditText,
  onClearSelection,
}: {
  selection: SelectionState;
  overrides: VisualOverrides;
  onSetStyle: (prop: string, value: string) => void;
  onStartEditText: () => void;
  onClearSelection: () => void;
}) {
  const elementOverrides = overrides.style?.[selection.aid] ?? {};
  const textOverride = overrides.text?.[selection.aid];
  const isText = selection.text != null;

  function currentValue(prop: string): string {
    const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) as keyof typeof selection.computedStyle;
    return elementOverrides[prop] ?? selection.computedStyle[camel] ?? "";
  }

  return (
    <aside className="ve-panel">
      <header className="ve-panel-header">
        <div>
          <span className="ve-panel-eyebrow">selected</span>
          <h3>
            &lt;{selection.tagName}&gt;
            <span className="ve-panel-aid">·{selection.aid}</span>
          </h3>
        </div>
        <button className="ve-panel-close" onClick={onClearSelection}>×</button>
      </header>

      <div className="ve-panel-body">
        {isText && (
          <section className="ve-panel-section">
            <label className="ve-panel-label">Text</label>
            <div className="ve-panel-text-preview">
              {textOverride ?? selection.text ?? ""}
            </div>
            <button className="ve-panel-edit-text" onClick={onStartEditText}>
              ✎ Edit text in place
            </button>
          </section>
        )}

        <section className="ve-panel-section">
          <label className="ve-panel-label">Color</label>
          <ColorRow
            label="Text"
            current={currentValue("color")}
            onChange={(c) => onSetStyle("color", c)}
          />
          <ColorRow
            label="Background"
            current={currentValue("background-color")}
            onChange={(c) => onSetStyle("background-color", c)}
            allowTransparent
          />
        </section>

        <section className="ve-panel-section">
          <label className="ve-panel-label">Typography</label>
          <div className="ve-panel-row">
            <span className="ve-panel-row-label">Size</span>
            <select
              value={currentValue("font-size")}
              onChange={(e) => onSetStyle("font-size", e.target.value)}
              className="ve-panel-select"
            >
              <option value="">(default)</option>
              {FONT_SIZE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label} · {p.value}</option>
              ))}
            </select>
          </div>
          <div className="ve-panel-row">
            <span className="ve-panel-row-label">Weight</span>
            <div className="ve-panel-weight">
              {FONT_WEIGHT_PRESETS.map((w) => (
                <button
                  key={w.value}
                  className={`ve-weight-btn ${currentValue("font-weight") === w.value ? "is-active" : ""}`}
                  onClick={() => onSetStyle("font-weight", w.value)}
                  style={{ fontWeight: w.value }}
                >
                  Aa
                </button>
              ))}
            </div>
          </div>
          <div className="ve-panel-row">
            <span className="ve-panel-row-label">Style</span>
            <div className="ve-panel-italic">
              <button
                className={`ve-style-btn ${currentValue("font-style") === "normal" ? "is-active" : ""}`}
                onClick={() => onSetStyle("font-style", "normal")}
              >Aa</button>
              <button
                className={`ve-style-btn ${currentValue("font-style") === "italic" ? "is-active" : ""}`}
                onClick={() => onSetStyle("font-style", "italic")}
                style={{ fontStyle: "italic" }}
              >Aa</button>
            </div>
          </div>
          <div className="ve-panel-row">
            <span className="ve-panel-row-label">Align</span>
            <div className="ve-panel-align">
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  key={a}
                  className={`ve-align-btn ${currentValue("text-align") === a ? "is-active" : ""}`}
                  onClick={() => onSetStyle("text-align", a)}
                >{a[0].toUpperCase()}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="ve-panel-section">
          <label className="ve-panel-label">Spacing</label>
          <div className="ve-panel-row">
            <span className="ve-panel-row-label">Padding</span>
            <input
              type="text"
              className="ve-panel-input"
              placeholder={selection.computedStyle.padding}
              value={elementOverrides["padding"] ?? ""}
              onChange={(e) => onSetStyle("padding", e.target.value)}
            />
          </div>
          <div className="ve-panel-row">
            <span className="ve-panel-row-label">Margin</span>
            <input
              type="text"
              className="ve-panel-input"
              placeholder={selection.computedStyle.margin}
              value={elementOverrides["margin"] ?? ""}
              onChange={(e) => onSetStyle("margin", e.target.value)}
            />
          </div>
          <div className="ve-panel-row">
            <span className="ve-panel-row-label">Radius</span>
            <input
              type="text"
              className="ve-panel-input"
              placeholder={selection.computedStyle.borderRadius}
              value={elementOverrides["border-radius"] ?? ""}
              onChange={(e) => onSetStyle("border-radius", e.target.value)}
            />
          </div>
        </section>
      </div>
    </aside>
  );
}

function ColorRow({
  label,
  current,
  onChange,
  allowTransparent = false,
}: {
  label: string;
  current: string;
  onChange: (c: string) => void;
  allowTransparent?: boolean;
}) {
  const display = current?.startsWith("rgb") ? rgbToHex(current) : current || "#000000";
  return (
    <div className="ve-panel-row ve-color-row">
      <span className="ve-panel-row-label">{label}</span>
      <label className="ve-color-swatch" style={{ background: current || "transparent" }}>
        <input type="color" value={display} onChange={(e) => onChange(e.target.value)} />
      </label>
      <input
        type="text"
        className="ve-panel-input"
        value={current}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="ve-color-presets">
        {COLOR_PRESETS.slice(0, 6).map((c) => (
          <button key={c} className="ve-color-preset" style={{ background: c }} onClick={() => onChange(c)} />
        ))}
        {allowTransparent && (
          <button className="ve-color-preset ve-color-transparent" onClick={() => onChange("transparent")} title="transparent">⊘</button>
        )}
      </div>
    </div>
  );
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return "#000000";
  const [r, g, b] = m.map((n) => parseInt(n, 10));
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
