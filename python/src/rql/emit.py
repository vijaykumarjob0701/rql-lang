"""Emit vendor request *sketches* from PhysicalPlan JSON.

Honesty contract
----------------
- Output is approximate docs-shaped JSON or SQL text (v0.1 sketches).
- Emitters **never** open sockets or hit live vector DBs.
- Placeholders (`$q_dense`, ``:q_embedding``) stand in for real vectors.
- Pluggable ``Adapter`` interface is ready for future live backends.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

VENDORS = ("qdrant", "elasticsearch", "pgvector")

_SKETCH_BANNER = (
    "SKETCH ONLY — Hypothesis / approximate — not executed against a live DB. "
    "Docs-shaped emit from PhysicalPlan; live smoke = HUMAN_TODO."
)


class AdapterError(ValueError):
    """Emit failed (unknown vendor / unsupported plan shape)."""


def list_vendors() -> list[str]:
    return list(VENDORS)


def resolve_vendor(physical: dict, profile: str | None = None) -> str:
    """Pick vendor from explicit profile, plan meta.profileId, or capabilitiesUsed.vendorHints."""
    if profile:
        v = profile.strip().lower()
        if v not in VENDORS:
            raise AdapterError(f"unknown vendor/profile {profile!r}; expected one of {VENDORS}")
        return v
    meta = physical.get("meta") or {}
    pid = (meta.get("profileId") or "").strip().lower()
    if pid in VENDORS:
        return pid
    caps = physical.get("capabilitiesUsed") or {}
    hints = caps.get("vendorHints") or []
    for h in hints:
        hl = str(h).strip().lower()
        if hl in VENDORS:
            return hl
    raise AdapterError(
        "cannot resolve vendor: pass --profile or set meta.profileId / capabilitiesUsed.vendorHints"
    )


def emit_plan(physical: dict, profile: str | None = None) -> dict[str, Any]:
    """Return an emit artifact dict (never network I/O).

    Keys: vendor, format, label, approximate, notExecuted, sketch, notes,
    physicalPlanRef (optional), body (dict|str), filesuggested_ext.
    """
    if physical.get("kind") != "PhysicalPlan":
        raise AdapterError(f"expected kind=PhysicalPlan, got {physical.get('kind')!r}")
    vendor = resolve_vendor(physical, profile)
    root = physical.get("root")
    if not isinstance(root, dict):
        raise AdapterError("PhysicalPlan.root missing or not an object")

    if vendor == "qdrant":
        body, notes = _emit_qdrant(root, physical)
        fmt = "json"
        ext = "request.json"
    elif vendor == "elasticsearch":
        body, notes = _emit_elasticsearch(root, physical)
        fmt = "json"
        ext = "request.json"
    elif vendor == "pgvector":
        body, notes = _emit_pgvector(root, physical)
        fmt = "sql"
        ext = "request.sql"
    else:
        raise AdapterError(f"unhandled vendor {vendor}")

    return {
        "schemaVersion": "0.1.0-draft-emit",
        "kind": "VendorRequestSketch",
        "label": "Hypothesis",
        "approximate": True,
        "notExecuted": True,
        "vendor": vendor,
        "format": fmt,
        "filesuggested_ext": ext,
        "notes": notes,
        "banner": _SKETCH_BANNER,
        "body": body,
        "meta": {
            "sourceProfileId": (physical.get("meta") or {}).get("profileId"),
            "logicalPlanRef": (physical.get("meta") or {}).get("logicalPlanRef"),
            "emitHonesty": "strings/JSON files only; no live DB calls",
        },
    }


def emit_to_files(
    physical: dict,
    out_dir: Path,
    stem: str,
    profile: str | None = None,
) -> list[Path]:
    """Write sketch artifact(s) under out_dir. Returns paths written."""
    art = emit_plan(physical, profile=profile)
    out_dir.mkdir(parents=True, exist_ok=True)
    vendor = art["vendor"]
    written: list[Path] = []

    # Envelope always as JSON for auditability
    envelope_path = out_dir / f"{stem}.{vendor}.emit.json"
    envelope = {k: v for k, v in art.items() if k != "body"}
    # Keep a compact body preview in envelope for JSON formats; SQL stays separate
    if art["format"] == "json":
        envelope["body"] = art["body"]
        envelope_path.write_text(
            json.dumps(envelope, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        written.append(envelope_path)
    else:
        envelope["bodyRef"] = f"{stem}.{vendor}.request.sql"
        envelope_path.write_text(
            json.dumps(envelope, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        written.append(envelope_path)
        sql_path = out_dir / f"{stem}.{vendor}.request.sql"
        body = art["body"]
        if isinstance(body, dict):
            text = body.get("sql") or json.dumps(body, indent=2)
        else:
            text = str(body)
        if not text.endswith("\n"):
            text += "\n"
        header = f"-- {_SKETCH_BANNER}\n-- vendor={vendor} label=Hypothesis approximate=true notExecuted=true\n"
        sql_path.write_text(header + text, encoding="utf-8")
        written.append(sql_path)
    return written


# ---------------------------------------------------------------------------
# Tree helpers
# ---------------------------------------------------------------------------

def _find_ops(node: dict, op: str) -> list[dict]:
    found: list[dict] = []
    if node.get("op") == op:
        found.append(node)
    if isinstance(node.get("input"), dict):
        found.extend(_find_ops(node["input"], op))
    for child in node.get("inputs") or []:
        if isinstance(child, dict):
            found.extend(_find_ops(child, op))
    return found


def _unwrap_shim(node: dict) -> tuple[dict, dict | None]:
    """If ShimCast, return (inner, shim_node); else (node, None)."""
    if node.get("op") == "ShimCast":
        inner = node.get("input")
        if not isinstance(inner, dict):
            raise AdapterError("ShimCast.input missing")
        return inner, node
    return node, None


def _predicate_expr(node: dict | None) -> str | None:
    if not node:
        return None
    pred = node.get("predicate") or {}
    return pred.get("expr")


def _toy_qdrant_filter(expr: str | None) -> dict | None:
    """Best-effort opaque-expr → Qdrant Filter sketch (Hypothesis)."""
    if not expr:
        return None
    must: list[dict] = []
    # tenant_id = 'acme'
    m = re.search(r"tenant_id\s*=\s*'([^']+)'", expr)
    if m:
        must.append({"key": "tenant_id", "match": {"value": m.group(1)}})
    m = re.search(r"clearance\s*>=\s*(\d+)", expr)
    if m:
        must.append({"key": "clearance", "range": {"gte": int(m.group(1))}})
    if not must:
        # opaque fallback — keep expr as comment field (not valid Qdrant; marked approximate)
        return {
            "_sketch_opaque_expr": expr,
            "must": [{"key": "_unparsed", "match": {"value": "SEE_NOTES"}}],
        }
    return {"must": must}


def _toy_es_filter(expr: str | None) -> dict | None:
    if not expr:
        return None
    filters: list[dict] = []
    m = re.search(r"tenant_id\s*=\s*'([^']+)'", expr)
    if m:
        filters.append({"term": {"tenant_id": m.group(1)}})
    m = re.search(r"clearance\s*>=\s*(\d+)", expr)
    if m:
        filters.append({"range": {"clearance": {"gte": int(m.group(1))}}})
    if not filters:
        return {"query_string": {"query": expr, "_sketch": "opaque"}}
    return {"bool": {"filter": filters}}


def _toy_sql_where(expr: str | None) -> str:
    if not expr:
        return "TRUE /* no predicate */"
    # Keep as SQL-ish comment + raw expr (Hypothesis; not a real SQL parser)
    return f"({expr}) /* Hypothesis: opaque predicate pass-through */"


# ---------------------------------------------------------------------------
# Qdrant Query API sketch
# ---------------------------------------------------------------------------

def _emit_qdrant(root: dict, physical: dict) -> tuple[Any, list[str]]:
    notes = [
        "Qdrant Query API-shaped JSON (docs hybrid/filter surface; journal 0020).",
        "Hypothesis / approximate sketch — not executed.",
    ]
    node, shim = _unwrap_shim(root)
    filter_nodes = _find_ops(root, "FilterExec")
    fnode = filter_nodes[0] if filter_nodes else None
    filt = _toy_qdrant_filter(_predicate_expr(fnode))
    if fnode:
        notes.append(
            f"FilterExec mode={fnode.get('mode')} pruningStrategy={fnode.get('pruningStrategy')} "
            "(leaf-propagated filter on Query API — docs Established; emit packaging Hypothesis)."
        )

    if node.get("op") == "FusionExec" and node.get("family") == "rrf":
        return _qdrant_rrf(node, filt, shim, notes)
    if node.get("op") == "FilterExec":
        inner = node.get("input") or {}
        return _qdrant_search_or_query(inner, filt, notes, limit_from=inner)
    if node.get("op") in ("AnnExec", "Bm25Exec", "LateInteractExec"):
        return _qdrant_search_or_query(node, filt, notes, limit_from=node)

    notes.append(f"fallback: unsupported root op={node.get('op')}; emitting diagnostic stub")
    return {
        "query": {"error": "unsupported_op", "op": node.get("op")},
        "_sketch": True,
        "_label": "Hypothesis",
    }, notes


def _qdrant_rrf(
    fuse: dict, filt: dict | None, shim: dict | None, notes: list[str]
) -> tuple[dict, list[str]]:
    k_rrf = fuse.get("k_rrf", 60)
    limit = 10
    prefetches: list[dict] = []
    for child in fuse.get("inputs") or []:
        if not isinstance(child, dict):
            continue
        lim = int(child.get("k") or 50)
        limit = max(limit, lim)  # window hint
        if child.get("op") == "AnnExec":
            pref: dict[str, Any] = {
                "query": {
                    "nearest": {
                        "vector": {
                            "name": "dense",
                            "vector": child.get("queryRef") or "$q_dense",
                        }
                    }
                },
                "limit": lim,
            }
            if filt:
                pref["filter"] = filt
            if child.get("efSearch"):
                pref["params"] = {"hnsw_ef": child["efSearch"]}
            prefetches.append(pref)
        elif child.get("op") == "Bm25Exec":
            pref = {
                "query": {
                    "nearest": {
                        "vector": {
                            "name": "bm25_sparse",
                            "vector": {
                                "_sketch_text": child.get("queryText"),
                                "_note": "sparse/BM25 vector placeholder",
                            },
                        }
                    }
                },
                "limit": lim,
            }
            if filt:
                pref["filter"] = filt
            prefetches.append(pref)
        else:
            prefetches.append({"_unsupported_child": child.get("op"), "limit": lim})

    body: dict[str, Any] = {
        "_sketch": True,
        "_label": "Hypothesis",
        "_approximate": True,
        "_notExecuted": True,
        "collection": _collection_hint(fuse) or "chunks",
        "prefetch": prefetches,
        "query": {"fusion": "rrf"},
        "limit": min(limit, 50),
        "params": {"_rrf_k_hint": k_rrf},
    }
    if fuse.get("native"):
        notes.append("FusionExec native=true → prefetch + fusion=rrf (Qdrant docs Established shape).")
    else:
        notes.append(
            "FusionExec native=false — still emit prefetch sketch; client must apply RRF "
            f"(ShimCast={shim.get('shim') if shim else 'n/a'})."
        )
        body["_client_rrf_required"] = True
        if shim:
            body["_shim"] = {
                "shim": shim.get("shim"),
                "expensive": shim.get("expensive"),
                "aclUnsafe": shim.get("aclUnsafe"),
            }
    return body, notes


def _qdrant_search_or_query(
    node: dict, filt: dict | None, notes: list[str], limit_from: dict
) -> tuple[dict, list[str]]:
    limit = int(limit_from.get("k") or 20)
    if node.get("op") == "AnnExec":
        body: dict[str, Any] = {
            "_sketch": True,
            "_label": "Hypothesis",
            "_approximate": True,
            "_notExecuted": True,
            "collection": node.get("collection") or "chunks",
            "query": {
                "nearest": {
                    "vector": {
                        "name": "dense",
                        "vector": node.get("queryRef") or "$q_dense",
                    }
                }
            },
            "limit": limit,
        }
        if filt:
            body["filter"] = filt
        if node.get("efSearch"):
            body["params"] = {"hnsw_ef": node["efSearch"]}
        notes.append("AnnExec → Query API nearest (dense) sketch.")
        return body, notes
    if node.get("op") == "LateInteractExec":
        body = {
            "_sketch": True,
            "_label": "Hypothesis",
            "_approximate": True,
            "_notExecuted": True,
            "collection": node.get("collection") or "chunks",
            "query": {
                "nearest": {
                    "vector": {
                        "name": "colbert_multivector",
                        "vector": node.get("queryRef") or "$q_late",
                    }
                }
            },
            "limit": limit,
            "_late_variant": node.get("variant") or "colbert",
        }
        if filt:
            body["filter"] = filt
        notes.append("LateInteractExec → multivector nearest sketch (docs partial).")
        return body, notes
    body = {
        "_sketch": True,
        "_label": "Hypothesis",
        "query": {"_unsupported": node.get("op")},
        "limit": limit,
    }
    if filt:
        body["filter"] = filt
    return body, notes


def _collection_hint(node: dict) -> str | None:
    for ann in _find_ops(node, "AnnExec"):
        if ann.get("collection"):
            return ann["collection"]
    for bm in _find_ops(node, "Bm25Exec"):
        if bm.get("collection"):
            return bm["collection"]
    return None


# ---------------------------------------------------------------------------
# Elasticsearch retriever / knn sketch
# ---------------------------------------------------------------------------

def _emit_elasticsearch(root: dict, physical: dict) -> tuple[Any, list[str]]:
    notes = [
        "Elasticsearch retriever / knn request sketch (docs RRF + knn.filter; journal 0020).",
        "Hypothesis / approximate — not executed.",
    ]
    node, shim = _unwrap_shim(root)
    filter_nodes = _find_ops(root, "FilterExec")
    fnode = filter_nodes[0] if filter_nodes else None
    filt = _toy_es_filter(_predicate_expr(fnode))
    if fnode:
        notes.append(
            f"FilterExec mode={fnode.get('mode')} → knn.filter / retriever filter "
            "(ES docs: filter during approximate kNN — Established surface)."
        )

    if node.get("op") == "FusionExec" and node.get("family") == "rrf":
        return _es_rrf(node, filt, shim, notes)
    if node.get("op") == "FusionExec" and node.get("family") == "linear":
        return _es_linear(node, filt, shim, notes)
    if node.get("op") == "FilterExec":
        inner = node.get("input") or {}
        return _es_knn_or_query(inner, filt, notes)
    if node.get("op") in ("AnnExec", "Bm25Exec", "LateInteractExec"):
        return _es_knn_or_query(node, filt, notes)

    return {
        "_sketch": True,
        "_label": "Hypothesis",
        "error": "unsupported_op",
        "op": node.get("op"),
    }, notes


def _es_rrf(
    fuse: dict, filt: dict | None, shim: dict | None, notes: list[str]
) -> tuple[dict, list[str]]:
    retrievers: list[dict] = []
    window = 50
    for child in fuse.get("inputs") or []:
        if not isinstance(child, dict):
            continue
        window = max(window, int(child.get("k") or 50))
        if child.get("op") == "AnnExec":
            knn: dict[str, Any] = {
                "field": "embedding",
                "query_vector": child.get("queryRef") or "$q_dense",
                "k": child.get("k") or 50,
                "num_candidates": max(100, int(child.get("efSearch") or 100)),
            }
            if filt:
                knn["filter"] = filt
            retrievers.append({"knn": knn})
        elif child.get("op") == "Bm25Exec":
            std: dict[str, Any] = {
                "standard": {
                    "query": {
                        "match": {
                            "text": child.get("queryText") or ""
                        }
                    }
                }
            }
            if filt:
                std["standard"]["filter"] = filt
            retrievers.append(std)
        else:
            retrievers.append({"_unsupported_child": child.get("op")})

    body: dict[str, Any] = {
        "_sketch": True,
        "_label": "Hypothesis",
        "_approximate": True,
        "_notExecuted": True,
        "retriever": {
            "rrf": {
                "retrievers": retrievers,
                "rank_constant": fuse.get("k_rrf", 60),
                "rank_window_size": window,
            }
        },
        "size": min(window, 50),
    }
    if fuse.get("native"):
        notes.append("FusionExec native RRF → retriever.rrf sketch.")
    else:
        notes.append("native=false — emit still shows RRF shape; mark client shim if needed.")
        body["_client_rrf_required"] = True
        if shim:
            body["_shim"] = {"shim": shim.get("shim"), "expensive": shim.get("expensive")}
    return body, notes


def _es_linear(
    fuse: dict, filt: dict | None, shim: dict | None, notes: list[str]
) -> tuple[dict, list[str]]:
    notes.append(
        "Fuse_linear → weighted / boost sketch (semantics not interchangeable across vendors)."
    )
    # Reuse RRF structure but tag as linear sketch
    body, notes2 = _es_rrf(fuse, filt, shim, notes)
    body["retriever"] = {
        "_linear_fusion_sketch": True,
        "_note": "ES often uses query+knn score sum with boosts; not identical to RRF",
        "rrf_shape_reused_for_structure_only": body.get("retriever"),
    }
    return body, notes2


def _es_knn_or_query(node: dict, filt: dict | None, notes: list[str]) -> tuple[dict, list[str]]:
    if node.get("op") == "AnnExec":
        knn: dict[str, Any] = {
            "field": "embedding",
            "query_vector": node.get("queryRef") or "$q_dense",
            "k": node.get("k") or 20,
            "num_candidates": max(100, int(node.get("efSearch") or 100)),
        }
        if filt:
            knn["filter"] = filt
        body = {
            "_sketch": True,
            "_label": "Hypothesis",
            "_approximate": True,
            "_notExecuted": True,
            "knn": knn,
            "size": node.get("k") or 20,
        }
        notes.append("AnnExec → knn (+ optional filter) sketch.")
        return body, notes
    if node.get("op") == "Bm25Exec":
        body = {
            "_sketch": True,
            "_label": "Hypothesis",
            "query": {"match": {"text": node.get("queryText") or ""}},
            "size": node.get("k") or 20,
        }
        if filt:
            body["query"] = {"bool": {"must": [body["query"]], "filter": [filt]}}
        return body, notes
    return {
        "_sketch": True,
        "_label": "Hypothesis",
        "error": "unsupported",
        "op": node.get("op"),
    }, notes


# ---------------------------------------------------------------------------
# pgvector SQL sketch
# ---------------------------------------------------------------------------

def _emit_pgvector(root: dict, physical: dict) -> tuple[Any, list[str]]:
    notes = [
        "pgvector SQL sketch (ORDER BY embedding <=> … LIMIT; iterative comment if ITERATIVE).",
        "Hypothesis / approximate — not executed.",
    ]
    node, shim = _unwrap_shim(root)
    filter_nodes = _find_ops(root, "FilterExec")
    fnode = filter_nodes[0] if filter_nodes else None
    where = _toy_sql_where(_predicate_expr(fnode))
    mode = fnode.get("mode") if fnode else None

    parts: list[str] = []
    if mode == "ITERATIVE":
        parts.append(
            "-- FilterExec mode=ITERATIVE: enable iterative index scans (pgvector ≥0.8.0) "
            "so POST-filter recovers recall; see docs/09 + journal 0020."
        )
        parts.append("-- SET hnsw.iterative_scan = strict_order;  -- illustrative, not executed")
        notes.append("ITERATIVE → comment + SET hint (docs Established; emit Hypothesis).")
    elif mode == "POST":
        parts.append("-- FilterExec mode=POST: approx index scan then SQL WHERE (pgvector docs).")
    elif mode == "PRE":
        parts.append(
            "-- FilterExec mode=PRE requested; pgvector approx indexes are typically POST — "
            "planner may still emit ITERATIVE for ACL (see physical plan)."
        )

    if node.get("op") == "FilterExec":
        inner = node.get("input") or {}
        parts.extend(_pg_leaf_sql(inner, where))
    elif node.get("op") == "FusionExec":
        parts.append(
            "-- FusionExec: pgvector has no native RRF/weighted fuse — "
            f"family={node.get('family')} native={node.get('native')}."
        )
        if shim:
            parts.append(
                f"-- ShimCast shim={shim.get('shim')} expensive={shim.get('expensive')} "
                f"aclUnsafe={shim.get('aclUnsafe')} — client merges ranked lists."
            )
            notes.append(f"ShimCast {shim.get('shim')} → dual SQL + client merge note.")
        for i, child in enumerate(node.get("inputs") or []):
            if isinstance(child, dict):
                parts.append(f"-- --- branch {i}: {child.get('op')} ---")
                parts.extend(_pg_leaf_sql(child, where))
    elif node.get("op") in ("AnnExec", "Bm25Exec", "LateInteractExec"):
        parts.extend(_pg_leaf_sql(node, where))
    else:
        parts.append(f"-- unsupported op={node.get('op')}")

    sql = "\n".join(parts) + "\n"
    body = {
        "sql": sql,
        "_sketch": True,
        "_label": "Hypothesis",
        "_approximate": True,
        "_notExecuted": True,
    }
    return body, notes


def _pg_leaf_sql(node: dict, where: str) -> list[str]:
    table = node.get("collection") or "chunks"
    k = int(node.get("k") or 20)
    lines: list[str] = []
    if node.get("op") == "AnnExec":
        qref = node.get("queryRef") or ":q_embedding"
        metric = node.get("metric") or "cosine"
        op = "<=>" if metric in ("cosine", "l2", "euclidean") else "<=>"
        lines.append(
            f"SELECT id, embedding {op} {qref} AS dist\n"
            f"FROM {table}\n"
            f"WHERE {where}\n"
            f"ORDER BY embedding {op} {qref}\n"
            f"LIMIT {k};"
        )
        if node.get("efSearch"):
            lines.append(f"-- hnsw.ef_search = {node['efSearch']}  -- session GUC hint, not executed")
    elif node.get("op") == "Bm25Exec":
        qtext = (node.get("queryText") or "").replace("'", "''")
        lines.append(
            f"SELECT id, ts_rank(tsv, plainto_tsquery('english', '{qtext}')) AS rank\n"
            f"FROM {table}\n"
            f"WHERE {where}\n"
            f"  AND tsv @@ plainto_tsquery('english', '{qtext}')\n"
            f"ORDER BY rank DESC\n"
            f"LIMIT {k};"
        )
        lines.append("-- BM25/FTS via Postgres tsvector — not native BM25 engine")
    elif node.get("op") == "LateInteractExec":
        lines.append(
            f"-- LateInteractExec variant={node.get('variant')}: no first-class MaxSim in pgvector README;\n"
            f"-- fail-closed or external rescore. Placeholder LIMIT {k} on {table}."
        )
    else:
        lines.append(f"-- leaf op={node.get('op')} not sketched")
    return lines


# ---------------------------------------------------------------------------
# Public API + pluggable adapter interface
# ---------------------------------------------------------------------------


@runtime_checkable
class Adapter(Protocol):
    """Pluggable backend. v0.1 ships sketch adapters only (no network I/O)."""

    name: str

    def emit(self, physical: dict[str, Any]) -> dict[str, Any]:
        """Return an EmitResult / VendorRequestSketch dict."""
        ...


class SketchAdapter:
    """Built-in sketch emitter for a single vendor (no live DB)."""

    def __init__(self, vendor: str):
        if vendor not in VENDORS:
            raise AdapterError(f"unknown vendor {vendor!r}; expected one of {VENDORS}")
        self.name = vendor

    def emit(self, physical: dict[str, Any]) -> dict[str, Any]:
        return emit_plan(physical, profile=self.name)


_ADAPTERS: dict[str, Adapter] = {v: SketchAdapter(v) for v in VENDORS}


def register_adapter(adapter: Adapter) -> None:
    """Register a custom adapter (for future live backends)."""
    _ADAPTERS[adapter.name] = adapter


def emit(physical: dict[str, Any], *, backend: str | None = None, profile: str | None = None) -> dict[str, Any]:
    """Emit a vendor request sketch (EmitResult).

    Parameters
    ----------
    physical:
        PhysicalPlan dict from ``compile``.
    backend:
        Vendor / adapter name (``qdrant`` | ``elasticsearch`` | ``pgvector``).
        Aliased as ``profile`` for planner symmetry.
    profile:
        Deprecated alias for ``backend``.
    """
    vendor = backend or profile
    if vendor and vendor in _ADAPTERS:
        return _ADAPTERS[vendor].emit(physical)
    return emit_plan(physical, profile=vendor)
