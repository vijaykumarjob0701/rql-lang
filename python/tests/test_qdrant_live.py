"""Optional live Qdrant smoke. Skipped unless QDRANT_URL is set.

Start a local server first:

    docker run --rm -p 6333:6333 qdrant/qdrant
    export QDRANT_URL=http://localhost:6333
    pytest python/tests/test_qdrant_live.py -q
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from rql import compile, execute, parse_file
from rql.qdrant import QdrantAdapter

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"
COLLECTION = "rql_live_smoke"
DENSE_A = [1.0, 0.0, 0.0, 0.0]
DENSE_B = [0.0, 1.0, 0.0, 0.0]
QUERY = [0.95, 0.05, 0.0, 0.0]
SPARSE_A = {"indices": [1, 2], "values": [1.0, 0.4]}
SPARSE_B = {"indices": [8], "values": [1.0]}
SPARSE_Q = {"indices": [1, 2], "values": [0.8, 0.3]}

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not os.environ.get("QDRANT_URL"),
        reason="QDRANT_URL not set; live Qdrant smoke is opt-in",
    ),
]


def _seed(adapter: QdrantAdapter) -> None:
    adapter.admin_delete(f"/collections/{COLLECTION}")
    adapter.admin_put(
        f"/collections/{COLLECTION}",
        {
            "vectors": {"dense": {"size": 4, "distance": "Cosine"}},
            "sparse_vectors": {"bm25_sparse": {}},
        },
    )
    adapter.admin_put(
        f"/collections/{COLLECTION}/points?wait=true",
        {
            "points": [
                {
                    "id": 1,
                    "vector": {"dense": DENSE_A, "bm25_sparse": SPARSE_A},
                    "payload": {"tenant_id": "acme", "clearance": 5},
                },
                {
                    "id": 2,
                    "vector": {"dense": DENSE_B, "bm25_sparse": SPARSE_B},
                    "payload": {"tenant_id": "other", "clearance": 5},
                },
            ]
        },
    )


def test_live_filtered_dense_and_rrf():
    adapter = QdrantAdapter()
    _seed(adapter)
    filtered = compile(parse_file(EXAMPLES / "02-filtered-dense.rql"), profile="qdrant")
    dense = execute(
        filtered,
        backend="qdrant",
        collection=COLLECTION,
        vectors={"dense": QUERY},
    )
    assert dense["executed"] is True
    assert dense["hits"]
    assert all(h["payload"]["tenant_id"] == "acme" for h in dense["hits"])

    rrf = execute(
        compile(parse_file(EXAMPLES / "01-hybrid-rrf.rql"), profile="qdrant"),
        backend="qdrant",
        collection=COLLECTION,
        vectors={"dense": QUERY, "sparse": SPARSE_Q},
    )
    assert rrf["executed"] is True
    assert rrf["request"]["query"]["fusion"] == "rrf"
    assert rrf["hits"]
