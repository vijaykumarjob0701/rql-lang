#!/usr/bin/env python3
"""Opt-in live Qdrant execute demo (parse → compile → emit sketch → execute).

Requires a running Qdrant and query vectors you already computed.
This script does **not** embed text.

    docker run --rm -p 6333:6333 qdrant/qdrant
    export QDRANT_URL=http://localhost:6333
    # optional: QDRANT_API_KEY
    python examples/qdrant_live_execute.py

Without Qdrant the execute call fails with ExecutionError (honest).
Pass --seed to create `rql_demo` and upsert two toy points first.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python" / "src"))

from rql import compile, emit, execute, parse  # noqa: E402
from rql.qdrant import ExecutionError, QdrantAdapter  # noqa: E402

RQL = """
RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 QUERY 'ACL-safe filtered ANN' VECTOR_REF $q_dense
  WHERE tenant_id = 'acme' AND clearance >= 2
  ACL_HARD;
"""

DENSE = [0.95, 0.05, 0.0, 0.0]


def seed(adapter: QdrantAdapter, collection: str) -> None:
    adapter.admin_delete(f"/collections/{collection}")
    adapter.admin_put(
        f"/collections/{collection}",
        {"vectors": {"dense": {"size": 4, "distance": "Cosine"}}},
    )
    adapter.admin_put(
        f"/collections/{collection}/points?wait=true",
        {
            "points": [
                {
                    "id": 1,
                    "vector": {"dense": [1.0, 0.0, 0.0, 0.0]},
                    "payload": {"tenant_id": "acme", "clearance": 5},
                },
                {
                    "id": 2,
                    "vector": {"dense": [0.0, 1.0, 0.0, 0.0]},
                    "payload": {"tenant_id": "other", "clearance": 5},
                },
            ]
        },
    )
    print(f"seeded collection {collection!r}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--seed", action="store_true", help="upsert toy points into --collection")
    p.add_argument("--collection", default="rql_demo")
    args = p.parse_args()

    logical = parse(RQL)
    physical = compile(logical, profile="qdrant")
    sketch = emit(physical, backend="qdrant")
    print("emit.notExecuted =", sketch["notExecuted"])
    print("emit sketch query shape:", json.dumps(sketch["body"].get("query"), indent=2))

    if args.seed:
        seed(QdrantAdapter(), args.collection)

    try:
        result = execute(
            physical,
            backend="qdrant",
            collection=args.collection,
            vectors={"dense": DENSE},
        )
    except ExecutionError as exc:
        print("execute failed (expected if Qdrant is down or collection is empty):", exc)
        return 1
    print("executed =", result["executed"])
    print("hits =", json.dumps(result["hits"], indent=2))
    print("timingMs =", round(result["timingMs"], 2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
