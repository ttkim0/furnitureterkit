"""Storage (shelf, cabinet, dresser, bookcase, sideboard) CAD builder.

Generates a 32mm-system-style case from StorageSpec — the standard for
flat-pack and CNC-routed casework. Side panels, top, bottom, back,
shelves, optional drawers and doors.
"""
from __future__ import annotations

from build123d import Box, Compound, Location, Part
from ..common import BomItem, BuildResult, CutlistItem, make_panel


def build_storage(spec: dict) -> BuildResult:
    overall = spec.get("overall", {})
    w = float(overall.get("width_mm", 800))
    h = float(overall.get("height_mm", 1800))
    d = float(overall.get("depth_mm", 400))
    storage_type = spec.get("storage_type", "shelf")
    shelf_count = int(spec.get("shelf_count", 0) or 0)
    drawer_count = int(spec.get("drawer_count", 0) or 0)
    door_count = int(spec.get("door_count", 0) or 0)
    material = spec.get("frame_material", "Plywood")
    back_material = spec.get("back_panel_material", "Hardboard")
    finish = spec.get("finish", "Satin lacquer")
    hardware = spec.get("hardware_material", "Brushed nickel")

    panel_thk = 18.0
    back_thk = 6.0

    parts: dict[str, Part] = {}
    cutlist: list[CutlistItem] = []
    bom: list[BomItem] = []

    # Sides
    side = make_panel(panel_thk, d, h, "side")
    parts["side_left"] = side.moved(Location((-w / 2 + panel_thk / 2, 0, h / 2)))
    parts["side_right"] = side.moved(Location((w / 2 - panel_thk / 2, 0, h / 2)))
    cutlist.append(
        CutlistItem(
            "side",
            2,
            panel_thk,
            d,
            h,
            material,
            "Side panels. Drill shelf-pin holes at 32mm spacing on inside face.",
        )
    )

    # Top + bottom (between sides)
    horiz_w = w - 2 * panel_thk
    top = make_panel(horiz_w, d, panel_thk, "top")
    bottom = make_panel(horiz_w, d, panel_thk, "bottom")
    parts["top"] = top.moved(Location((0, 0, h - panel_thk / 2)))
    parts["bottom"] = bottom.moved(Location((0, 0, panel_thk / 2)))
    cutlist.append(
        CutlistItem(
            "top",
            1,
            horiz_w,
            d,
            panel_thk,
            material,
            "Top panel. Dado into sides or pocket-screw from inside.",
        )
    )
    cutlist.append(
        CutlistItem(
            "bottom",
            1,
            horiz_w,
            d,
            panel_thk,
            material,
            "Bottom panel.",
        )
    )

    # Back panel
    back = make_panel(w - 4, h - 4, back_thk, "back")
    parts["back"] = back.moved(Location((0, d / 2 - back_thk / 2, h / 2)))
    cutlist.append(
        CutlistItem(
            "back",
            1,
            w - 4,
            h - 4,
            back_thk,
            back_material,
            "Back panel. Set into rabbets cut in sides/top/bottom.",
        )
    )

    # Shelves
    if shelf_count > 0:
        shelf_spacing = (h - 2 * panel_thk) / (shelf_count + 1)
        shelf = make_panel(horiz_w - 2, d - back_thk - 5, panel_thk, "shelf")
        for i in range(shelf_count):
            z = panel_thk + (i + 1) * shelf_spacing - panel_thk / 2
            parts[f"shelf_{i + 1}"] = shelf.moved(
                Location((0, -back_thk / 2 - 2.5, z))
            )
        cutlist.append(
            CutlistItem(
                "shelf",
                shelf_count,
                horiz_w - 2,
                d - back_thk - 5,
                panel_thk,
                material,
                "Adjustable shelves. Rest on 5mm shelf pins.",
            )
        )
        bom.append(
            BomItem(
                "Shelf pins 5mm",
                shelf_count * 4,
                "ea",
                "Standard brass or nickel-plated.",
                "hardware",
            )
        )

    # Drawers
    if drawer_count > 0:
        drawer_dims = spec.get("drawer_dimensions_mm") or {}
        drawer_h = float(drawer_dims.get("height", (h - 2 * panel_thk) / max(1, drawer_count + 1)))
        drawer_w = float(drawer_dims.get("width", horiz_w - 30))
        drawer_d = float(drawer_dims.get("depth", d - back_thk - 30))
        drawer_box_thk = 12.0
        for i in range(drawer_count):
            z = panel_thk + drawer_h / 2 + i * (drawer_h + 5)
            front = make_panel(drawer_w + 20, panel_thk, drawer_h + 5, f"drawer_front_{i+1}")
            parts[f"drawer_front_{i+1}"] = front.moved(Location((0, -d / 2 + panel_thk / 2, z)))
            box = Box(drawer_w, drawer_d, drawer_h).moved(Location((0, -back_thk - drawer_d / 2 - 10, z)))
            parts[f"drawer_box_{i+1}"] = box
        cutlist.append(
            CutlistItem(
                "drawer_front",
                drawer_count,
                drawer_w + 20,
                panel_thk,
                drawer_h + 5,
                material,
                "Drawer fronts. Inset or overlay depending on style.",
            )
        )
        cutlist.append(
            CutlistItem(
                "drawer_box_side",
                drawer_count * 2,
                drawer_box_thk,
                drawer_d,
                drawer_h,
                "Maple or Birch ply",
                "Drawer box sides. Dovetail or rabbet-and-dado joints.",
            )
        )
        cutlist.append(
            CutlistItem(
                "drawer_box_fb",
                drawer_count * 2,
                drawer_w - 2 * drawer_box_thk,
                drawer_box_thk,
                drawer_h,
                "Maple or Birch ply",
                "Drawer box front and back.",
            )
        )
        cutlist.append(
            CutlistItem(
                "drawer_bottom",
                drawer_count,
                drawer_w - 10,
                drawer_d - 10,
                6,
                "Hardboard or 6mm ply",
                "Drawer bottom. Set into dado in sides/front.",
            )
        )
        bom.append(
            BomItem(
                "Full-extension drawer slide 350mm",
                drawer_count,
                "pair",
                f"{hardware} finish. Soft-close preferred.",
                "hardware",
            )
        )
        bom.append(
            BomItem(
                "Drawer pull",
                drawer_count,
                "ea",
                f"{hardware} finish. 96mm or 128mm center-to-center.",
                "hardware",
            )
        )

    # Doors
    if door_count > 0:
        door_w = (horiz_w - 4 - (door_count - 1) * 3) / door_count  # 3mm gap between
        door_h = h - 2 * panel_thk - 60  # leave 30mm top + bottom
        door = make_panel(door_w, panel_thk, door_h, "door")
        for i in range(door_count):
            x = -horiz_w / 2 + door_w / 2 + i * (door_w + 3) + 2
            parts[f"door_{i + 1}"] = door.moved(
                Location((x, -d / 2 + panel_thk / 2, h / 2))
            )
        cutlist.append(
            CutlistItem(
                "door",
                door_count,
                door_w,
                panel_thk,
                door_h,
                material,
                "Cabinet doors. Mount on concealed (Euro) hinges.",
            )
        )
        bom.append(
            BomItem(
                "Concealed hinge (35mm cup)",
                door_count * 2,
                "ea",
                "Soft-close, 110° opening.",
                "hardware",
            )
        )
        bom.append(
            BomItem(
                "Door pull / knob",
                door_count,
                "ea",
                f"{hardware} finish.",
                "hardware",
            )
        )

    # Universal hardware
    bom.extend(
        [
            BomItem(
                "Pocket screws 32mm",
                40,
                "ea",
                "For case assembly. Use Kreg or equivalent jig.",
                "hardware",
            ),
            BomItem("Wood glue (PVA)", 1, "bottle", "Titebond II.", "adhesive"),
            BomItem("Finish", 1, "batch", finish, "finish"),
        ]
    )

    assembly = Compound(children=list(parts.values()), label=f"storage_{storage_type}")
    return BuildResult(
        category="storage",
        parts=parts,
        assembly=assembly,
        cutlist=cutlist,
        bom=bom,
        panel_parts=[
            "side_left",
            "side_right",
            "top",
            "bottom",
            "back",
        ]
        + [f"shelf_{i + 1}" for i in range(shelf_count)]
        + [f"door_{i + 1}" for i in range(door_count)]
        + [f"drawer_front_{i + 1}" for i in range(drawer_count)],
        notes=(
            f"Parametric {storage_type} in 32mm system construction. "
            f"All case panels are {panel_thk}mm; back is {back_thk}mm. "
            f"Build with pocket screws + glue for shop builds, or full "
            f"dado-and-rabbet for higher quality. DXF files for each panel "
            f"are ready for CNC routing on a 4×8 sheet."
        ),
    )
