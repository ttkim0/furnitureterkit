"""Table CAD builder. Top + 4 legs + optional apron, parametric from TableSpec."""
from __future__ import annotations

from build123d import Box, Compound, Location, Part
from ..common import BomItem, BuildResult, CutlistItem, make_panel


def build_table(spec: dict) -> BuildResult:
    top_w = float(spec["top_width_mm"])
    top_d = float(spec["top_depth_mm"])
    top_h = float(spec["top_height_mm"])
    top_thk = float(spec.get("top_thickness_mm", 25.0))
    leg_count = int(spec.get("leg_count", 4))
    leg_style = spec.get("leg_style", "straight")
    has_apron = bool(spec.get("has_apron", True))
    top_material = spec.get("top_material", "Oak")
    leg_material = spec.get("leg_material", top_material)

    leg_thk = max(40.0, min(70.0, top_w * 0.05))
    apron_h = 100.0
    apron_thk = 22.0
    apron_inset = 20.0  # how far apron sits in from edge of top

    parts: dict[str, Part] = {}
    cutlist: list[CutlistItem] = []
    bom: list[BomItem] = []

    # ── Top ───────────────────────────────────────────────────────────────
    parts["top"] = make_panel(top_w, top_d, top_thk, "top").moved(
        Location((0, 0, top_h - top_thk / 2))
    )
    cutlist.append(
        CutlistItem(
            name="top",
            qty=1,
            width_mm=top_w,
            depth_mm=top_d,
            thickness_mm=top_thk,
            material=top_material,
            notes=f"Tabletop. Finish: {spec.get('top_finish', 'satin lacquer')}. "
            "Round / ease all edges 3mm.",
        )
    )

    # ── Legs ──────────────────────────────────────────────────────────────
    leg_h = top_h - top_thk
    leg_x = top_w / 2 - leg_thk / 2 - 20  # 20mm inset from edge
    leg_y = top_d / 2 - leg_thk / 2 - 20

    if leg_count == 4 or leg_style != "pedestal":
        leg = Box(leg_thk, leg_thk, leg_h)
        for i, (sx, sy, name) in enumerate(
            [(-1, -1, "fl"), (1, -1, "fr"), (-1, 1, "bl"), (1, 1, "br")]
        ):
            parts[f"leg_{name}"] = leg.moved(Location((sx * leg_x, sy * leg_y, leg_h / 2)))
        cutlist.append(
            CutlistItem(
                name="leg",
                qty=4,
                width_mm=leg_thk,
                depth_mm=leg_thk,
                thickness_mm=leg_h,
                material=leg_material,
                notes=f"{leg_style.title()} legs. Mortise top for apron tenons.",
            )
        )
    else:  # pedestal
        ped_d = min(top_w, top_d) * 0.35
        parts["pedestal"] = Box(ped_d, ped_d, leg_h).moved(Location((0, 0, leg_h / 2)))
        parts["pedestal_base"] = Box(ped_d * 1.6, ped_d * 1.6, 30).moved(
            Location((0, 0, 15))
        )
        cutlist.append(
            CutlistItem(
                name="pedestal_column",
                qty=1,
                width_mm=ped_d,
                depth_mm=ped_d,
                thickness_mm=leg_h,
                material=leg_material,
                notes="Pedestal column. Can be turned on lathe or built up from staves.",
            )
        )
        cutlist.append(
            CutlistItem(
                name="pedestal_base",
                qty=1,
                width_mm=ped_d * 1.6,
                depth_mm=ped_d * 1.6,
                thickness_mm=30,
                material=leg_material,
                notes="Base plate for pedestal. Heavy stock or laminate to weight.",
            )
        )

    # ── Aprons ────────────────────────────────────────────────────────────
    if has_apron and leg_style != "pedestal":
        apron_xlen = top_w - 2 * (leg_thk + 20) - 2 * apron_inset + 2 * leg_thk
        apron_ylen = top_d - 2 * (leg_thk + 20) - 2 * apron_inset + 2 * leg_thk
        apron_z = top_h - top_thk - apron_h / 2 - 5
        apron_fb = Box(apron_xlen, apron_thk, apron_h)
        apron_lr = Box(apron_thk, apron_ylen, apron_h)
        parts["apron_front"] = apron_fb.moved(
            Location((0, -leg_y + leg_thk / 2 + apron_thk / 2, apron_z))
        )
        parts["apron_back"] = apron_fb.moved(
            Location((0, leg_y - leg_thk / 2 - apron_thk / 2, apron_z))
        )
        parts["apron_left"] = apron_lr.moved(
            Location((-leg_x + leg_thk / 2 + apron_thk / 2, 0, apron_z))
        )
        parts["apron_right"] = apron_lr.moved(
            Location((leg_x - leg_thk / 2 - apron_thk / 2, 0, apron_z))
        )
        cutlist.append(
            CutlistItem(
                name="apron_long",
                qty=2,
                width_mm=apron_xlen,
                depth_mm=apron_thk,
                thickness_mm=apron_h,
                material=leg_material,
                notes="Front + back aprons. Tenons on each end.",
            )
        )
        cutlist.append(
            CutlistItem(
                name="apron_short",
                qty=2,
                width_mm=apron_ylen,
                depth_mm=apron_thk,
                thickness_mm=apron_h,
                material=leg_material,
                notes="Side aprons. Tenons on each end.",
            )
        )

    bom.extend(
        [
            BomItem(
                name="Beech dowel 10mm × 50mm" if not has_apron else "Apron screws / brackets",
                qty=16 if has_apron else 8,
                unit="ea",
                spec="For attaching top to apron / direct to legs. Use figure-8 "
                "table connectors if wood movement matters.",
                category="hardware",
            ),
            BomItem(
                name="Wood glue (PVA)",
                qty=1,
                unit="bottle",
                spec="Titebond II",
                category="adhesive",
            ),
            BomItem(
                name="Finish",
                qty=1,
                unit="batch",
                spec=spec.get("top_finish", "Satin lacquer"),
                category="finish",
            ),
        ]
    )

    assembly = Compound(children=list(parts.values()), label=f"table_{spec.get('table_type', 'dining')}")
    return BuildResult(
        category="table",
        parts=parts,
        assembly=assembly,
        cutlist=cutlist,
        bom=bom,
        panel_parts=["top"],
        notes=(
            f"Parametric {spec.get('table_type', 'dining')} table. "
            f"Top + {leg_count} legs ({leg_style})"
            + (" + 4 aprons" if has_apron else " (no apron — direct attachment)")
            + ". Use figure-8 desktop fasteners between top and apron to allow "
            "for seasonal wood movement."
        ),
    )
