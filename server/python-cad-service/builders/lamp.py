"""Lamp CAD builder. Base + pole + shade, parametric from LampSpec.

For table/floor/desk lamps. Pendant/wall types differ structurally and
get a separate code path (TODO).
"""
from __future__ import annotations

from build123d import Box, Cylinder, Compound, Location, Part
from ..common import BomItem, BuildResult, CutlistItem


def build_lamp(spec: dict) -> BuildResult:
    lamp_type = spec.get("lamp_type", "table")
    base_d = float(spec.get("base_diameter_mm", 200))
    shade_d = float(spec["shade_diameter_mm"])
    shade_h = float(spec["shade_height_mm"])
    pole_h = float(spec.get("pole_height_mm", 400))
    bulb_count = int(spec.get("bulb_count", 1))
    bulb_socket = spec.get("bulb_socket", "E26")
    max_wattage = int(spec.get("max_wattage", 60))
    base_material = spec.get("base_material", "Brass")
    shade_material = spec.get("shade_material", "Linen")
    cord_l = float(spec.get("cord_length_mm", 1800))

    parts: dict[str, Part] = {}
    cutlist: list[CutlistItem] = []
    bom: list[BomItem] = []

    base_h = 20.0
    pole_d = 18.0

    # Base disc (turned on lathe or cut from sheet)
    base = Cylinder(radius=base_d / 2, height=base_h).moved(Location((0, 0, base_h / 2)))
    parts["base"] = base
    cutlist.append(
        CutlistItem(
            "base",
            1,
            base_d,
            base_d,
            base_h,
            base_material,
            f"Base. Drill center 8mm for pole, 12mm for cord channel.",
        )
    )

    # Pole
    pole_z = base_h + pole_h / 2
    pole = Cylinder(radius=pole_d / 2, height=pole_h).moved(Location((0, 0, pole_z)))
    parts["pole"] = pole
    cutlist.append(
        CutlistItem(
            "pole",
            1,
            pole_d,
            pole_d,
            pole_h,
            base_material,
            "Threaded rod or hollow tube. Hollow allows cord to run through.",
        )
    )

    # Shade (truncated cone — modeled here as a thin cylinder for simplicity)
    shade_z = base_h + pole_h + shade_h / 2
    shade_outer = Cylinder(radius=shade_d / 2, height=shade_h).moved(
        Location((0, 0, shade_z))
    )
    # Hollow it out
    shade_inner = Cylinder(radius=shade_d / 2 - 8, height=shade_h - 4).moved(
        Location((0, 0, shade_z))
    )
    parts["shade"] = shade_outer - shade_inner
    cutlist.append(
        CutlistItem(
            "shade",
            1,
            shade_d,
            shade_d,
            shade_h,
            shade_material,
            f"Lampshade. {shade_material} stretched over wire frame.",
        )
    )

    bom.extend(
        [
            BomItem(
                f"{bulb_socket} lamp socket",
                bulb_count,
                "ea",
                f"Rated {max_wattage}W max. UL-listed.",
                "hardware",
            ),
            BomItem(
                "Lamp cord (SPT-2)",
                1,
                "ea",
                f"{cord_l / 1000:.1f}m. With molded plug.",
                "hardware",
            ),
            BomItem("In-line switch", 1, "ea", "Or rotary base switch.", "hardware"),
            BomItem(
                "Harp + finial",
                1,
                "set",
                "Standard lamp harp (height to match shade)",
                "hardware",
            ),
            BomItem(
                "Threaded lamp pipe + nuts",
                1,
                "set",
                "1/8 IPS standard. Length matches pole.",
                "hardware",
            ),
            BomItem("Wire connectors (UL)", 4, "ea", "Crimp or screw type.", "hardware"),
        ]
    )

    assembly = Compound(children=list(parts.values()), label=f"lamp_{lamp_type}")
    return BuildResult(
        category="lamp",
        parts=parts,
        assembly=assembly,
        cutlist=cutlist,
        bom=bom,
        panel_parts=[],
        notes=(
            f"Parametric {lamp_type} lamp. Pole is hollow to run cord through "
            f"to socket. SAFETY: must be wired by certified electrician for "
            f"commercial sale. UL listing required for retail in US."
        ),
    )
