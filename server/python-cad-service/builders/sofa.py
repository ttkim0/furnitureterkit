"""Sofa CAD builder. Frame + cushions, parametric from SofaSpec."""
from __future__ import annotations

from build123d import Box, Compound, Location, Part
from ..common import BomItem, BuildResult, CutlistItem, make_panel


def build_sofa(spec: dict) -> BuildResult:
    seat_w = float(spec["seat_width_mm"])
    seat_d = float(spec["seat_depth_mm"])
    seat_h = float(spec["seat_height_mm"])
    back_h = float(spec["back_height_mm"])
    arm_h = float(spec.get("arm_height_mm", 250))
    arm_w = float(spec.get("arm_width_mm", 120))
    cushion_count = int(spec.get("cushion_count", 3))
    leg_count = int(spec.get("leg_count", 4))
    leg_h = float(spec.get("leg_height_mm", 100))
    frame_material = spec.get("frame_material", "Pine")
    upholstery_material = spec.get("upholstery_material", "Linen")
    upholstery_color = spec.get("upholstery_color", "Natural")
    fill_material = spec.get("fill_material", "HD foam")

    overall_w = seat_w + 2 * arm_w
    overall_d = seat_d + 80  # back panel adds 80mm depth
    frame_thk = 18.0
    panel_thk = 9.0

    parts: dict[str, Part] = {}
    cutlist: list[CutlistItem] = []
    bom: list[BomItem] = []

    # ── Frame box (deck, back panel, side panels) ─────────────────────────
    # Deck (seat platform)
    deck_z = seat_h - 80  # cushion sits on top
    parts["deck"] = make_panel(seat_w, seat_d, frame_thk, "deck").moved(
        Location((0, 0, deck_z))
    )
    cutlist.append(
        CutlistItem(
            name="deck",
            qty=1,
            width_mm=seat_w,
            depth_mm=seat_d,
            thickness_mm=frame_thk,
            material=frame_material,
            notes="Seat platform. Drill ventilation holes (50mm × 6mm grid).",
        )
    )

    # Back panel (upright)
    back_z = seat_h + back_h / 2
    back_panel_h = back_h + 80  # extends below seat top
    parts["back_panel"] = make_panel(
        seat_w, panel_thk, back_panel_h, "back_panel"
    ).moved(Location((0, seat_d / 2 - panel_thk / 2, back_z - 40)))
    cutlist.append(
        CutlistItem(
            name="back_panel",
            qty=1,
            width_mm=seat_w,
            depth_mm=panel_thk,
            thickness_mm=back_panel_h,
            material=frame_material,
            notes="Back support panel. Will be upholstered.",
        )
    )

    # Arm panels
    arm_panel_h = seat_h + arm_h - leg_h
    arm = make_panel(arm_w, seat_d, arm_panel_h, "arm").moved(
        Location((0, 0, leg_h + arm_panel_h / 2))
    )
    parts["arm_left"] = arm.moved(Location((-(seat_w / 2 + arm_w / 2), 0, 0)))
    parts["arm_right"] = arm.moved(Location((seat_w / 2 + arm_w / 2, 0, 0)))
    cutlist.append(
        CutlistItem(
            name="arm",
            qty=2,
            width_mm=arm_w,
            depth_mm=seat_d,
            thickness_mm=arm_panel_h,
            material=frame_material,
            notes="Side arm panels. Upholstered after assembly.",
        )
    )

    # ── Cushions ──────────────────────────────────────────────────────────
    cushion_w = (seat_w - (cushion_count - 1) * 10) / cushion_count
    cushion_h = 120
    cushion_z = seat_h + cushion_h / 2 - frame_thk
    for i in range(cushion_count):
        cx = -seat_w / 2 + cushion_w / 2 + i * (cushion_w + 10)
        parts[f"cushion_{i + 1}"] = (
            Box(cushion_w, seat_d - 40, cushion_h)
            .moved(Location((cx, -20, cushion_z)))
        )
    cutlist.append(
        CutlistItem(
            name="cushion",
            qty=cushion_count,
            width_mm=cushion_w,
            depth_mm=seat_d - 40,
            thickness_mm=cushion_h,
            material=f"{fill_material} core + {upholstery_material} cover ({upholstery_color})",
            notes="Foam cushions with removable upholstered covers.",
        )
    )

    # ── Legs ──────────────────────────────────────────────────────────────
    leg_thk = 50
    leg = Box(leg_thk, leg_thk, leg_h).moved(Location((0, 0, leg_h / 2)))
    leg_x = overall_w / 2 - leg_thk / 2 - 30
    leg_y = overall_d / 2 - leg_thk / 2 - 30
    parts["leg_fl"] = leg.moved(Location((-leg_x, -leg_y, 0)))
    parts["leg_fr"] = leg.moved(Location((leg_x, -leg_y, 0)))
    parts["leg_bl"] = leg.moved(Location((-leg_x, leg_y, 0)))
    parts["leg_br"] = leg.moved(Location((leg_x, leg_y, 0)))
    cutlist.append(
        CutlistItem(
            name="leg",
            qty=4,
            width_mm=leg_thk,
            depth_mm=leg_thk,
            thickness_mm=leg_h,
            material=spec.get("leg_material", frame_material),
            notes="Sofa legs. Attach to frame with M8 hanger bolts.",
        )
    )

    bom.extend(
        [
            BomItem("M8 hanger bolts", 4, "ea", "Threaded leg attachment", "hardware"),
            BomItem("Wood screws #8 × 50mm", 40, "ea", "Frame assembly", "hardware"),
            BomItem("Upholstery staples 10mm", 1, "box", "For attaching fabric", "hardware"),
            BomItem("Wood glue (PVA)", 1, "bottle", "Titebond II", "adhesive"),
            BomItem(
                f"{upholstery_material} fabric",
                int((overall_w * overall_d * 2 + arm_panel_h * seat_d * 4) / 1_000_000) + 2,
                "m²",
                f"Color: {upholstery_color}. Calculate +20% waste.",
                "other",
            ),
            BomItem(f"{fill_material} blocks", cushion_count, "ea", "Cushion fill", "other"),
        ]
    )

    assembly = Compound(children=list(parts.values()), label="sofa")
    return BuildResult(
        category="sofa",
        parts=parts,
        assembly=assembly,
        cutlist=cutlist,
        bom=bom,
        panel_parts=["deck", "back_panel", "arm_left", "arm_right"],
        notes=(
            f"Parametric sofa. Frame: {frame_material}. Cushions: {cushion_count} × "
            f"({fill_material} fill, {upholstery_material} cover in {upholstery_color}). "
            f"Build frame first; upholster panels before final assembly; attach legs last. "
            f"Add webbing or springs to deck for seat support (not modeled)."
        ),
    )
