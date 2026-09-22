# @vijaykumarjob0701/rql (JavaScript / TypeScript)

Retrieval Query Language library — **v0.1.0**.

Same public API surface as the Python package: `parse` → `compile` → `explain` / `emit` / `execute` (Qdrant).

## Install (local)

From the monorepo:

```bash
cd javascript
npm install
npm run build
npm test
```

**Not published to npm yet.** Package is marked `"private": true`.

## CLI (one-shot)

After `npm run build`, `package.json` exposes a `rql` bin:

```bash
node dist/cli.js --help
node dist/cli.js -c "RETRIEVE chunks SEARCH DENSE ON embedding CANDIDATES 5 VECTOR_REF \$q_dense;"
node dist/cli.js ../examples/02-filtered-dense.rql
```

Interactive REPL is **Python-first** (`python -m rql`). This bin is `-c` / file / `--json` / `--emit` / `--execute` only.

## Quick start

```ts
import { parse, compile, explain, emit, execute } from "@vijaykumarjob0701/rql";

const logical = parse(`
RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 VECTOR_REF $q_dense
  WHERE tenant_id = 'acme'
  ACL_HARD;
`);

const physical = compile(logical, { profile: "qdrant" });
console.log(explain(physical));
const sketch = emit(physical, { backend: "qdrant" });
// sketch.notExecuted === true — docs-shaped; execute() is the opt-in live path
// await execute(physical, { backend: "qdrant", vectors: { dense: [0.1, 0.2] } });
```

## Honesty

- **`emit` returns sketches** only.
- **`execute`** is opt-in live Qdrant (`QDRANT_URL` / `QDRANT_API_KEY`). Elasticsearch and pgvector stay sketches.
- Profiles are docs-derived capability flags.

## Related

- Research: https://github.com/vijaykumarjob0701/rql-rag-query-language
- Offline repro: https://github.com/vijaykumarjob0701/rql-repro
