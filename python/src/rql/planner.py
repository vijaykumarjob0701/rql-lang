"""Deterministic LogicalPlan → PhysicalPlan planner stub (Hypothesis).

Rules only — no latency/recall numbers invented. Capability profiles are
docs-derived flags from the Sep 2026 vendor matrix (journal 0020), not live probes.
"""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from .filter_mode import choose_filter_mode

PROFILES_DIR = Path(__file__).resolve().parent / "profiles"

SCHEMA_VERSION = "0.1.0-draft"


class PlanError(ValueError):
    """Raised when LogicalPlan cannot be planned under the given profile."""


def list_profiles(profiles_dir: Path | None = None) -> list[str]:
    d = profiles_dir or PROFILES_DIR
    return sorted(p.stem for p in d.glob("*.json"))


def load_profile(name_or_path: str | Path, profiles_dir: Path | None = None) -> dict[str, Any]:
    path = Path(name_or_path)
    if not path.suffix:
        path = (profiles_dir or PROFILES_DIR) / f"{name_or_path}.json"
    if not path.is_file():
        raise PlanError(f"profile not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if "id" not in data or "capabilities" not in data:
        raise PlanError(f"profile missing id/capabilities: {path}")
    return data


def plan_logical(
    logical: dict[str, Any],
    profile: dict[str, Any],
    *,
    logical_ref: str | None = None,
    late_rewrite: str | None = None,
) -> dict[str, Any]:
    """Map LogicalPlan JSON → PhysicalPlan JSON (schema 0.1.0-draft).

    Parameters
    ----------
    late_rewrite:
        Optional ``plaid`` / ``muvera`` preference when profile advertises the
        corresponding ladder flag; default ladder prefers native ColBERT when
        ``multiVectorLate``, else plaid/muvera if advertised, else colbert
        with an honesty note (fail-closed is adapter concern).
    """
    if logical.get("kind") != "LogicalPlan":
        raise PlanError(f"expected kind=LogicalPlan, got {logical.get('kind')!r}")
    if logical.get("schemaVersion") != SCHEMA_VERSION:
        raise PlanError(
            f"unsupported schemaVersion {logical.get('schemaVersion')!r}; "
            f"want {SCHEMA_VERSION}"
        )
    if "root" not in logical:
        raise PlanError("LogicalPlan missing root")

    caps = profile.get("capabilities") or {}
    notes: list[str] = [
        "RQL v0.1 planner: deterministic capability rules only; "
        "no fabricated latency/recall."
    ]
    if late_rewrite:
        notes.append(f"late_rewrite preference: {late_rewrite}")

    counter = {"n": 0}

    def nid(prefix: str, logical_id: str | None = None) -> str:
        if logical_id:
            return f"{prefix}_{logical_id}"
        counter["n"] += 1
        return f"{prefix}{counter['n']}"

    def plan_op(node: dict[str, Any]) -> dict[str, Any]:
        op = node.get("op")
        if op == "Search_dense":
            return _ann_exec(node, profile, nid)
        if op == "Search_bm25":
            return _bm25_exec(node, nid)
        if op == "Search_late":
            return _late_exec(node, profile, late_rewrite, notes, nid)
        if op == "Filter":
            return _filter_exec(node, profile, plan_op, nid)
        if op == "Fuse_rrf":
            return _fuse_rrf(node, profile, plan_op, notes, nid)
        if op == "Fuse_linear":
            return _fuse_linear(node, profile, plan_op, notes, nid)
        if op == "Fuse_ltr":
            return _fuse_generic(node, profile, "ltr", plan_op, notes, nid)
        if op == "Fuse_condorcet":
            return _fuse_generic(node, profile, "condorcet", plan_op, notes, nid)
        if op == "Rerank":
            return {
                "id": nid("rerank", node.get("id")),
                "op": "RerankExec",
                "model": node.get("model") or "unknown",
                "n": node.get("n") or node.get("k") or 10,
                "input": plan_op(node["input"]),
            }
        if op == "Union":
            # Physical schema has no UnionExec — PassThrough over first + note.
            # Honesty: multi-input Union needs adapter expand; stub keeps first child.
            notes.append(
                "Union: stub PassThrough of first input only "
                "(no UnionExec in physical schema 0.1.0-draft)."
            )
            inputs = node.get("inputs") or []
            if not inputs:
                raise PlanError("Union with empty inputs")
            return {
                "id": nid("pass", node.get("id")),
                "op": "PassThrough",
                "label": "union_stub_first_input",
                "input": plan_op(inputs[0]),
            }
        raise PlanError(f"unsupported logical op: {op!r}")

    root_phys = plan_op(logical["root"])

    # Surface ACL hard constraint when any Filter had aclHard
    acl_safe = _any_acl_hard(logical["root"])

    capabilities_used = {
        k: deepcopy(caps[k])
        for k in (
            "filterAnnComposition",
            "hybridBm25Dense",
            "rrfNative",
            "weightedFusionNative",
            "multiVectorLate",
            "latePlaid",
            "fdeMips",
            "explainNative",
            "annIterator",
        )
        if k in caps
    }
    hints = list(profile.get("vendorHints") or caps.get("vendorHints") or [])
    if hints:
        capabilities_used["vendorHints"] = hints

    budgets: dict[str, Any] = {}
    if acl_safe:
        budgets["aclSafe"] = True

    meta: dict[str, Any] = {
        "label": "Hypothesis",
        "notes": " ".join(notes),
    }
    if logical_ref:
        meta["logicalPlanRef"] = logical_ref
    meta["profileId"] = profile.get("id")

    out: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "PhysicalPlan",
        "meta": meta,
        "capabilitiesUsed": capabilities_used,
        "root": root_phys,
    }
    if budgets:
        out["budgets"] = budgets
    return out


