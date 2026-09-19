"""Load shared JSON Schema copies (logical + physical 0.1.0-draft)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_PKG = Path(__file__).resolve().parent
_BUNDLED = _PKG / "schema_data"
_MONOREPO = _PKG.parents[3] / "schemas"  # rql-lang/schemas when editable


def schemas_dir() -> Path:
    """Prefer monorepo schemas/ when present; else bundled package copies."""
    if _MONOREPO.is_dir() and (_MONOREPO / "logical-plan.schema.json").is_file():
        return _MONOREPO
    return _BUNDLED


@lru_cache(maxsize=4)
def load_schema(name: str) -> dict[str, Any]:
    """Load a schema by short name: ``logical-plan`` or ``physical-plan``."""
    stem = name.replace(".schema.json", "").replace(".json", "")
    path = schemas_dir() / f"{stem}.schema.json"
    if not path.is_file():
        path = _BUNDLED / f"{stem}.schema.json"
    if not path.is_file():
        raise FileNotFoundError(f"schema not found: {name} (looked in {schemas_dir()})")
    return json.loads(path.read_text(encoding="utf-8"))


def logical_plan_schema() -> dict[str, Any]:
    return load_schema("logical-plan")


def physical_plan_schema() -> dict[str, Any]:
    return load_schema("physical-plan")
