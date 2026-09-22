"""Opt-in live Qdrant Query API adapter.

``emit`` stays sketch-only. This module builds real Query API bodies and
POSTs them when ``execute`` is called. HTTP is stdlib-only (urllib).
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from typing import Any, Protocol
from urllib.parse import quote

from .emit import AdapterError, _find_ops, _predicate_expr, _unwrap_shim, emit_plan, resolve_vendor

DEFAULT_URL = "http://localhost:6333"
DENSE_NAME = "dense"
SPARSE_NAME = "bm25_sparse"


class ExecutionError(AdapterError):
    """Live execute failed (unsupported plan, missing bindings, or HTTP)."""


class QdrantTransport(Protocol):
    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any] | None,
        timeout: float | None = None,
    ) -> tuple[int, dict[str, Any]]:
        ...


def _env_url() -> str:
    return (os.environ.get("QDRANT_URL") or DEFAULT_URL).rstrip("/")


def _env_api_key() -> str | None:
    key = os.environ.get("QDRANT_API_KEY")
    return key or None


def default_transport(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any] | None,
    timeout: float | None = None,
) -> tuple[int, dict[str, Any]]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout or 10.0) as resp:
            raw = resp.read()
            status = getattr(resp, "status", 200)
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")[:800]
        raise ExecutionError(f"Qdrant HTTP {exc.code}: {err_body}") from exc
    except urllib.error.URLError as exc:
        raise ExecutionError(f"Qdrant request failed: {exc.reason}") from exc
    if not raw:
        return status, {}
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ExecutionError(f"Qdrant returned non-JSON: {raw[:200]!r}") from exc
    if not isinstance(parsed, dict):
        raise ExecutionError("Qdrant JSON root was not an object")
    return status, parsed


_CMP = re.compile(
    r"""
    (?P<key>[A-Za-z_][A-Za-z0-9_]*)
    \s*
    (?P<op>>=|<=|!=|<>|=|>|<)
    \s*
    (?P<val>'(?:[^']*)'|"(?:[^"]*)"|-?\d+(?:\.\d+)?)
    """,
    re.VERBOSE,
)


def parse_qdrant_filter(expr: str | None) -> dict[str, Any] | None:
    """Translate AND-connected comparisons into a Qdrant Filter.

    Unparsed residue is an error (do not send emit's ``_unparsed`` stub).
    """
    if not expr or not expr.strip():
        return None
    leftover = expr
    must: list[dict[str, Any]] = []
    for match in _CMP.finditer(expr):
        leftover = leftover.replace(match.group(0), " ", 1)
        key = match.group("key")
        op = match.group("op")
        raw = match.group("val")
        if raw[0] in "'\"":
            value: Any = raw[1:-1]
        else:
            value = float(raw) if "." in raw else int(raw)
        if op == "=":
            must.append({"key": key, "match": {"value": value}})
        elif op in ("!=", "<>"):
            must.append({"must_not": {"key": key, "match": {"value": value}}})
        else:
            range_key = {"<": "lt", "<=": "lte", ">": "gt", ">=": "gte"}[op]
            must.append({"key": key, "range": {range_key: value}})
    residue = leftover
    residue = re.sub(r"\bAND\b", " ", residue, flags=re.I)
    residue = re.sub(r"[()\s]+", "", residue)
    if residue:
        raise ExecutionError(
            f"filter expression is not representable as a Qdrant Filter: {expr!r}"
        )
    if not must:
        raise ExecutionError(f"filter expression produced no clauses: {expr!r}")
    # Flatten accidental must_not wrappers into Qdrant must_not list
    must_ok: list[dict[str, Any]] = []
    must_not: list[dict[str, Any]] = []
    for clause in must:
        if "must_not" in clause and len(clause) == 1:
            must_not.append(clause["must_not"])
        else:
            must_ok.append(clause)
    out: dict[str, Any] = {}
    if must_ok:
        out["must"] = must_ok
    if must_not:
        out["must_not"] = must_not
    return out


def _lookup_vector(vectors: dict[str, Any] | None, *names: str) -> Any | None:
    if not vectors:
        return None
    for name in names:
        if name in vectors and vectors[name] is not None:
            return vectors[name]
        stripped = name[1:] if name.startswith("$") else f"${name}"
        if stripped in vectors and vectors[stripped] is not None:
            return vectors[stripped]
    return None


def bind_vector(
    ref: Any,
    vectors: dict[str, Any] | None,
    *,
    kind: str,
    extra_names: tuple[str, ...] = (),
) -> Any:
    if isinstance(ref, list):
        return ref
    if isinstance(ref, dict) and "indices" in ref and "values" in ref:
        return {"indices": list(ref["indices"]), "values": list(ref["values"])}
    names: list[str] = []
    if isinstance(ref, str):
        names.append(ref)
        names.append(ref[1:] if ref.startswith("$") else f"${ref}")
    names.extend(extra_names)
    if kind == "dense":
        names.extend(("dense", "$q_dense"))
    else:
        names.extend(("sparse", "bm25_sparse", "$q_sparse"))
    found = _lookup_vector(vectors, *names)
    if found is None:
        hint = ref if ref is not None else kind
        raise ExecutionError(f"missing vector binding for {hint!r} ({kind})")
    if kind == "sparse":
        if not isinstance(found, dict) or "indices" not in found or "values" not in found:
            raise ExecutionError(f"sparse binding for {hint!r} must be {{indices, values}}")
        return {"indices": list(found["indices"]), "values": list(found["values"])}
    if not isinstance(found, list):
        raise ExecutionError(f"dense binding for {hint!r} must be a list of floats")
    return found


def _vector_names(overrides: dict[str, str] | None) -> tuple[str, str]:
    overrides = overrides or {}
    return (
        overrides.get("dense") or overrides.get("using") or DENSE_NAME,
        overrides.get("sparse") or overrides.get("bm25") or SPARSE_NAME,
    )


def _collection_of(node: dict[str, Any], override: str | None) -> str:
    if override:
        return override
    for op in ("AnnExec", "Bm25Exec", "LateInteractExec"):
        for found in _find_ops(node, op):
            if found.get("collection"):
                return str(found["collection"])
    return "chunks"


def _assert_not_late(node: dict[str, Any]) -> None:
    if _find_ops(node, "LateInteractExec"):
        raise ExecutionError(
            "LateInteractExec is not representable on the live Qdrant adapter "
            "(fail-closed: will not silently substitute dense cosine)."
        )


def _fusion_family(node: dict[str, Any]) -> str | None:
    if node.get("op") == "FusionExec":
        return str(node.get("family") or "")
    return None


def build_query_from_physical(
    physical: dict[str, Any],
    *,
    vectors: dict[str, Any] | None = None,
    collection: str | None = None,
    vector_names: dict[str, str] | None = None,
) -> tuple[str, dict[str, Any], list[str]]:
    if physical.get("kind") != "PhysicalPlan":
        raise ExecutionError(f"expected kind=PhysicalPlan, got {physical.get('kind')!r}")
    root = physical.get("root")
    if not isinstance(root, dict):
        raise ExecutionError("PhysicalPlan.root missing or not an object")
    _assert_not_late(root)
    notes = [
        "Live Qdrant Query API (POST /collections/{collection}/points/query).",
        "Opt-in execute path — emit() remains a notExecuted sketch.",
    ]
    node, _shim = _unwrap_shim(root)
    filter_nodes = _find_ops(root, "FilterExec")
    fnode = filter_nodes[0] if filter_nodes else None
    filt = parse_qdrant_filter(_predicate_expr(fnode)) if fnode else None
    if fnode:
        mode = fnode.get("mode")
        notes.append(
            f"FilterExec mode={mode} applied as Query API filter "
            f"(leaf-propagated PRE-style; planner mode={mode})."
        )
    dense_name, sparse_name = _vector_names(vector_names)
    coll = _collection_of(root, collection)

    if _fusion_family(node) == "rrf" or (
        node.get("op") == "FilterExec"
        and isinstance(node.get("input"), dict)
        and _fusion_family(node["input"]) == "rrf"
    ):
        fuse = node if node.get("op") == "FusionExec" else node.get("input")
        body = _rrf_body(fuse, filt, vectors, dense_name, sparse_name, notes)
        return coll, body, notes

    if _fusion_family(node) and _fusion_family(node) != "rrf":
        raise ExecutionError(
            f"FusionExec family={node.get('family')!r} is not representable "
            "on the live Qdrant adapter (RRF prefetch only)."
        )
    if node.get("op") == "FilterExec":
        inner = node.get("input") or {}
        if not isinstance(inner, dict):
            raise ExecutionError("FilterExec.input missing")
        if inner.get("op") == "FusionExec":
            raise ExecutionError(
                f"FusionExec family={inner.get('family')!r} is not representable "
                "on the live Qdrant adapter (RRF prefetch only)."
            )
        body = _ann_body(inner, filt, vectors, dense_name)
        return coll, body, notes
    if node.get("op") == "AnnExec":
        body = _ann_body(node, filt, vectors, dense_name)
        return coll, body, notes
    if node.get("op") == "Bm25Exec":
        body = {
            "query": bind_vector(None, vectors, kind="sparse"),
            "using": sparse_name,
            "limit": int(node.get("k") or 20),
            "with_payload": True,
        }
        if filt:
            body["filter"] = filt
        notes.append("Bm25Exec → sparse Query API (named vector).")
        return coll, body, notes
    raise ExecutionError(
        f"unsupported physical op for live Qdrant execute: {node.get('op')!r}"
    )


def _ann_body(
    node: dict[str, Any],
    filt: dict[str, Any] | None,
    vectors: dict[str, Any] | None,
    dense_name: str,
) -> dict[str, Any]:
    if node.get("op") != "AnnExec":
        raise ExecutionError(
            f"expected AnnExec for dense search, got {node.get('op')!r}"
        )
    vec = bind_vector(node.get("queryRef"), vectors, kind="dense")
    body: dict[str, Any] = {
        "query": vec,
        "using": dense_name,
        "limit": int(node.get("k") or 20),
        "with_payload": True,
    }
    if filt:
        body["filter"] = filt
    if node.get("efSearch"):
        body["params"] = {"hnsw_ef": node["efSearch"]}
    return body


def _rrf_body(
    fuse: dict[str, Any],
    filt: dict[str, Any] | None,
    vectors: dict[str, Any] | None,
    dense_name: str,
    sparse_name: str,
    notes: list[str],
) -> dict[str, Any]:
    prefetches: list[dict[str, Any]] = []
    limit = 10
    for child in fuse.get("inputs") or []:
        if not isinstance(child, dict):
            continue
        lim = int(child.get("k") or 50)
        limit = max(limit, lim)
        if child.get("op") == "AnnExec":
            pref: dict[str, Any] = {
                "query": bind_vector(child.get("queryRef"), vectors, kind="dense"),
                "using": dense_name,
                "limit": lim,
            }
            if filt:
                pref["filter"] = filt
            if child.get("efSearch"):
                pref["params"] = {"hnsw_ef": child["efSearch"]}
            prefetches.append(pref)
        elif child.get("op") == "Bm25Exec":
            pref = {
                "query": bind_vector(None, vectors, kind="sparse"),
                "using": sparse_name,
                "limit": lim,
            }
            if filt:
                pref["filter"] = filt
            prefetches.append(pref)
        else:
            raise ExecutionError(
                f"unsupported RRF child op {child.get('op')!r} "
                "(live adapter supports AnnExec + Bm25Exec prefetch only)"
            )
    if len(prefetches) < 2:
        raise ExecutionError("RRF execute requires dense + sparse prefetch bindings")
    notes.append(
        "FusionExec family=rrf → prefetch + query.fusion=rrf "
        "(matches emit sketch; Query API since Qdrant 1.10)."
    )
    body: dict[str, Any] = {
        "prefetch": prefetches,
        "query": {"fusion": "rrf"},
        "limit": min(limit, 50),
        "with_payload": True,
    }
    if fuse.get("k_rrf") is not None:
        body["params"] = {"_rrf_k_hint": fuse.get("k_rrf")}
        notes.append(
            f"k_rrf={fuse.get('k_rrf')} recorded as a hint; "
            "FusionQuery {{fusion: rrf}} does not take k on all Qdrant versions."
        )
    return body


def _strip_sketch_keys(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {
            k: _strip_sketch_keys(v)
            for k, v in obj.items()
            if not str(k).startswith("_")
        }
    if isinstance(obj, list):
        return [_strip_sketch_keys(v) for v in obj]
    return obj


def _materialize_query_field(q: Any, vectors: dict[str, Any] | None) -> Any:
    if isinstance(q, list):
        return q
    if not isinstance(q, dict):
        return q
    if "fusion" in q:
        return {"fusion": q["fusion"]}
    if "rrf" in q:
        return {"fusion": "rrf"}
    nearest = q.get("nearest")
    if isinstance(nearest, dict):
        vec_wrap = nearest.get("vector") if isinstance(nearest.get("vector"), dict) else nearest
        name = (vec_wrap or {}).get("name")
        raw = (vec_wrap or {}).get("vector")
        if name in ("colbert_multivector",) or (isinstance(name, str) and "colbert" in name):
            raise ExecutionError(
                "late / multivector sketch is not representable on the live Qdrant adapter"
            )
        kind = "sparse" if name in (SPARSE_NAME, "sparse") or (
            isinstance(raw, dict) and ("_sketch_text" in raw or "indices" in raw)
        ) else "dense"
        return bind_vector(raw if not (isinstance(raw, dict) and "_sketch_text" in raw) else None, vectors, kind=kind)
    if "indices" in q and "values" in q:
        return bind_vector(q, vectors, kind="sparse")
    if q.get("error") or q.get("_unsupported") or q.get("unsupported"):
        raise ExecutionError(f"emit sketch is unsupported: {q}")
    return q


def build_query_from_sketch(
    art: dict[str, Any],
    *,
    vectors: dict[str, Any] | None = None,
    collection: str | None = None,
    vector_names: dict[str, str] | None = None,
) -> tuple[str, dict[str, Any], list[str]]:
    if art.get("kind") != "VendorRequestSketch":
        raise ExecutionError(f"expected kind=VendorRequestSketch, got {art.get('kind')!r}")
    if (art.get("vendor") or "").lower() not in ("", "qdrant"):
        raise ExecutionError(f"cannot execute {art.get('vendor')!r} sketch on Qdrant")
    body_in = art.get("body")
    if not isinstance(body_in, dict):
        raise ExecutionError("EmitResult.body must be a Qdrant JSON object")
    if body_in.get("_late_variant") or (isinstance(body_in.get("query"), dict) and (
        (body_in["query"].get("nearest") or {}).get("vector", {}) or {}
    ).get("name") == "colbert_multivector"):
        raise ExecutionError(
            "LateInteractExec sketch is not representable on the live Qdrant adapter "
            "(fail-closed)."
        )
    q = body_in.get("query")
    if isinstance(q, dict) and (q.get("error") or q.get("_unsupported")):
        raise ExecutionError(f"emit sketch is unsupported: {q}")
    notes = [
        "Live execute from VendorRequestSketch — placeholders bound, sketch flags stripped.",
    ]
    dense_name, sparse_name = _vector_names(vector_names)
    coll = collection or str(body_in.get("collection") or "chunks")
    cleaned = _strip_sketch_keys(body_in)
    cleaned.pop("collection", None)
    if "prefetch" in cleaned:
        prefetches = []
        for pref in cleaned.get("prefetch") or []:
            if not isinstance(pref, dict):
                continue
            if pref.get("_unsupported_child"):
                raise ExecutionError(f"unsupported prefetch child: {pref}")
            pq = _materialize_query_field(pref.get("query"), vectors)
            using = pref.get("using")
            if not using:
                using = sparse_name if isinstance(pq, dict) and "indices" in pq else dense_name
            item = {k: v for k, v in pref.items() if k not in ("query", "using")}
            item["query"] = pq
            item["using"] = using
            prefetches.append(item)
        cleaned["prefetch"] = prefetches
        cleaned["query"] = {"fusion": "rrf"}
        notes.append("Sketch prefetch + fusion=rrf materialized with bound vectors.")
    else:
        cleaned["query"] = _materialize_query_field(cleaned.get("query"), vectors)
        if "using" not in cleaned:
            cleaned["using"] = (
                sparse_name
                if isinstance(cleaned["query"], dict) and "indices" in cleaned["query"]
                else dense_name
            )
    cleaned["with_payload"] = True
    if isinstance(cleaned.get("params"), dict):
        cleaned["params"] = {
            k: v for k, v in cleaned["params"].items() if not str(k).startswith("_")
        }
        if not cleaned["params"]:
            cleaned.pop("params")
    return coll, cleaned, notes


def parse_hits(payload: dict[str, Any]) -> list[dict[str, Any]]:
    result = payload.get("result")
    points: Any
    if isinstance(result, dict):
        points = result.get("points", result.get("result", []))
    elif isinstance(result, list):
        points = result
    else:
        points = []
    hits: list[dict[str, Any]] = []
    for p in points or []:
        if not isinstance(p, dict):
            continue
        hits.append(
            {
                "id": p.get("id"),
                "score": p.get("score"),
                "payload": p.get("payload") or {},
            }
        )
    return hits


class QdrantAdapter:
    """Sketch emit + live Query API execute for vendor ``qdrant``."""

    name = "qdrant"

    def __init__(
        self,
        url: str | None = None,
        api_key: str | None = None,
        transport: QdrantTransport | None = None,
        timeout: float = 10.0,
    ):
        self.url = (url or _env_url()).rstrip("/")
        self.api_key = api_key if api_key is not None else _env_api_key()
        self.transport = transport
        self.timeout = timeout

    def emit(self, physical: dict[str, Any]) -> dict[str, Any]:
        return emit_plan(physical, profile="qdrant")

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_key:
            headers["api-key"] = self.api_key
        return headers

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
    ) -> tuple[int, dict[str, Any]]:
        url = f"{self.url}{path}"
        transport = self.transport
        if transport is None:
            return default_transport(method, url, self._headers(), body, self.timeout)
        return transport.request(method, url, self._headers(), body, self.timeout)

    def admin_put(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Small helper for smoke seeding (not part of the query API)."""
        _status, payload = self._request("PUT", path, body)
        return payload

    def admin_delete(self, path: str) -> dict[str, Any] | None:
        try:
            _status, payload = self._request("DELETE", path, None)
            return payload
        except ExecutionError:
            return None

    def execute(
        self,
        plan_or_emit: dict[str, Any],
        *,
        vectors: dict[str, Any] | None = None,
        collection: str | None = None,
        vector_names: dict[str, str] | None = None,
        **_ignored: Any,
    ) -> dict[str, Any]:
        kind = plan_or_emit.get("kind")
        if kind == "PhysicalPlan":
            vendor = resolve_vendor(plan_or_emit, "qdrant")
            if vendor != "qdrant":
                raise ExecutionError(f"plan vendor {vendor!r} is not qdrant")
            coll, request, notes = build_query_from_physical(
                plan_or_emit,
                vectors=vectors,
                collection=collection,
                vector_names=vector_names,
            )
        elif kind == "VendorRequestSketch":
            coll, request, notes = build_query_from_sketch(
                plan_or_emit,
                vectors=vectors,
                collection=collection,
                vector_names=vector_names,
            )
        else:
            raise ExecutionError(
                f"execute expects PhysicalPlan or VendorRequestSketch, got {kind!r}"
            )

        path = f"/collections/{quote(str(coll), safe='')}/points/query"
        t0 = time.perf_counter()
        _status, payload = self._request("POST", path, request)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        hits = parse_hits(payload)
        qtime = payload.get("time")
        return {
            "schemaVersion": "0.1.0-draft-execute",
            "kind": "ExecuteResult",
            "vendor": "qdrant",
            "executed": True,
            "collection": coll,
            "hits": hits,
            "timingMs": elapsed_ms,
            "request": request,
            "notes": notes,
            "meta": {
                "url": self.url,
                "endpoint": f"POST {path}",
                "qdrantTime": qtime,
                "status": payload.get("status"),
            },
        }