def _any_acl_hard(node: dict[str, Any]) -> bool:
    if node.get("op") == "Filter":
        pred = node.get("predicate") or {}
        if pred.get("aclHard"):
            return True
    for key in ("input",):
        child = node.get(key)
        if isinstance(child, dict) and _any_acl_hard(child):
            return True
    for child in node.get("inputs") or []:
        if isinstance(child, dict) and _any_acl_hard(child):
            return True
    return False


def _ann_exec(node: dict[str, Any], profile: dict[str, Any], nid) -> dict[str, Any]:
    defaults = profile.get("defaults") or {}
    q = node.get("query") or {}
    out: dict[str, Any] = {
        "id": nid("ann", node.get("id")),
        "op": "AnnExec",
        "k": int(node["k"]),
        "index": defaults.get("annIndex", "hnsw"),
        "metric": node.get("metric") or "unknown",
    }
    ef = defaults.get("efSearch")
    if ef:
        out["efSearch"] = int(ef)
    if q.get("vectorRef"):
        out["queryRef"] = q["vectorRef"]
    if node.get("collection"):
        out["collection"] = node["collection"]
    return out


def _bm25_exec(node: dict[str, Any], nid) -> dict[str, Any]:
    q = node.get("query") or {}
    out: dict[str, Any] = {
        "id": nid("bm25", node.get("id")),
        "op": "Bm25Exec",
        "k": int(node["k"]),
    }
    if q.get("text") is not None:
        out["queryText"] = q["text"]
    if node.get("collection"):
        out["collection"] = node["collection"]
    return out


def _choose_late_variant(
    profile: dict[str, Any],
    late_rewrite: str | None,
    notes: list[str],
) -> str:
    caps = profile.get("capabilities") or {}
    pref = (late_rewrite or "").lower().strip() or None
    if pref and pref not in ("colbert", "plaid", "muvera"):
        raise PlanError(f"late_rewrite must be colbert|plaid|muvera, got {late_rewrite!r}")

    if pref == "plaid":
        if caps.get("latePlaid"):
            return "plaid"
        notes.append(
            "late_rewrite=plaid requested but latePlaid not advertised; "
            "falling through ladder."
        )
    if pref == "muvera":
        if caps.get("fdeMips"):
            return "muvera"
        notes.append(
            "late_rewrite=muvera requested but fdeMips not advertised; "
            "falling through ladder."
        )
    if pref == "colbert":
        return "colbert"

    # Default ladder (Hypothesis; thesis §06)
    if caps.get("multiVectorLate"):
        return "colbert"
    if caps.get("latePlaid"):
        notes.append("Search_late: no multiVectorLate → LateInteractExec variant=plaid.")
        return "plaid"
    if caps.get("fdeMips"):
        notes.append("Search_late: no multiVectorLate/latePlaid → variant=muvera.")
        return "muvera"
    notes.append(
        "Search_late: no multiVectorLate/latePlaid/fdeMips advertised; "
        "emit LateInteractExec variant=colbert (adapter must fail closed — "
        "do not silently substitute dense cosine)."
    )
    return "colbert"


def _late_exec(
    node: dict[str, Any],
    profile: dict[str, Any],
    late_rewrite: str | None,
    notes: list[str],
    nid,
) -> dict[str, Any]:
    q = node.get("query") or {}
    variant = _choose_late_variant(profile, late_rewrite, notes)
    out: dict[str, Any] = {
        "id": nid("late", node.get("id")),
        "op": "LateInteractExec",
        "variant": variant,
        "k": int(node["k"]),
    }
    # Toy candidate depth: 100×k for plaid/muvera-style over-fetch; else omit.
    if variant in ("plaid", "muvera"):
        out["candidateDepth"] = max(1000, int(node["k"]) * 100)
    if q.get("vectorRef"):
        out["queryRef"] = q["vectorRef"]
    if node.get("collection"):
        out["collection"] = node["collection"]
    return out


