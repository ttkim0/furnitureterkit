// Furniture templates. Each template function takes the user's prompt (kept
// for record) and returns a Model. New templates are registered in TEMPLATES.

let modelCounter = 0;

function modelId() {
  return `model-${++modelCounter}-${Date.now()}`;
}

const WOOD = "#7a5634";
const WOOD_LIGHT = "#a87b4f";
const WOOD_MID = "#8c6239";
const FABRIC = "#d8d0c4";

// ─── TABLE ────────────────────────────────────────────────────────────────
export function tableTemplate(prompt) {
  const TOP_T = 0.08;
  const W = 2.0,
    D = 1.0,
    H = 1.0;
  const LEG = 0.1;
  const PANEL_H = 0.2,
    PANEL_T = 0.04;

  const topY = H - TOP_T / 2;
  const legH = H - TOP_T;
  const legY = legH / 2;
  const halfW = W / 2,
    halfD = D / 2;
  const panelY = H - TOP_T - PANEL_H / 2;

  const leg = (id, label, x, z) => ({
    id,
    label,
    shape: "box",
    position: [x, legY, z],
    size: [LEG, legH, LEG],
    color: WOOD,
    anchor: [0, -1, 0],
    scale: [1, 1, 1],
  });

  return {
    id: modelId(),
    template: "table",
    prompt,
    parts: [
      {
        id: "top",
        label: "Tabletop",
        shape: "box",
        position: [0, topY, 0],
        size: [W, TOP_T, D],
        color: WOOD_LIGHT,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      leg("leg_fl", "Front-left leg", -halfW + LEG / 2, halfD - LEG / 2),
      leg("leg_fr", "Front-right leg", halfW - LEG / 2, halfD - LEG / 2),
      leg("leg_bl", "Back-left leg", -halfW + LEG / 2, -halfD + LEG / 2),
      leg("leg_br", "Back-right leg", halfW - LEG / 2, -halfD + LEG / 2),
      {
        id: "panel_front",
        label: "Front apron",
        shape: "box",
        position: [0, panelY, halfD - PANEL_T / 2],
        size: [W - 2 * LEG, PANEL_H, PANEL_T],
        color: WOOD_MID,
        anchor: [0, 1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "panel_back",
        label: "Back apron",
        shape: "box",
        position: [0, panelY, -halfD + PANEL_T / 2],
        size: [W - 2 * LEG, PANEL_H, PANEL_T],
        color: WOOD_MID,
        anchor: [0, 1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "panel_left",
        label: "Left apron",
        shape: "box",
        position: [-halfW + PANEL_T / 2, panelY, 0],
        size: [PANEL_T, PANEL_H, D - 2 * LEG],
        color: WOOD_MID,
        anchor: [0, 1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "panel_right",
        label: "Right apron",
        shape: "box",
        position: [halfW - PANEL_T / 2, panelY, 0],
        size: [PANEL_T, PANEL_H, D - 2 * LEG],
        color: WOOD_MID,
        anchor: [0, 1, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

// ─── DESK ─────────────────────────────────────────────────────────────────
// A single-pedestal desk: two legs on the left, a closed pedestal on the
// right, top spanning both.
export function deskTemplate(prompt) {
  const TOP_T = 0.04;
  const W = 1.4,
    D = 0.7,
    H = 0.75;
  const LEG = 0.06;
  const PEDESTAL_W = 0.45;
  const PEDESTAL_H = H - TOP_T;
  const PEDESTAL_D = D - 0.05;

  const topY = H - TOP_T / 2;
  const legH = H - TOP_T;
  const legY = legH / 2;
  const halfW = W / 2,
    halfD = D / 2;
  const pedestalCx = halfW - PEDESTAL_W / 2;

  const leg = (id, label, x, z) => ({
    id,
    label,
    shape: "box",
    position: [x, legY, z],
    size: [LEG, legH, LEG],
    color: WOOD,
    anchor: [0, -1, 0],
    scale: [1, 1, 1],
  });

  return {
    id: modelId(),
    template: "desk",
    prompt,
    parts: [
      {
        id: "top",
        label: "Desktop",
        shape: "box",
        position: [0, topY, 0],
        size: [W, TOP_T, D],
        color: WOOD_LIGHT,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      leg("leg_fl", "Front-left leg", -halfW + LEG / 2, halfD - LEG / 2),
      leg("leg_bl", "Back-left leg", -halfW + LEG / 2, -halfD + LEG / 2),
      {
        id: "pedestal",
        label: "Drawer pedestal",
        shape: "box",
        position: [pedestalCx, PEDESTAL_H / 2, 0],
        size: [PEDESTAL_W, PEDESTAL_H, PEDESTAL_D],
        color: WOOD_MID,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "drawer_face",
        label: "Drawer face",
        shape: "box",
        position: [pedestalCx, PEDESTAL_H * 0.7, halfD - 0.01],
        size: [PEDESTAL_W - 0.04, PEDESTAL_H * 0.18, 0.015],
        color: WOOD,
        anchor: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

// ─── BED ──────────────────────────────────────────────────────────────────
// Queen-ish bed: 4 legs + 2 side rails + headboard + footboard + mattress.
export function bedTemplate(prompt) {
  const W = 1.6; // x
  const L = 2.05; // z (head at +z, foot at -z)
  const LEG_W = 0.08;
  const LEG_H = 0.2;
  const RAIL_T = 0.05;
  const RAIL_H = 0.18;
  const MATTRESS_H = 0.25;
  const HEADBOARD_H = 1.1;
  const HEADBOARD_T = 0.05;
  const FOOTBOARD_H = 0.5;
  const FOOTBOARD_T = 0.05;

  const halfW = W / 2,
    halfL = L / 2;
  const legY = LEG_H / 2;
  const railY = LEG_H + RAIL_H / 2;
  const mattressY = LEG_H + RAIL_H + MATTRESS_H / 2;

  const leg = (id, label, x, z) => ({
    id,
    label,
    shape: "box",
    position: [x, legY, z],
    size: [LEG_W, LEG_H, LEG_W],
    color: WOOD,
    anchor: [0, -1, 0],
    scale: [1, 1, 1],
  });

  return {
    id: modelId(),
    template: "bed",
    prompt,
    parts: [
      leg("leg_fl", "Foot-left leg", -halfW + LEG_W / 2, -halfL + LEG_W / 2),
      leg("leg_fr", "Foot-right leg", halfW - LEG_W / 2, -halfL + LEG_W / 2),
      leg("leg_hl", "Head-left leg", -halfW + LEG_W / 2, halfL - LEG_W / 2),
      leg("leg_hr", "Head-right leg", halfW - LEG_W / 2, halfL - LEG_W / 2),
      {
        id: "rail_left",
        label: "Left side rail",
        shape: "box",
        position: [-halfW + RAIL_T / 2, railY, 0],
        size: [RAIL_T, RAIL_H, L - 2 * LEG_W],
        color: WOOD_MID,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "rail_right",
        label: "Right side rail",
        shape: "box",
        position: [halfW - RAIL_T / 2, railY, 0],
        size: [RAIL_T, RAIL_H, L - 2 * LEG_W],
        color: WOOD_MID,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "headboard",
        label: "Headboard",
        shape: "box",
        position: [0, HEADBOARD_H / 2, halfL + HEADBOARD_T / 2],
        size: [W + 0.1, HEADBOARD_H, HEADBOARD_T],
        color: WOOD_LIGHT,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "footboard",
        label: "Footboard",
        shape: "box",
        position: [0, FOOTBOARD_H / 2, -halfL - FOOTBOARD_T / 2],
        size: [W + 0.1, FOOTBOARD_H, FOOTBOARD_T],
        color: WOOD_LIGHT,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "mattress",
        label: "Mattress",
        shape: "box",
        position: [0, mattressY, 0],
        size: [W - 0.04, MATTRESS_H, L - 0.04],
        color: FABRIC,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

// ─── CHAIR ────────────────────────────────────────────────────────────────
export function chairTemplate(prompt) {
  const SEAT_W = 0.45;
  const SEAT_D = 0.45;
  const SEAT_T = 0.05;
  const SEAT_H = 0.45;
  const LEG_W = 0.04;
  const LEG_H = SEAT_H - SEAT_T;
  const BACK_H = 0.55;
  const BACK_T = 0.04;

  const halfW = SEAT_W / 2,
    halfD = SEAT_D / 2;
  const legY = LEG_H / 2;
  const seatY = SEAT_H - SEAT_T / 2;

  const leg = (id, label, x, z) => ({
    id,
    label,
    shape: "box",
    position: [x, legY, z],
    size: [LEG_W, LEG_H, LEG_W],
    color: WOOD,
    anchor: [0, -1, 0],
    scale: [1, 1, 1],
  });

  return {
    id: modelId(),
    template: "chair",
    prompt,
    parts: [
      leg("leg_fl", "Front-left leg", -halfW + LEG_W / 2, halfD - LEG_W / 2),
      leg("leg_fr", "Front-right leg", halfW - LEG_W / 2, halfD - LEG_W / 2),
      leg("leg_bl", "Back-left leg", -halfW + LEG_W / 2, -halfD + LEG_W / 2),
      leg("leg_br", "Back-right leg", halfW - LEG_W / 2, -halfD + LEG_W / 2),
      {
        id: "seat",
        label: "Seat",
        shape: "box",
        position: [0, seatY, 0],
        size: [SEAT_W, SEAT_T, SEAT_D],
        color: WOOD_LIGHT,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "back",
        label: "Backrest",
        shape: "box",
        position: [0, SEAT_H + BACK_H / 2, -halfD + BACK_T / 2],
        size: [SEAT_W, BACK_H, BACK_T],
        color: WOOD_LIGHT,
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

// ─── LAMP ─────────────────────────────────────────────────────────────────
// Demonstrates non-box primitives: cylindrical base + pole, conical shade,
// spherical bulb peeking through.
export function lampTemplate(prompt) {
  const BASE_D = 0.25;
  const BASE_H = 0.04;
  const POLE_D = 0.025;
  const POLE_H = 0.55;
  const SHADE_BASE_D = 0.32;
  const SHADE_H = 0.22;
  const BULB_D = 0.07;

  const baseY = BASE_H / 2;
  const poleY = BASE_H + POLE_H / 2;
  const shadeY = BASE_H + POLE_H + SHADE_H / 2;
  const bulbY = BASE_H + POLE_H + 0.05;

  return {
    id: modelId(),
    template: "lamp",
    prompt,
    parts: [
      {
        id: "base",
        label: "Base",
        shape: "cylinder",
        position: [0, baseY, 0],
        size: [BASE_D, BASE_H, BASE_D],
        color: "#222222",
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "pole",
        label: "Pole",
        shape: "cylinder",
        position: [0, poleY, 0],
        size: [POLE_D, POLE_H, POLE_D],
        color: "#a0a0a8",
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
      {
        id: "bulb",
        label: "Bulb",
        shape: "sphere",
        position: [0, bulbY, 0],
        size: [BULB_D, BULB_D, BULB_D],
        color: "#fff5cc",
        anchor: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {
        id: "shade",
        label: "Shade",
        shape: "cone",
        position: [0, shadeY, 0],
        size: [SHADE_BASE_D, SHADE_H, SHADE_BASE_D],
        color: "#d8d0c4",
        anchor: [0, -1, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

// ─── REGISTRY ─────────────────────────────────────────────────────────────
export const TEMPLATES = {
  table: tableTemplate,
  desk: deskTemplate,
  bed: bedTemplate,
  chair: chairTemplate,
  lamp: lampTemplate,
};

export function listTemplates() {
  return Object.keys(TEMPLATES);
}

export function generateFromTemplate(templateId, prompt) {
  const fn = TEMPLATES[templateId] ?? TEMPLATES.table;
  return fn(prompt);
}
