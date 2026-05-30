"""Category builder registry.

Each builder takes a parsed FurnitureSpec dict and returns a BuildResult.
"""
from __future__ import annotations

from typing import Callable

from .chair import build_chair
from .table import build_table
from .sofa import build_sofa
from .bed import build_bed
from .lamp import build_lamp
from .storage import build_storage
from ..common import BuildResult


BUILDERS: dict[str, Callable[[dict], BuildResult]] = {
    "chair": build_chair,
    "table": build_table,
    "sofa": build_sofa,
    "bed": build_bed,
    "lamp": build_lamp,
    "storage": build_storage,
}


def build(spec: dict) -> BuildResult:
    """Dispatch a spec to its category builder."""
    cat = spec.get("category")
    if cat not in BUILDERS:
        raise ValueError(f"unknown category: {cat!r}. supported: {list(BUILDERS)}")
    return BUILDERS[cat](spec)
