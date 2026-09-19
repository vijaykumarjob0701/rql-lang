"""Filter → FilterExec mode heuristics (Hypothesis).

Aligned with experiments/harness/test_filter_strategy_chooser.py toy thresholds
and FANNS-style packaging (thesis §06). Deterministic decision rules only —
not an ANN benchmark and not learned costing.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


Mode = str  # PRE | POST | ITERATIVE | SUBGRAPH | SPECIALIZED | PARTITION | ROUTER


@dataclass(frozen=True)
class Capabilities:
    subgraph: bool = False
    specialized_labels: bool = False
    ann_iterator: bool = False


@dataclass(frozen=True)
class Stats:
    selectivity: float  # fraction surviving predicate, in (0, 1]
    specificity: float  # label match fraction; 1.0 if N/A
    correlation: str  # "pos" | "neg" | "none" | "unknown"
    predicate_kind: str  # "acl" | "label_eq" | "range" | "complex"
    acl_hard: bool = False


def choose(stats: Stats, caps: Capabilities) -> Mode:
    """Pure function: fixed thresholds for unit-test determinism only."""
    if stats.acl_hard and stats.predicate_kind == "acl":
        if caps.ann_iterator:
            return "ITERATIVE"
        if caps.subgraph:
            return "SUBGRAPH"
        return "PRE"

    if (
        stats.predicate_kind == "label_eq"
        and caps.specialized_labels
        and stats.specificity <= 0.25
    ):
        return "SPECIALIZED"

    if stats.selectivity <= 0.05 and caps.subgraph:
        return "SUBGRAPH"

    if stats.selectivity <= 0.15 and caps.ann_iterator:
        return "ITERATIVE"

    if stats.selectivity >= 0.5 and stats.correlation in ("pos", "none", "unknown"):
        return "POST"

    if stats.selectivity >= 0.3:
        return "PRE"

    if caps.ann_iterator:
        return "ITERATIVE"
    if caps.subgraph:
        return "SUBGRAPH"
    if caps.specialized_labels and stats.predicate_kind == "label_eq":
        return "SPECIALIZED"
    return "POST"


def caps_from_profile(profile: dict[str, Any]) -> Capabilities:
    fc = profile.get("filterCaps") or {}
    # Also honour top-level capabilities.annIterator when filterCaps omitted.
    caps_top = profile.get("capabilities") or {}
    return Capabilities(
        subgraph=bool(fc.get("subgraph", False)),
        specialized_labels=bool(fc.get("specialized_labels", False)),
        ann_iterator=bool(
            fc.get("ann_iterator", caps_top.get("annIterator", False))
        ),
    )


def infer_stats(predicate: dict[str, Any] | None) -> Stats:
    """Toy heuristic Stats from opaque predicate JSON (Hypothesis packaging).

    Does **not** claim real selectivity estimation — fixed rules for determinism.
    """
    pred = predicate or {}
    expr = str(pred.get("expr") or "")
    acl_hard = bool(pred.get("aclHard", False))
    low = expr.lower()

    if acl_hard or "tenant" in low or "clearance" in low or "acl" in low:
        kind = "acl"
        # Conservative: treat ACL as mid-low selectivity for mode preference.
        return Stats(0.2, 1.0, "unknown", kind, acl_hard=True)

    # label_eq-ish: single equality, no range ops
    if (
        "=" in expr
        and "<" not in expr
        and ">" not in expr
        and " and " not in low
        and " or " not in low
    ):
        return Stats(0.4, 0.2, "none", "label_eq", acl_hard=False)

    if any(op in expr for op in ("<", ">", "<=", ">=", "BETWEEN", "between")):
        # Range predicates: mid selectivity default
        return Stats(0.35, 1.0, "none", "range", acl_hard=False)

    # Complex / multi-clause
    if " and " in low or " or " in low:
        return Stats(0.25, 1.0, "unknown", "complex", acl_hard=False)

    return Stats(0.5, 1.0, "unknown", "complex", acl_hard=False)


def choose_filter_mode(predicate: dict[str, Any] | None, profile: dict[str, Any]) -> Mode:
    return choose(infer_stats(predicate), caps_from_profile(profile))
