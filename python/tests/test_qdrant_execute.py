"""Mocked HTTP tests for the opt-in Qdrant live adapter."""
from __future__ import annotations

from pathlib import Path

import pytest

from rql import (
    AdapterError,
    ExecutionError,
    compile,
    emit,
    execute,
    parse_file,
)

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"
DENSE = [0.1, 0.2, 0.3, 0.4]
SPARSE = {"indices": [1, 7], "values": [0.9, 0.2]}


class FakeTransport:
    def __init__(self, payload=None, status=200, error=None):
        self.payload = payload or {
            "result": {
                "points": [
                    {"id": 1, "score": 0.91, "payload": {"tenant_id": "acme"}},
                    {"id": 2, "score": 0.44, "payload": {"tenant_id": "acme"}},
                ]
            },
            "status": "ok",
            "time": 0.004,
        }
        self.status = status
        self.error = error
        self.calls: list[dict] = []

    def request(self, method, url, headers, body, timeout=None):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "body": body,
                "timeout": timeout,
            }
        )
        if self.error:
            raise self.error
        if self.status >= 400:
            raise ExecutionError(f"Qdrant HTTP {self.status}: boom")
        return self.status, self.payload


def _filtered_physical():
    return compile(parse_file(EXAMPLES / "02-filtered-dense.rql"), profile="qdrant")


def _rrf_physical():
    return compile(parse_file(EXAMPLES / "01-hybrid-rrf.rql"), profile="qdrant")


def _late_physical():
    return compile(parse_file(EXAMPLES / "03-late.rql"), profile="qdrant")


def test_emit_still_sketch_only():
    art = emit(_filtered_physical(), backend="qdrant")
    assert art["notExecuted"] is True
    assert art["kind"] == "VendorRequestSketch"


def test_execute_filtered_dense_pre_filter():
    transport = FakeTransport()
    result = execute(
        _filtered_physical(),
        backend="qdrant",
        url="http://qdrant.test:6333",
        api_key="secret-key",
        vectors={"dense": DENSE},
        transport=transport,
    )
    assert result["kind"] == "ExecuteResult"
    assert result["executed"] is True
    assert result["vendor"] == "qdrant"
    assert result["collection"] == "chunks"
    assert [h["id"] for h in result["hits"]] == [1, 2]
    assert result["hits"][0]["score"] == 0.91
    assert result["hits"][0]["payload"]["tenant_id"] == "acme"
    assert isinstance(result["timingMs"], float)

    assert len(transport.calls) == 1
    call = transport.calls[0]
    assert call["method"] == "POST"
    assert call["url"] == "http://qdrant.test:6333/collections/chunks/points/query"
    assert call["headers"]["api-key"] == "secret-key"
    body = call["body"]
    assert body["query"] == DENSE
    assert body["using"] == "dense"
    assert body["limit"] == 20
    assert body["with_payload"] is True
    must = body["filter"]["must"]
    assert {"key": "tenant_id", "match": {"value": "acme"}} in must
    assert {"key": "clearance", "range": {"gte": 2}} in must
    assert "filter" in result["request"]
    assert any("PRE" in n for n in result["notes"])


def test_execute_hybrid_rrf_prefetch():
    transport = FakeTransport()
    result = execute(
        _rrf_physical(),
        backend="qdrant",
        vectors={"dense": DENSE, "sparse": SPARSE},
        transport=transport,
    )
    assert result["executed"] is True
    body = transport.calls[0]["body"]
    assert body["query"] == {"fusion": "rrf"}
    assert len(body["prefetch"]) == 2
    dense_pref, sparse_pref = body["prefetch"]
    assert dense_pref["query"] == DENSE
    assert dense_pref["using"] == "dense"
    assert dense_pref["limit"] == 50
    assert sparse_pref["query"] == SPARSE
    assert sparse_pref["using"] == "bm25_sparse"
    assert result["request"]["query"]["fusion"] == "rrf"


def test_execute_accepts_emit_sketch():
    sketch = emit(_filtered_physical(), backend="qdrant")
    transport = FakeTransport()
    result = execute(
        sketch,
        backend="qdrant",
        vectors={"$q_dense": DENSE},
        transport=transport,
    )
    assert result["executed"] is True
    assert transport.calls[0]["body"]["query"] == DENSE
    assert transport.calls[0]["body"]["filter"]["must"]


def test_late_interact_fails_closed():
    with pytest.raises(ExecutionError, match="LateInteract|not representable|fail-closed"):
        execute(_late_physical(), backend="qdrant", vectors={"dense": DENSE}, transport=FakeTransport())


def test_http_error_is_honest():
    transport = FakeTransport(status=400)
    with pytest.raises(ExecutionError, match="HTTP 400"):
        execute(
            _filtered_physical(),
            backend="qdrant",
            vectors={"dense": DENSE},
            transport=transport,
        )


def test_missing_vector_binding():
    with pytest.raises(ExecutionError, match="vector"):
        execute(_filtered_physical(), backend="qdrant", transport=FakeTransport())


def test_unknown_backend_has_no_live_adapter():
    with pytest.raises(AdapterError, match="elasticsearch|live"):
        execute(_filtered_physical(), backend="elasticsearch", vectors={"dense": DENSE})


def test_linear_fusion_fails_closed():
    physical = compile(parse_file(EXAMPLES / "04-hybrid-linear.rql"), profile="qdrant")
    with pytest.raises(ExecutionError, match="not representable|linear|family"):
        execute(
            physical,
            backend="qdrant",
            vectors={"dense": DENSE, "sparse": SPARSE},
            transport=FakeTransport(),
        )
