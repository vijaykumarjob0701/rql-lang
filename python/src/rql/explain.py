"""Human-readable / structured explanation of a PhysicalPlan."""
from __future__ import annotations

from typing import Any, Literal, Union


def explain(
    physical: dict[str, Any],
    *,
    format: Literal["text", "object"] = "text",
) -> Union[str, dict[str, Any]]:
    """Explain a PhysicalPlan as text or a structured object.

    Does not execute against any database.
    """
    if physical.get("kind") != "PhysicalPlan":
        raise ValueError(f"expected kind=PhysicalPlan, got {physical.get('kind')!r}")

    meta = physical.get("meta") or {}
    caps = physical.get("capabilitiesUsed") or {}
    budgets = physical.get("budgets") or {}
    root = physical.get("root") or {}

    lines: list[str] = []
    ops: list[dict[str, Any]] = []

    def walk(node: dict[str, Any], depth: int = 0) -> None:
        op = node.get("op", "?")
        nid = node.get("id", "")
        detail_parts: list[str] = []
        if op == "AnnExec":
            detail_parts.append(f"k={node.get('k')} index={node.get('index')} metric={node.get('metric')}")
        elif op == "Bm25Exec":
            detail_parts.append(f"k={node.get('k')}")
        elif op == "LateInteractExec":
            detail_parts.append(f"variant={node.get('variant')} k={node.get('k')}")
        elif op == "FilterExec":
            detail_parts.append(f"mode={node.get('mode')} pruning={node.get('pruningStrategy')}")
            pred = node.get("predicate") or {}
            if pred.get("aclHard"):
                detail_parts.append("aclHard")
        elif op == "FusionExec":
            detail_parts.append(f"family={node.get('family')} native={node.get('native')}")
        elif op == "ShimCast":
            detail_parts.append(f"shim={node.get('shim')} expensive={node.get('expensive')}")
        detail = " ".join(detail_parts)
        indent = "  " * depth
        lines.append(f"{indent}{op}({nid}){' ' + detail if detail else ''}")
        ops.append({"id": nid, "op": op, "depth": depth, "detail": detail})
        if isinstance(node.get("input"), dict):
            walk(node["input"], depth + 1)
        for child in node.get("inputs") or []:
            if isinstance(child, dict):
                walk(child, depth + 1)

    walk(root)

    obj: dict[str, Any] = {
        "kind": "PhysicalPlanExplain",
        "schemaVersion": physical.get("schemaVersion"),
        "profileId": meta.get("profileId"),
        "label": meta.get("label"),
        "notes": meta.get("notes"),
        "capabilitiesUsed": caps,
        "budgets": budgets,
        "ops": ops,
        "tree": "\n".join(lines),
        "notExecuted": True,
    }

    if format == "object":
        return obj

    out = [
        f"PhysicalPlan explain (profile={meta.get('profileId') or '?'})",
        f"schemaVersion={physical.get('schemaVersion')} label={meta.get('label')}",
    ]
    if meta.get("notes"):
        out.append(f"notes: {meta['notes']}")
    if budgets:
        out.append(f"budgets: {budgets}")
    out.append("tree:")
    out.extend(lines)
    out.append("(sketch / notExecuted — emit is docs-shaped until live adapters)")
    return "\n".join(out) + "\n"
