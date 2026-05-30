"""Shared helpers for furniture CAD generation.

The pattern: each category builder constructs a `Build` object containing
a `parts` list (named) and an `assembly` (build123d Compound). This module
turns that into the standard output bundle:

  out_dir/
    assembled.step          ← full assembly as one STEP
    parts/<name>.step       ← per-part STEP files (manufacturer can isolate)
    parts/<name>.dxf        ← flat panel projection where the part is panel-like
    cutlist.csv             ← width × depth × thickness × qty × material
    bom.json                ← bill of materials (hardware + finish + glue)
    summary.json            ← machine-readable index of what's in the bundle

Build123d builds in millimeters by default; we preserve that everywhere.
"""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from build123d import (
    Box,
    BuildPart,
    Compound,
    Location,
    Part,
    Plane,
    Pos,
    Rectangle,
    Rot,
    Solid,
    export_step,
    export_stl,
)
import ezdxf


@dataclass
class CutlistItem:
    name: str
    qty: int
    width_mm: float
    depth_mm: float
    thickness_mm: float
    material: str
    notes: str = ""


@dataclass
class BomItem:
    name: str
    qty: int
    unit: str = "ea"
    spec: str = ""
    category: str = "hardware"  # hardware | finish | adhesive | other


@dataclass
class BuildResult:
    """What every category builder returns."""

    category: str
    parts: dict[str, Part]  # name -> Part. used for per-part STEP + DXF
    assembly: Compound
    cutlist: list[CutlistItem] = field(default_factory=list)
    bom: list[BomItem] = field(default_factory=list)
    panel_parts: list[str] = field(default_factory=list)  # names whose parts get DXF'd
    notes: str = ""


def make_panel(
    width_mm: float,
    depth_mm: float,
    thickness_mm: float,
    name: str = "panel",
) -> Part:
    """Standard rectangular panel (e.g. seat, top, back, shelf)."""
    p = Box(width_mm, depth_mm, thickness_mm)
    p.label = name
    return p


def make_leg(
    width_mm: float,
    depth_mm: float,
    height_mm: float,
    name: str = "leg",
) -> Part:
    """Simple square / rectangular leg. Taper / shape variants added later."""
    p = Box(width_mm, depth_mm, height_mm)
    p.label = name
    return p


def make_rail(
    length_mm: float,
    height_mm: float,
    thickness_mm: float,
    name: str = "rail",
) -> Part:
    """Horizontal rail / apron / stretcher. Length is along X by default."""
    p = Box(length_mm, thickness_mm, height_mm)
    p.label = name
    return p


def write_outputs(result: BuildResult, out_dir: Path) -> dict[str, Any]:
    """Materialize a BuildResult into the standard manufacturer bundle.

    Returns a summary dict of what was written.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    parts_dir = out_dir / "parts"
    parts_dir.mkdir(exist_ok=True)

    # 1. Assembled STEP
    assembled_path = out_dir / "assembled.step"
    export_step(result.assembly, str(assembled_path))

    # 2. Per-part STEP
    part_files: dict[str, str] = {}
    for name, part in result.parts.items():
        safe = _safe_name(name)
        p = parts_dir / f"{safe}.step"
        export_step(part, str(p))
        part_files[name] = str(p.relative_to(out_dir))

    # 3. Per-panel DXF (top-down projection)
    dxf_files: dict[str, str] = {}
    for name in result.panel_parts:
        part = result.parts.get(name)
        if part is None:
            continue
        safe = _safe_name(name)
        dxf_path = parts_dir / f"{safe}.dxf"
        if _export_panel_dxf(part, dxf_path):
            dxf_files[name] = str(dxf_path.relative_to(out_dir))

    # 4. Cutlist CSV
    cutlist_path = out_dir / "cutlist.csv"
    with cutlist_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            ["name", "qty", "width_mm", "depth_mm", "thickness_mm", "material", "notes"]
        )
        for item in result.cutlist:
            w.writerow(
                [
                    item.name,
                    item.qty,
                    f"{item.width_mm:.1f}",
                    f"{item.depth_mm:.1f}",
                    f"{item.thickness_mm:.1f}",
                    item.material,
                    item.notes,
                ]
            )

    # 5. BOM JSON
    bom_path = out_dir / "bom.json"
    bom_path.write_text(json.dumps([asdict(b) for b in result.bom], indent=2))

    # 6. Summary
    summary = {
        "category": result.category,
        "files": {
            "assembled_step": "assembled.step",
            "parts_step": part_files,
            "parts_dxf": dxf_files,
            "cutlist_csv": "cutlist.csv",
            "bom_json": "bom.json",
        },
        "part_count": len(result.parts),
        "cutlist_rows": len(result.cutlist),
        "bom_rows": len(result.bom),
        "notes": result.notes,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary


def _safe_name(s: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in s).strip("_")


def _export_panel_dxf(part: Part, dxf_path: Path) -> bool:
    """Project the part's largest face down to XY and export as DXF.

    For panel-like parts (boards, shelves, tops) this gives the manufacturer
    the 2D cut profile for a CNC router / laser. For non-panel parts we
    return False; manufacturer uses the STEP instead.
    """
    try:
        # Find the largest face — that's the panel's primary surface.
        faces = part.faces()
        if not faces:
            return False
        largest = max(faces, key=lambda f: f.area)
        # Bounding box of the largest face gives us the panel rect.
        # For complex panels (with cutouts) we'd project the actual edges;
        # rect is fine for v1 since our panels are all rectangles.
        bbox = largest.bounding_box()
        w = bbox.size.X
        h = bbox.size.Y if bbox.size.Y > bbox.size.Z else bbox.size.Z
        if w < 1 or h < 1:
            return False
        doc = ezdxf.new(dxfversion="R2018", setup=True)
        msp = doc.modelspace()
        # Centered rectangle
        msp.add_lwpolyline(
            [
                (-w / 2, -h / 2),
                (w / 2, -h / 2),
                (w / 2, h / 2),
                (-w / 2, h / 2),
                (-w / 2, -h / 2),
            ]
        )
        # Dimension labels
        msp.add_text(
            f"{w:.0f} x {h:.0f} mm",
            dxfattribs={"height": max(5, min(w, h) * 0.05)},
        ).set_placement((0, h / 2 + 15))
        doc.saveas(str(dxf_path))
        return True
    except Exception as e:
        print(f"[cad-gen] dxf export failed for {dxf_path.name}: {e}", flush=True)
        return False
