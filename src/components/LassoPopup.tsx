import { useEffect, useState } from "react";
import type { ModelPart } from "../lib/model";
import type { Point2D } from "../lib/projection";

interface LassoPopupProps {
  parts: ModelPart[];
  position: Point2D;
  canvasSize: { width: number; height: number };
  onSubmit: (text: string) => void;
  onCancel: () => void;
  busy: boolean;
  progress?: { done: number; total: number };
}

// Floating popup that appears at the lasso centroid. Lets the user type a
// single edit prompt and apply it to every part inside the lasso in batch.
export function LassoPopup({
  parts,
  position,
  canvasSize,
  onSubmit,
  onCancel,
  busy,
  progress,
}: LassoPopupProps) {
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

  // Clamp position so the popup stays in the canvas
  const POPUP_W = 280;
  const POPUP_H = 200;
  const left = Math.max(8, Math.min(position.x - POPUP_W / 2, canvasSize.width - POPUP_W - 8));
  const top = Math.max(8, Math.min(position.y + 16, canvasSize.height - POPUP_H - 8));

  return (
    <div
      className="lasso-popup"
      style={{ left, top, width: POPUP_W }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="lasso-popup-header">
        <span>
          <strong>{parts.length}</strong> part{parts.length === 1 ? "" : "s"}{" "}
          selected
        </span>
        <button className="x" onClick={onCancel} disabled={busy} title="Cancel">
          ×
        </button>
      </div>
      <div className="lasso-popup-parts" title={parts.map((p) => p.label).join(", ")}>
        {parts.map((p) => p.label).join(", ")}
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="e.g. make these darker walnut"
        rows={3}
        disabled={busy}
      />
      <div className="lasso-popup-actions">
        <button onClick={submit} disabled={!text.trim() || busy}>
          {busy
            ? progress
              ? `Editing… (${progress.done}/${progress.total})`
              : "Editing…"
            : `Apply to ${parts.length}`}
        </button>
        <span className="hint">⌘/Ctrl+Enter</span>
      </div>
    </div>
  );
}
