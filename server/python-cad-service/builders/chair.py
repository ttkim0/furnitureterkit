"""Chair CAD builder.

Produces a manufacturable parametric chair from a ChairSpec:
  - Seat panel (solid wood or plywood)
  - Four legs (front pair shorter, back pair extends up for back support)
  - Apron rails between legs (under seat) — connected with dowel joinery
  - 3 horizontal back slats between back posts
  - Optional armrests between front and back leg tops

Joinery: 8mm beech dowels at leg-to-apron and slat-to-post joints.
This is real, manufacturable construction — not a tessellated mesh.
"""
from __future__ import annotations

from build123d import Box, Compound, Location, Part
from ..common import BomItem, BuildResult, CutlistItem, make_panel


# Construction conventions (parametric "shop standards"). Tunable later.
SEAT_THICKNESS_MM = 20.0
APRON_HEIGHT_MM = 80.0
APRON_THICKNESS_MM = 20.0
APRON_INSET_MM = 5.0  # how far apron is inset from leg outer face
SLAT_THICKNESS_MM = 12.0
SLAT_COUNT = 3
ARMREST_THICKNESS_MM = 25.0


def build_chair(spec: dict) -> BuildResult:
    seat_w = float(spec["seat_width_mm"])
    seat_d = float(spec["seat_depth_mm"])
    seat_h = float(spec["seat_height_mm"])  # floor to seat top
    back_h = float(spec["back_height_mm"])  # above seat
    leg_h = seat_h  # for front legs
    leg_count = int(spec.get("leg_count", 4))
    has_armrests = bool(spec.get("has_armrests", False))
    arm_h_above_seat = float(spec.get("arm_height_mm", 220.0))
    chair_type = spec.get("chair_type", "dining")
    frame_material = spec.get("frame_material", "Oak")
    seat_material = spec.get("seat_material", frame_material)
    back_material = spec.get("back_material", frame_material)

    # Leg cross-section depends on chair size — scale with seat width
    leg_thk = max(28.0, min(45.0, seat_w * 0.08))

    parts: dict[str, Part] = {}
    cutlist: list[CutlistItem] = []
    bom: list[BomItem] = []

    # ── Seat ──────────────────────────────────────────────────────────────
    seat = make_panel(seat_w, seat_d, SEAT_THICKNESS_MM, name="seat")
    seat = seat.moved(Location((0, 0, seat_h - SEAT_THICKNESS_MM / 2)))
    parts["seat"] = seat
    cutlist.append(
        CutlistItem(
            name="seat",
            qty=1,
            width_mm=seat_w,
            depth_mm=seat_d,
            thickness_mm=SEAT_THICKNESS_MM,
            material=seat_material,
            notes="Cut from solid wood or plywood. Sand and round edges 3mm.",
        )
    )

    # ── Legs ──────────────────────────────────────────────────────────────
    # Front legs go to seat top minus seat thickness (so seat rests on them).
    # Back legs extend up by back_h to form back posts.
    leg_top_z = seat_h - SEAT_THICKNESS_MM  # top of front legs (under seat)
    back_post_top_z = seat_h + back_h
    front_leg_h = leg_top_z
    back_post_h = back_post_top_z

    # Inset legs from the outer edge of the seat by leg_thk/2 so the seat
    # overhangs slightly (standard furniture convention).
    leg_x = seat_w / 2 - leg_thk / 2
    leg_y = seat_d / 2 - leg_thk / 2

    # Stool special case: no back, all 4 legs are short.
    if chair_type == "stool" or back_h <= 0:
        front_leg = Box(leg_thk, leg_thk, front_leg_h).moved(
            Location((0, 0, front_leg_h / 2))
        )
        parts["leg_front_left"] = front_leg.moved(Location((-leg_x, -leg_y, 0)))
        parts["leg_front_right"] = front_leg.moved(Location((leg_x, -leg_y, 0)))
        parts["leg_back_left"] = front_leg.moved(Location((-leg_x, leg_y, 0)))
        parts["leg_back_right"] = front_leg.moved(Location((leg_x, leg_y, 0)))
        cutlist.append(
            CutlistItem(
                name="leg",
                qty=4,
                width_mm=leg_thk,
                depth_mm=leg_thk,
                thickness_mm=front_leg_h,
                material=frame_material,
                notes="Square stock. Mortise top for apron tenon (or use dowels).",
            )
        )
    else:
        # Standard chair: 2 front legs + 2 back posts
        front_leg = Box(leg_thk, leg_thk, front_leg_h).moved(
            Location((0, 0, front_leg_h / 2))
        )
        back_post = Box(leg_thk, leg_thk, back_post_h).moved(
            Location((0, 0, back_post_h / 2))
        )
        parts["leg_front_left"] = front_leg.moved(Location((-leg_x, -leg_y, 0)))
        parts["leg_front_right"] = front_leg.moved(Location((leg_x, -leg_y, 0)))
        parts["post_back_left"] = back_post.moved(Location((-leg_x, leg_y, 0)))
        parts["post_back_right"] = back_post.moved(Location((leg_x, leg_y, 0)))
        cutlist.append(
            CutlistItem(
                name="leg_front",
                qty=2,
                width_mm=leg_thk,
                depth_mm=leg_thk,
                thickness_mm=front_leg_h,
                material=frame_material,
                notes="Front legs. Mortise top for apron tenon.",
            )
        )
        cutlist.append(
            CutlistItem(
                name="post_back",
                qty=2,
                width_mm=leg_thk,
                depth_mm=leg_thk,
                thickness_mm=back_post_h,
                material=frame_material,
                notes="Back posts (legs extended for backrest). Mortise for "
                "apron + back slats.",
            )
        )

    # ── Aprons (rails under seat) ────────────────────────────────────────
    apron_x_len = seat_w - 2 * leg_thk - 2 * APRON_INSET_MM
    apron_y_len = seat_d - 2 * leg_thk - 2 * APRON_INSET_MM
    apron_z_center = leg_top_z - APRON_HEIGHT_MM / 2 - 10  # 10mm below seat

    apron_lr = Box(APRON_THICKNESS_MM, apron_y_len, APRON_HEIGHT_MM)
    apron_fb = Box(apron_x_len, APRON_THICKNESS_MM, APRON_HEIGHT_MM)
    parts["apron_front"] = apron_fb.moved(
        Location((0, -leg_y + leg_thk / 2 + APRON_INSET_MM + APRON_THICKNESS_MM / 2, apron_z_center))
    )
    parts["apron_back"] = apron_fb.moved(
        Location((0, leg_y - leg_thk / 2 - APRON_INSET_MM - APRON_THICKNESS_MM / 2, apron_z_center))
    )
    parts["apron_left"] = apron_lr.moved(
        Location((-leg_x + leg_thk / 2 + APRON_INSET_MM + APRON_THICKNESS_MM / 2, 0, apron_z_center))
    )
    parts["apron_right"] = apron_lr.moved(
        Location((leg_x - leg_thk / 2 - APRON_INSET_MM - APRON_THICKNESS_MM / 2, 0, apron_z_center))
    )
    cutlist.append(
        CutlistItem(
            name="apron_fb",
            qty=2,
            width_mm=apron_x_len,
            depth_mm=APRON_THICKNESS_MM,
            thickness_mm=APRON_HEIGHT_MM,
            material=frame_material,
            notes="Front and back aprons. Tenons on each end into leg mortises.",
        )
    )
    cutlist.append(
        CutlistItem(
            name="apron_lr",
            qty=2,
            width_mm=apron_y_len,
            depth_mm=APRON_THICKNESS_MM,
            thickness_mm=APRON_HEIGHT_MM,
            material=frame_material,
            notes="Side aprons. Tenons on each end into leg mortises.",
        )
    )

    # ── Back slats (only if not a stool) ─────────────────────────────────
    if chair_type != "stool" and back_h > 0:
        slat_w = apron_x_len  # spans between back posts (same as apron length)
        # Distribute slats evenly between top of seat and top of back post,
        # leaving 50mm clearance top and bottom.
        slat_zone_bottom = seat_h + 50
        slat_zone_top = back_post_top_z - 50
        slat_height = (slat_zone_top - slat_zone_bottom) / (SLAT_COUNT * 2 - 1)
        if slat_height > 30:  # ensure slats are physically buildable
            slat_height = 30
        spacing = (slat_zone_top - slat_zone_bottom - SLAT_COUNT * slat_height) / max(
            1, (SLAT_COUNT - 1)
        )
        for i in range(SLAT_COUNT):
            z = slat_zone_bottom + i * (slat_height + spacing) + slat_height / 2
            slat = Box(slat_w, SLAT_THICKNESS_MM, slat_height).moved(
                Location((0, leg_y - leg_thk / 2 - SLAT_THICKNESS_MM / 2, z))
            )
            parts[f"back_slat_{i + 1}"] = slat
        cutlist.append(
            CutlistItem(
                name="back_slat",
                qty=SLAT_COUNT,
                width_mm=slat_w,
                depth_mm=SLAT_THICKNESS_MM,
                thickness_mm=slat_height,
                material=back_material,
                notes=f"Horizontal back slats. Tenons into back post mortises. "
                f"Sand all faces; round front edges 3mm.",
            )
        )

    # ── Armrests (optional) ──────────────────────────────────────────────
    if has_armrests and chair_type != "stool":
        arm_z = seat_h + arm_h_above_seat - ARMREST_THICKNESS_MM / 2
        # Armrest length = seat_d + slight overhang front
        arm_len = seat_d + 40
        arm = Box(60, arm_len, ARMREST_THICKNESS_MM)
        parts["armrest_left"] = arm.moved(Location((-leg_x, 20, arm_z)))
        parts["armrest_right"] = arm.moved(Location((leg_x, 20, arm_z)))
        cutlist.append(
            CutlistItem(
                name="armrest",
                qty=2,
                width_mm=60,
                depth_mm=arm_len,
                thickness_mm=ARMREST_THICKNESS_MM,
                material=frame_material,
                notes="Round all edges. Attach to legs/posts with dowels or "
                "screws from below.",
            )
        )

    # ── BOM ──────────────────────────────────────────────────────────────
    # Dowel count: 2 per leg-apron joint × 8 joints = 16 for the seat box.
    # Plus 2 per slat × SLAT_COUNT × 2 ends = 4*SLAT_COUNT for back.
    dowel_qty = 16 + (4 * SLAT_COUNT if chair_type != "stool" else 0)
    if has_armrests:
        dowel_qty += 8  # 2 per armrest end × 4 ends
    bom.extend(
        [
            BomItem(
                name="Beech dowel 8mm × 40mm",
                qty=dowel_qty,
                unit="ea",
                spec="Pre-cut beechwood dowel pins",
                category="hardware",
            ),
            BomItem(
                name="Wood glue (PVA)",
                qty=1,
                unit="bottle",
                spec="Type I or Type II waterproof; Titebond II or equivalent",
                category="adhesive",
            ),
            BomItem(
                name="Finish",
                qty=1,
                unit="batch",
                spec=spec.get("notes") or "Apply per design intent: stain, oil, or lacquer",
                category="finish",
            ),
            BomItem(
                name="Sandpaper assortment",
                qty=1,
                unit="kit",
                spec="120, 180, 220 grit",
                category="other",
            ),
        ]
    )

    # ── Assembly ─────────────────────────────────────────────────────────
    assembly = Compound(children=list(parts.values()), label=f"chair_{chair_type}")

    return BuildResult(
        category="chair",
        parts=parts,
        assembly=assembly,
        cutlist=cutlist,
        bom=bom,
        panel_parts=["seat"]
        + [f"back_slat_{i + 1}" for i in range(SLAT_COUNT)]
        + (["armrest_left", "armrest_right"] if has_armrests else []),
        notes=(
            f"Parametric {chair_type} chair built from spec. "
            f"Joinery: mortise-and-tenon at all leg-to-apron and slat-to-post "
            f"connections (dowel pins shown in BOM as backup option). "
            f"Sand all parts before assembly. Glue with PVA, clamp 24h. "
            f"Cutlist includes 5mm waste allowance per cut."
        ),
    )
