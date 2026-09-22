"""Public ``execute`` entry — opt-in live adapters (Qdrant first)."""
from __future__ import annotations

from typing import Any

from .emit import AdapterError, _ADAPTERS, resolve_vendor
from .qdrant import ExecutionError, QdrantAdapter, QdrantTransport


def execute(
    plan_or_emit: dict[str, Any],
    *,
    backend: str | None = None,
    url: str | None = None,
    api_key: str | None = None,
    vectors: dict[str, Any] | None = None,
    collection: str | None = None,
    vector_names: dict[str, str] | None = None,
    timeout: float = 10.0,
    transport: QdrantTransport | None = None,
) -> dict[str, Any]:
    """Execute a PhysicalPlan or EmitResult against a live backend.

    v0.1 ships a Qdrant Query API adapter only. ``emit`` is unchanged
    (sketches, ``notExecuted: true``).

    Parameters
    ----------
    plan_or_emit:
        ``PhysicalPlan`` from ``compile``, or a Qdrant ``VendorRequestSketch``.
    backend:
        Live vendor (``qdrant``). Inferred from plan meta when omitted.
    url:
        Qdrant base URL. Defaults to ``QDRANT_URL`` or ``http://localhost:6333``.
    api_key:
        Optional Qdrant API key (``QDRANT_API_KEY``).
    vectors:
        Bindings for placeholders, e.g. ``{"dense": [...], "sparse": {"indices", "values"}}``.
        ``$q_dense`` is accepted as an alias for ``dense``.
    collection:
        Override collection name from the plan / sketch.
    transport:
        Injectable HTTP (method, url, headers, body, timeout) → (status, json).
    """
    vendor = backend
    if not vendor:
        if plan_or_emit.get("kind") == "VendorRequestSketch":
            vendor = str(plan_or_emit.get("vendor") or "")
        elif plan_or_emit.get("kind") == "PhysicalPlan":
            vendor = resolve_vendor(plan_or_emit, None)
        else:
            raise AdapterError(
                "execute expects PhysicalPlan or VendorRequestSketch; "
                f"got kind={plan_or_emit.get('kind')!r}"
            )
    vendor = vendor.strip().lower()

    registered = _ADAPTERS.get(vendor)
    exec_fn = getattr(registered, "execute", None) if registered is not None else None
    if callable(exec_fn):
        return exec_fn(
            plan_or_emit,
            url=url,
            api_key=api_key,
            vectors=vectors,
            collection=collection,
            vector_names=vector_names,
            timeout=timeout,
            transport=transport,
        )

    if vendor != "qdrant":
        raise AdapterError(
            f"no live execute adapter for {vendor!r}; "
            "v0.1 ships Qdrant only (emit sketches remain available for all vendors)"
        )

    adapter = QdrantAdapter(url=url, api_key=api_key, transport=transport, timeout=timeout)
    return adapter.execute(
        plan_or_emit,
        vectors=vectors,
        collection=collection,
        vector_names=vector_names,
    )


__all__ = ["execute", "ExecutionError", "QdrantAdapter"]
