# @vijaykumarjob0701/rql (JavaScript / TypeScript)

Retrieval Query Language library — **v0.1.0**.

Same public API surface as the Python package: `parse` → `compile` → `explain` / `emit`.

## Install (local)

From the monorepo:

```bash
cd javascript
npm install
npm run build
npm test
```

**Not published to npm yet.** Package is marked `"private": true`.

## Quick start

```ts
import { parse, compile, explain, emit } from "@vijaykumarjob0701/rql";

const logical = parse(`
RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 VECTOR_REF $q_dense
  WHERE tenant_id = 'acme'
  ACL_HARD;
`);

const physical = compile(logical, { profile: "qdrant" });
console.log(explain(physical));
const sketch = emit(physical, { backend: "qdrant" });
// sketch.notExecuted === true — docs-shaped only until live adapters
```

## Honesty

- **`emit` returns sketches** only. No live DB execution in v0.1.
- Profiles are docs-derived capability flags.

## Related

- Research: https://github.com/vijaykumarjob0701/rql-rag-query-language
- Offline repro: https://github.com/vijaykumarjob0701/rql-repro
