"""Bed CAD builder. Headboard + footboard + side rails + slats."""
from __future__ import annotations

from build123d import Box, Compound, Location, Part
from ..common import BomItem, BuildResult, CutlistItem, make_panel


def build_bed(spec: dict) -> BuildResult:
    mw = float(spec["mattress_width_mm"])
    ml = float(spec["mattress_length_mm"])
    mh = float(spec.get("mattress_height_mm", 200))
    frame_h = float(spec.get("frame_height_mm", 350))  # floor to top of side rail
    has_hb = bool(spec.get("has_headboard", True))
    hb_h = float(spec.get("headboard_height_mm", 1100)) if has_hb else 0
    has_fb = bool(spec.get("has_footboard", False))
    fb_h = float(spec.get("footboard_height_mm", 500)) if has_fb else 0
    material = spec.get("frame_material", "Oak")
    finish = spec.get("finish", "Satin lacquer")

    rail_h = 200.0  # side rail height
    rail_thk = 30.0
    slat_thk = 18.0
    slat_w = 70.0
    slat_count = max(8, int(ml / 100))  # ~one slat per 100mm

    parts: dict[str, Part] = {}
    cutlist: list[CutlistItem] = []
    bom: list[BomItem] = []

    side_rail_z = frame_h - rail_h / 2
    side_rail_x = mw / 2 + rail_thk / 2

    # Side rails (run along length)
    side_rail = Box(rail_thk, ml + 2 * rail_thk, rail_h)
    parts["rail_left"] = side_rail.moved(Location((-side_rail_x, 0, side_rail_z)))
    parts["rail_right"] = side_rail.moved(Location((side_rail_x, 0, side_rail_z)))
    cutlist.append(
        CutlistItem(
            "side_rail",
            2,
            rail_thk,
            ml + 2 * rail_thk,
            rail_h,
            material,
            "Side rails. Mortise/bolted to head and foot boards.",
        )
    )

    # Headboard
    if has_hb:
        hb_y = -(ml / 2 + rail_thk + 9)
        hb = Box(mw + 2 * rail_thk, 18, hb_h).moved(
            Location((0, hb_y, hb_h / 2))
        )
        parts["headboard"] = hb
        cutlist.append(
            CutlistItem(
                "headboard",
                1,
                mw + 2 * rail_thk,
                18,
                hb_h,
                material,
                f"Headboard panel. {('Upholster front' if spec.get('upholstered_panels') else 'Sand and finish')}.",
            )
        )

    # Footboard
    if has_fb:
        fb_y = ml / 2 + rail_thk + 9
        fb = Box(mw + 2 * rail_thk, 18, fb_h).moved(
            Location((0, fb_y, fb_h / 2))
        )
        parts["footboard"] = fb
        cutlist.append(
            CutlistItem(
                "footboard",
                1,
                mw + 2 * rail_thk,
                18,
                fb_h,
                material,
                "Footboard panel.",
            )
        )

    # Slats (mattress support)
    slat_z = frame_h - rail_h / 2 + 10
    slat = Box(mw + 30, slat_w, slat_thk)
    spacing = (ml - slat_count * slat_w) / (slat_count - 1)
    for i in range(slat_count):
        y = -ml / 2 + slat_w / 2 + i * (slat_w + spacing)
        parts[f"slat_{i + 1}"] = slat.moved(Location((0, y, slat_z)))
    cutlist.append(
        CutlistItem(
            "slat",
            slat_count,
            mw + 30,
            slat_w,
            slat_thk,
            material,
            "Mattress support slats. Rest on cleats screwed to inside of side rails.",
        )
    )

    # Cleats (slat support, screwed to inside face of side rails)
    cleat_l = ml - 50
    cleat = Box(15, cleat_l, 25)
    parts["cleat_left"] = cleat.moved(Location((-mw / 2 + 7.5, 0, side_rail_z - 25 / 2)))
    parts["cleat_right"] = cleat.moved(Location((mw / 2 - 7.5, 0, side_rail_z - 25 / 2)))
    cutlist.append(
        CutlistItem(
            "cleat",
            2,
            15,
            cleat_l,
            25,
            material,
            "Slat cleats. Screw to inside face of side rails, flush with bottom.",
        )
    )

    bom.extend(
        [
            BomItem("Bed bolt + cap nut", 8, "ea", "M8 × 100mm. For rail-to-board joints.", "hardware"),
            BomItem("Wood screws #8 × 40mm", 20, "ea", "Cleats + slats", "hardware"),
            BomItem("Wood glue (PVA)", 1, "bottle", "Titebond II", "adhesive"),
            BomItem("Finish", 1, "batch", finish, "finish"),
        ]
    )
    if spec.get("upholstered_panels"):
        bom.append(
            BomItem(
                "Upholstery fabric + 2lb foam",
                1,
                "kit",
                f"Color: {spec.get('upholstery_color', 'TBD')}. Wrap headboard front face.",
                "other",
            )
        )

    assembly = Compound(children=list(parts.values()), label="bed")
    return BuildResult(
        category="bed",
        parts=parts,
        assembly=assembly,
        cutlist=cutlist,
        bom=bom,
        panel_parts=[n for n in ("headboard", "footboard") if n in parts],
        notes=(
            f"Parametric bed frame, {spec.get('mattress_size', 'custom')} size "
            f"({int(mw)}×{int(ml)}mm mattress). Frame uses bed bolts for "
            f"knock-down construction (the right way to do this — beds need "
            f"to come apart for moving). Cleats support slats; slats support "
            f"mattress. No box-spring needed if slats are spaced ≤100mm."
        ),
    )
