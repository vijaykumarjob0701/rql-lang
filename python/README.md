# rql (Python)

Retrieval Query Language library — **v0.1.0**.

Parse RQL text → LogicalPlan → compile to PhysicalPlan (capability profiles) → explain / emit vendor **sketches**.

## Install (local / editable)

From the monorepo root:

```bash
pip install -e "./python[dev]"
```

Or:

```bash
cd python && pip install -e ".[dev]"
```

**Not published to PyPI yet.**

## Quick start

```python
from rql import parse, compile, explain, emit

logical = parse("""
RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 VECTOR_REF $q_dense
  WHERE tenant_id = 'acme'
  ACL_HARD;
""")

physical = compile(logical, profile="qdrant")
print(explain(physical))
sketch = emit(physical, backend="qdrant")
assert sketch["notExecuted"] is True
assert sketch["approximate"] is True
```

## Honesty

- **`emit` returns sketches** (docs-shaped JSON/SQL). It does **not** open sockets or run queries against Qdrant / Elasticsearch / pgvector.
- Live adapters are on the roadmap (`docs/ROADMAP.md`). The `Adapter` protocol is ready for plugins.
- Profiles are docs-derived capability flags, not live probes.

## Profiles

Bundled: `qdrant`, `elasticsearch`, `pgvector` under `src/rql/profiles/`.

## Related

- Research: https://github.com/vijaykumarjob0701/rql-rag-query-language
- Offline repro: https://github.com/vijaykumarjob0701/rql-repro
- This monorepo package is intended for a **private** `rql-lang` GitHub repo.
