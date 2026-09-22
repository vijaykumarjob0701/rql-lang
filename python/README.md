# rql (Python)

Retrieval Query Language library — **v0.1.0**.

Parse RQL text → LogicalPlan → compile to PhysicalPlan (capability profiles) → explain / emit vendor **sketches** / opt-in Qdrant `execute`.

## Install (local / editable)

From the monorepo root:

```bash
pip install -e "./python[dev]"
```

Or:

```bash
cd python && pip install -e ".[dev]"
```

**Not published to PyPI yet.** The install registers a `rql` console script.

## CLI

```bash
rql --help
python -m rql                    # REPL
rql -c "RETRIEVE chunks SEARCH DENSE ON embedding CANDIDATES 5 VECTOR_REF \$q_dense;"
rql ../examples/02-filtered-dense.rql
rql --emit --json ../examples/01-hybrid-rrf.rql
```

REPL meta-commands: `\help`, `\d`, `\profile`, `\backend`, `\connect`, `\emit`, `\execute`, `\vectors`, `\q`. Same pipeline as the library. `--execute` requires `--vector` / `--vectors-file`.

## Quick start

```python
from rql import parse, compile, explain, emit, execute

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
# execute(physical, backend="qdrant", vectors={"dense": [0.1, 0.2, ...]})
```

## Honesty

- **`emit` returns sketches** (docs-shaped JSON/SQL). It does **not** open sockets.
- **`execute`** is opt-in live Qdrant (`QDRANT_URL`, optional `QDRANT_API_KEY`). Other vendors stay sketch-only.
- Profiles are docs-derived capability flags, not live probes.

## Profiles

Bundled: `qdrant`, `elasticsearch`, `pgvector` under `src/rql/profiles/`.

## Related

- Research: https://github.com/vijaykumarjob0701/rql-rag-query-language
- Offline repro: https://github.com/vijaykumarjob0701/rql-repro
- This monorepo package is intended for a **private** `rql-lang` GitHub repo.
