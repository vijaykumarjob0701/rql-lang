"""RQL — Retrieval Query Language library (Python).

Public API
----------
- ``parse(rql_text) -> LogicalPlan``
- ``compile(logical, *, profile) -> PhysicalPlan``
- ``explain(physical) -> str | dict``
- ``emit(physical, *, backend) -> EmitResult`` (sketches; default, no I/O)
- ``execute(plan_or_emit, *, backend="qdrant") -> ExecuteResult`` (opt-in live)

``emit`` does **not** execute against live databases. ``execute`` is opt-in
and currently implements Qdrant only.
"""
from __future__ import annotations

from .emit import (
    Adapter,
    AdapterError,
    SketchAdapter,
    emit,
    emit_plan,
    list_vendors,
    register_adapter,
    resolve_vendor,
)
from .execute import execute
from .explain import explain
from .parser import ParseError, parse, parse_file
from .planner import PlanError, compile, list_profiles, load_profile, plan_logical
from .qdrant import ExecutionError, QdrantAdapter
from .schemas import logical_plan_schema, physical_plan_schema, schemas_dir
from .types import EmitResult, ExecuteHit, ExecuteResult, LogicalPlan, PhysicalPlan

__version__ = "0.1.0"
__all__ = [
    "ParseError",
    "PlanError",
    "AdapterError",
    "ExecutionError",
    "Adapter",
    "SketchAdapter",
    "QdrantAdapter",
    "parse",
    "parse_file",
    "compile",
    "plan_logical",
    "load_profile",
    "list_profiles",
    "explain",
    "emit",
    "emit_plan",
    "execute",
    "list_vendors",
    "register_adapter",
    "resolve_vendor",
    "logical_plan_schema",
    "physical_plan_schema",
    "schemas_dir",
    "__version__",
    "LogicalPlan",
    "PhysicalPlan",
    "EmitResult",
    "ExecuteHit",
    "ExecuteResult",
]