def _filter_exec(node: dict[str, Any], profile: dict[str, Any], plan_op, nid) -> dict[str, Any]:
    pred = node.get("predicate") or {}
    if "expr" not in pred:
        raise PlanError("Filter missing predicate.expr")
    mode = choose_filter_mode(pred, profile)
    # Map FANNS packaging label when known (Hypothesis)
    pruning = "unknown"
    if mode == "PRE":
        pruning = "SSP"
    elif mode == "POST":
        pruning = "VSP"
    elif mode in ("SUBGRAPH", "SPECIALIZED"):
        pruning = "VJP"
    elif mode == "ITERATIVE":
        pruning = "VSP"  # VBase as VSP refinement (survey packaging)
    pred_out: dict[str, Any] = {"expr": pred["expr"]}
    if "aclHard" in pred:
        pred_out["aclHard"] = bool(pred["aclHard"])
    return {
        "id": nid("fexec", node.get("id")),
        "op": "FilterExec",
        "mode": mode,
        "pruningStrategy": pruning,
        "predicate": pred_out,
        "input": plan_op(node["input"]),
    }


def _fuse_rrf(node, profile, plan_op, notes, nid) -> dict[str, Any]:
    caps = profile.get("capabilities") or {}
    native = bool(caps.get("rrfNative", False))
    inputs = [plan_op(c) for c in (node.get("inputs") or [])]
    if len(inputs) < 2:
        raise PlanError("Fuse_rrf requires ≥2 inputs")
    fuse: dict[str, Any] = {
        "id": nid("fuse", node.get("id")),
        "op": "FusionExec",
        "family": "rrf",
        "native": native,
        "inputs": inputs,
    }
    if "k_rrf" in node:
        fuse["k_rrf"] = int(node["k_rrf"])
    if native:
        notes.append("Fuse_rrf → FusionExec native (profile.rrfNative).")
        return fuse
    notes.append(
        "Fuse_rrf → ShimCast client_rrf (rrfNative=false); "
        "expensive; ACL-safe only if filters applied server-side."
    )
    return {
        "id": nid("shim_rrf", node.get("id")),
        "op": "ShimCast",
        "shim": "client_rrf",
        "expensive": True,
        "aclUnsafe": False,
        "input": fuse,
    }


def _fuse_linear(node, profile, plan_op, notes, nid) -> dict[str, Any]:
    caps = profile.get("capabilities") or {}
    native = bool(caps.get("weightedFusionNative", False))
    inputs = [plan_op(c) for c in (node.get("inputs") or [])]
    if len(inputs) < 2:
        raise PlanError("Fuse_linear requires ≥2 inputs")
    fuse: dict[str, Any] = {
        "id": nid("fuse", node.get("id")),
        "op": "FusionExec",
        "family": "linear",
        "native": native,
        "inputs": inputs,
    }
    if "alpha" in node:
        fuse["alpha"] = list(node["alpha"])
    if "phi" in node:
        fuse["phi"] = node["phi"]
    if native:
        notes.append(
            "Fuse_linear → FusionExec native (weightedFusionNative); "
            "semantics not interchangeable across vendors."
        )
        return fuse
    notes.append("Fuse_linear → ShimCast client_linear (weightedFusionNative=false).")
    return {
        "id": nid("shim_lin", node.get("id")),
        "op": "ShimCast",
        "shim": "client_linear",
        "expensive": True,
        "aclUnsafe": False,
        "input": fuse,
    }


def _fuse_generic(node, profile, family, plan_op, notes, nid) -> dict[str, Any]:
    # No native ads for ltr/condorcet in current profiles → always client-ish FusionExec.
    inputs = [plan_op(c) for c in (node.get("inputs") or [])]
    if len(inputs) < 2:
        raise PlanError(f"Fuse_{family} requires ≥2 inputs")
    notes.append(
        f"Fuse_{family} → FusionExec native=false "
        "(no profile native flag in stub profiles)."
    )
    fuse: dict[str, Any] = {
        "id": nid("fuse", node.get("id")),
        "op": "FusionExec",
        "family": family,
        "native": False,
        "inputs": inputs,
    }
    if family == "ltr" and node.get("model"):
        fuse["model"] = node["model"]
    return fuse


def compile(
    logical: dict[str, Any],
    *,
    profile: str | Path | dict[str, Any],
    logical_ref: str | None = None,
    late_rewrite: str | None = None,
) -> dict[str, Any]:
    """Compile LogicalPlan → PhysicalPlan for a named or dict profile.

    ``profile`` may be a profile id (``qdrant``), path, or loaded profile dict.
    """
    if isinstance(profile, dict):
        prof = profile
    else:
        prof = load_profile(profile)
    return plan_logical(
        logical, prof, logical_ref=logical_ref, late_rewrite=late_rewrite
    )
