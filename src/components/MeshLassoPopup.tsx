// Floating popup that appears at the lasso centroid in MESH view. Lets the
// user type a refinement prompt for the highlighted region. On submit, the
// captured (mesh + lasso outline) image + prompt are sent to OpenAI image-edit
// (which sees the orange highlight and modifies that region) → Hunyuan3D
// remeshes the result → new model loads.

import { useEffect, useState } from "react";
import type { Point2D } from "../lib/projection";

interface MeshLassoPopupProps {
  position: Point2D;
  canvasSize: { width: number; height: number };
  preview: string; // data: URL of the composite (mesh + lasso) for thumbnail
  onSubmit: (text: string) => void;
  onCancel: () => void;
  busy: boolean;
  elapsedMs: number;
}

export function MeshLassoPopup({
  position,
  canvasSize,
  preview,
  onSubmit,
  onCancel,
  busy,
  elapsedMs,
}: MeshLassoPopupProps) {
  const [text, setText] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSubmit(text.trim());
  };

  const POPUP_W = 320;
  const POPUP_H = 320;
  const left = Math.max(8, Math.min(position.x - POPUP_W / 2, canvasSize.width - POPUP_W - 8));
  const top = Math.max(8, Math.min(position.y + 16, canvasSize.height - POPUP_H - 8));

  return (
    <div
      className="lasso-popup mesh-lasso-popup"
      style={{ left, top, width: POPUP_W }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="lasso-popup-header">
        <span>Refine highlighted region</span>
        <button
          className="x"
          onClick={onCancel}
          disabled={busy}
          title="Cancel"
        >
          ×
        </button>
      </div>
      <img
        src={preview}
        alt="region preview"
        className="mesh-lasso-thumb"
      />
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="e.g. make this leg brass instead of wood; add wheels here; remove this cushion"
        rows={3}
        disabled={busy}
      />
      <div className="lasso-popup-actions">
        <button onClick={submit} disabled={!text.trim() || busy}>
          {busy
            ? `Refining… (${(elapsedMs / 1000).toFixed(1)}s)`
            : "Refine mesh (~$0.25)"}
        </button>
        <span className="hint">⌘/Ctrl+Enter</span>
      </div>
    </div>
  );
}
