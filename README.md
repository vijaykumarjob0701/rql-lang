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
  docs/          API.md, ROADMAP.md
```

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
- Emit is **sketch-only** on this tree (`notExecuted: true`). It does not talk to live Qdrant / Elasticsearch / pgvector.
- Do not publish to PyPI/npm from this tree yet.

## Citation / Zenodo

This GitHub repository is intended to stay **private**. A Zenodo software snapshot of the same v0.1.0 tree may still be **public**; that does not change GitHub visibility and is not a PyPI/npm release.

Cite from [`CITATION.cff`](CITATION.cff). Deposit metadata lives in [`.zenodo.json`](.zenodo.json). Public companions: [research package](https://github.com/vijaykumarjob0701/rql-rag-query-language) and [rql-repro](https://github.com/vijaykumarjob0701/rql-repro).

## License

MIT — see [`LICENSE`](LICENSE).
