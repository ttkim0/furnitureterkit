import { useEffect, useRef, useState } from "react";
import type { Point2D } from "../lib/projection";

interface LassoOverlayProps {
  active: boolean;
  onLasso: (points: Point2D[]) => void;
  onCancel: () => void;
}

// Transparent overlay that captures pointer events while in lasso mode.
// Renders the in-progress freehand path as an SVG. Calls onLasso(points)
// on pointer release with the screen-space polygon.
export function LassoOverlay({ active, onLasso, onCancel }: LassoOverlayProps) {
  const [points, setPoints] = useState<Point2D[]>([]);
  const drawing = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) {
      setPoints([]);
      drawing.current = false;
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onCancel]);

  if (!active) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    drawing.current = true;
    overlayRef.current?.setPointerCapture(e.pointerId);
    const rect = overlayRef.current!.getBoundingClientRect();
    setPoints([{ x: e.clientX - rect.left, y: e.clientY - rect.top }]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const rect = overlayRef.current!.getBoundingClientRect();
    setPoints((p) => [
      ...p,
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
    ]);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    drawing.current = false;
    overlayRef.current?.releasePointerCapture(e.pointerId);
    if (points.length >= 3) {
      onLasso(points);
    } else {
      setPoints([]);
    }
  };

  const path =
    points.length > 0
      ? `M ${points[0].x},${points[0].y} ` +
        points
          .slice(1)
          .map((p) => `L ${p.x},${p.y}`)
          .join(" ") +
        " Z"
      : "";

  return (
    <div
      ref={overlayRef}
      className="lasso-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="lasso-svg" xmlns="http://www.w3.org/2000/svg">
        {path && (
          <path
            d={path}
            fill="rgba(255, 170, 0, 0.12)"
            stroke="#ffaa00"
            strokeWidth="2"
            strokeDasharray="6 4"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <div className="lasso-hint">
        Drag around the parts you want to edit. <kbd>Esc</kbd> to cancel.
      </div>
    </div>
  );
}
