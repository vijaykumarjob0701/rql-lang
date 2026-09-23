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

`emit` returns **docs-shaped sketches** (`notExecuted: true`). It does **not** talk to live Qdrant / Elasticsearch / pgvector. The adapter interface is ready for live backends (see `docs/ROADMAP.md`).

## Layout

```
rql-lang/
  schemas/       shared JSON Schema (logical + physical 0.1.0-draft)
  examples/      shared .rql toys
  python/        package name: rql
  javascript/    package name: @vijaykumarjob0701/rql
  web/           RQL Studio (Vite + React) — browse Qdrant, write/execute RQL
  docs/          API.md, ROADMAP.md
```

## RQL Studio

Local developer console: connect to Qdrant, browse collections, run recipe-bound RQL (explain / emit / execute), and manage points/indexes via the Qdrant admin API. Live retrieve execute is a thin Studio proxy (library `execute()` is not on `main` yet).

```bash
# Docker only — no host Node. Studio at http://localhost:8080
docker compose -f web/docker-compose.yml up --build
# (or: docker compose up --build from the repo root)

# Host Vite against compose Qdrant:
cd web && npm install && npm run compose && npm run seed && npm run dev
```

Connect the UI to `http://localhost:6333`. Full walkthrough: [`web/README.md`](web/README.md).

## Install locally

### Python

```bash
pip install -e "./python[dev]"
python -m pytest python/tests -q
```

```python
from rql import parse, compile, explain, emit
logical = parse(open("examples/01-hybrid-rrf.rql").read())
physical = compile(logical, profile="qdrant")
print(explain(physical))
print(emit(physical, backend="qdrant")["notExecuted"])  # True
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
- Emit is **sketch-only** until live adapters land.
- Do not publish to PyPI/npm from this tree yet; repo is intended to stay **private** until release.

## License

MIT — see [`LICENSE`](LICENSE).
