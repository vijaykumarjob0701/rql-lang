"""TypedDict shapes for plan / emit artifacts (structural; JSON-compatible)."""
from __future__ import annotations

from typing import Any, NotRequired, TypedDict


class LogicalPlan(TypedDict):
    schemaVersion: str
    kind: str
    root: dict[str, Any]
    meta: NotRequired[dict[str, Any]]


class PhysicalPlan(TypedDict):
    schemaVersion: str
    kind: str
    meta: dict[str, Any]
    capabilitiesUsed: dict[str, Any]
    root: dict[str, Any]
    budgets: NotRequired[dict[str, Any]]


class EmitResult(TypedDict):
    schemaVersion: str
    kind: str
    label: str
    approximate: bool
    notExecuted: bool
    vendor: str
    format: str
    body: Any
    notes: list[str]
    banner: str
    meta: dict[str, Any]
    filesuggested_ext: NotRequired[str]
