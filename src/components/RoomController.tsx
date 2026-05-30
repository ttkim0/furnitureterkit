// On-canvas controller for placing the user's piece in the room without
// needing camera-pan finger gymnastics. Directional pad nudges the mesh
// across the floor in world meters; +/- buttons scale uniformly via spec.
// Shown in room mode only.

interface RoomControllerProps {
  // Mesh offset (in meters) — for the display only; movement uses the
  // relative nudge callback so rapid clicks compound correctly.
  offset: [number, number, number];
  // Y-axis rotation in radians (for the readout only).
  rotationY: number;
  // Relative-nudge callback: pass dx/dz in meters. App applies functionally
  // so multiple synchronous clicks accumulate (each click would otherwise
  // see the same stale offset from closure).
  onNudge: (dx: number, dz: number) => void;
  // Relative-rotate callback: pass +/- radians. App applies functionally.
  onRotate: (deltaRad: number) => void;
  onRecenter: () => void;
  // Current uniform scale multiplier (1.0 = original).
  multiplier: number;
  // Relative-scale callback: pass a multiplicative factor (e.g. 1.1 to
  // grow, 1/1.1 to shrink). App applies functionally.
  onScale: (factor: number) => void;
  // Step sizes (meters / radians / scale factor per click).
  moveStep?: number;
  rotateStep?: number;
  scaleStep?: number;
}

export function RoomController({
  offset: _offset,
  rotationY,
  onNudge,
  onRotate,
  onRecenter,
  multiplier,
  onScale,
  moveStep = 0.25,
  rotateStep = Math.PI / 12, // 15° per click
  scaleStep = 1.1,
}: RoomControllerProps) {
  const nudge = (dx: number, dz: number) => {
    onNudge(dx * moveStep, dz * moveStep);
  };
  const rotate = (sign: 1 | -1) => {
    onRotate(sign * rotateStep);
  };
  const scale = (factor: number) => {
    onScale(factor);
  };
  // Normalize rotation to [0, 360) for display
  const degDisplay = (((rotationY * 180) / Math.PI) % 360 + 360) % 360;
  return (
    <div className="room-controller">
      <div className="room-controller-section">
        <div className="room-controller-label">Move</div>
        <div className="room-controller-dpad">
          <button
            className="rc-btn rc-up"
            onClick={() => nudge(0, -1)}
            title="Move back (away from camera)"
          >
            ↑
          </button>
          <button
            className="rc-btn rc-left"
            onClick={() => nudge(-1, 0)}
            title="Move left"
          >
            ←
          </button>
          <button
            className="rc-btn rc-center"
            onClick={onRecenter}
            title="Recenter"
          >
            ◎
          </button>
          <button
            className="rc-btn rc-right"
            onClick={() => nudge(1, 0)}
            title="Move right"
          >
            →
          </button>
          <button
            className="rc-btn rc-down"
            onClick={() => nudge(0, 1)}
            title="Move forward (toward camera)"
          >
            ↓
          </button>
        </div>
      </div>
      <div className="room-controller-section">
        <div className="room-controller-label">Rotate</div>
        <div className="room-controller-scale">
          <button
            className="rc-btn"
            onClick={() => rotate(-1)}
            title="Rotate left 15°"
          >
            ↺
          </button>
          <span className="rc-readout">{Math.round(degDisplay)}°</span>
          <button
            className="rc-btn"
            onClick={() => rotate(1)}
            title="Rotate right 15°"
          >
            ↻
          </button>
        </div>
      </div>
      <div className="room-controller-section">
        <div className="room-controller-label">Size</div>
        <div className="room-controller-scale">
          <button
            className="rc-btn"
            onClick={() => scale(1 / scaleStep)}
            title="Smaller"
          >
            −
          </button>
          <span className="rc-readout">{multiplier.toFixed(2)}×</span>
          <button
            className="rc-btn"
            onClick={() => scale(scaleStep)}
            title="Larger"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
