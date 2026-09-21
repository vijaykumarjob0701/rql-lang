# rql-lang

**Private** monorepo for the shipable **RQL** (Retrieval Query Language) library — Python and JavaScript/TypeScript.

**Date:** 2026-09-19 (Europe/Dublin) · **Version:** 0.1.0

| Related | URL |
|---------|-----|
| Research / thesis / journal | https://github.com/vijaykumarjob0701/rql-rag-query-language |
| Offline repro / experiments | https://github.com/vijaykumarjob0701/rql-repro |
| This library (intended private GitHub name) | `rql-lang` |

## What this is

A **v0.1 importable library**: parse RQL → LogicalPlan → compile to PhysicalPlan (vendor capability profiles) → explain / emit.

`emit` returns **docs-shaped sketches** (`notExecuted: true`) and does **not** talk to a database.

`execute` is an **opt-in** live path for Qdrant (`backend="qdrant"`). It POSTs Query API requests (`/collections/{name}/points/query`) using `QDRANT_URL` (default `http://localhost:6333`) and optional `QDRANT_API_KEY`. Elasticsearch and pgvector remain sketch-only. See `docs/API.md` and `examples/qdrant_live_execute.py`.

## Layout

```
rql-lang/
  schemas/       shared JSON Schema (logical + physical 0.1.0-draft)
  examples/      shared .rql toys
  python/        package name: rql
  javascript/    package name: @vijaykumarjob0701/rql
  docs/          API.md, ROADMAP.md
```

## Install locally

### Python

```bash
pip install -e "./python[dev]"
python -m pytest python/tests -q
```

```python
from rql import parse, compile, explain, emit, execute
logical = parse(open("examples/01-hybrid-rrf.rql").read())
physical = compile(logical, profile="qdrant")
print(explain(physical))
print(emit(physical, backend="qdrant")["notExecuted"])  # True — sketch
# Opt-in live (needs Qdrant + real vectors):
# execute(physical, backend="qdrant", vectors={"dense": [...], "sparse": {"indices": [...], "values": [...]}})
```

### JavaScript / TypeScript

```bash
cd javascript && npm install && npm test
```

```ts
import { parse, compile, explain, emit } from "@vijaykumarjob0701/rql";
```

## Honesty

- Profiles are **docs-derived** capability flags, not live probes.
- `emit` is **sketch-only**. `execute` is opt-in Qdrant only; CI uses mocked HTTP.
- Do not publish to PyPI/npm from this tree yet; repo is intended to stay **private** until release.

## License

MIT — see [`LICENSE`](LICENSE).
