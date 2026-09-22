# RQL cross-language API (v0.1)

Same surface in **Python** (`rql`) and **TypeScript/JavaScript** (`@vijaykumarjob0701/rql`).

## Types

| Name | Shape |
|------|--------|
| `LogicalPlan` | `{ schemaVersion: "0.1.0-draft", kind: "LogicalPlan", meta?, root }` |
| `PhysicalPlan` | `{ schemaVersion: "0.1.0-draft", kind: "PhysicalPlan", meta, capabilitiesUsed, budgets?, root }` |
| `EmitResult` | `{ kind: "VendorRequestSketch", vendor, format, approximate: true, notExecuted: true, body, notes, … }` |
| `ExecuteResult` | `{ kind: "ExecuteResult", vendor, executed: true, collection, hits: [{id, score, payload}], timingMs, request, notes, meta }` |

Plan IR is defined by JSON Schema drafts under `schemas/` (`logical-plan`, `physical-plan`).

## Functions

### `parse(rqlText) → LogicalPlan`

Parse the v0.1 RQL subset (`RETRIEVE` / `SEARCH` / `WHERE` / `ACL_HARD` / `FUSE` / `LIMIT`).

Raises / throws `ParseError` on unsupported keywords (e.g. `EMBED`, `RERANK`) or syntax errors.

### `compile(logical, options) → PhysicalPlan`

- **Python:** `compile(logical, *, profile="qdrant")`
- **JS/TS:** `compile(logical, { profile: "qdrant" })`

`profile` is a bundled id (`qdrant` | `elasticsearch` | `pgvector`), a path, or a profile object.

Optional: `late_rewrite` / `lateRewrite` (`colbert` | `plaid` | `muvera`).

### `explain(physical, …) → string | object`

- **Python:** `explain(physical)` or `explain(physical, format="object")`
- **JS/TS:** `explain(physical)` or `explain(physical, { format: "object" })`

Tree walk of physical ops; does not execute.

### `emit(physical, options) → EmitResult`

- **Python:** `emit(physical, backend="qdrant")`
- **JS/TS:** `emit(physical, { backend: "qdrant" })`

Returns a **sketch** (`approximate: true`, `notExecuted: true`). This is still the default path and **does not** open sockets.

Pluggable `Adapter` / `register_adapter` / `registerAdapter` remains the hook for custom backends. Built-in vendors stay sketch adapters unless you call `execute`.

### `execute(plan_or_emit, options) → ExecuteResult`

Opt-in live run. v0.1 implements **Qdrant only**.

- **Python:** `execute(plan, *, backend="qdrant", url=None, api_key=None, vectors=None, collection=None, transport=None)`
- **JS/TS:** `await execute(plan, { backend: "qdrant", url, apiKey, vectors, collection, transport })`

`plan_or_emit` is a `PhysicalPlan` from `compile` or a Qdrant `VendorRequestSketch` from `emit`.

| Option | Default | Notes |
|--------|---------|--------|
| `backend` | inferred from plan/sketch | Must be `qdrant` unless you registered a live adapter |
| `url` | `QDRANT_URL` or `http://localhost:6333` | Base URL, no trailing slash required |
| `api_key` / `apiKey` | `QDRANT_API_KEY` | Sent as Qdrant `api-key` header |
| `vectors` | required for search | `{ dense: number[], sparse?: { indices, values } }`. `$q_dense` is an alias for `dense` |
| `collection` | from plan / sketch | Overrides `RETRIEVE` / emit `collection` |
| `transport` | stdlib `urllib` / `fetch` | Inject for tests (no live server) |

`ExecuteResult.hits` come from Qdrant `result.points`. `request` is the JSON body that was POSTed to `/collections/{collection}/points/query`. `timingMs` is client wall-clock; `meta.qdrantTime` is Qdrant's own `time` field when present.

**Representable today**

- Dense `AnnExec` with `FilterExec` **PRE** (AND-connected `=`, ranges) → Query API `query` + `filter.must`
- Native `FusionExec` **RRF** → `prefetch` (dense + sparse named vectors) + `query: { fusion: "rrf" }`

**Fail-closed (`ExecutionError`)**

- `LateInteractExec` / ColBERT multivector sketches (will not silently substitute dense cosine)
- Linear / other fusion families
- Unparsed filter residue (no `_unparsed` stub is sent)
- Missing vector bindings
- HTTP / transport failures
- `backend` other than `qdrant` (unless `register_adapter` provided `execute`)

`QdrantAdapter` is exported if you want to construct one (`url`, `api_key` / `apiKey`, `transport`) or `register_adapter` / `registerAdapter` it. Registering it does **not** change `emit` (its `emit` still returns sketches).

See `examples/qdrant_live_execute.py` and `examples/qdrant_live_execute.mjs`. Live CI is not required: unit tests mock HTTP. Optional smoke (`python/tests/test_qdrant_live.py`, `javascript/tests/qdrant.live.test.ts`) runs only when `QDRANT_URL` is set.

## CLI

Python is the first-class terminal (psql / sqlite3 style). After `pip install -e ./python`:

```bash
rql --help
python -m rql                     # REPL: prompt rql>
rql -c "RETRIEVE chunks SEARCH DENSE ON embedding CANDIDATES 5 VECTOR_REF \$q_dense;"
rql examples/02-filtered-dense.rql
rql --json examples/01-hybrid-rrf.rql
rql --emit examples/01-hybrid-rrf.rql
# live Qdrant only when asked; vectors are never invented:
rql --execute --vector '{"dense":[0.1,0.2,0.3,0.4]}' examples/02-filtered-dense.rql
```

Default one-shot / REPL mode is **explain** (pretty text). `--json` prints a machine-readable object with `logical`, `physical`, `explain`, and optionally `emit` / `execute`.

| Flag / meta | Role |
|-------------|------|
| `-c` / file | One-shot (like `psql -c` / `sqlite3 file.sql`) |
| no args | Interactive `rql>` — multi-line until `;` or a blank line |
| `\q` `\quit` `\exit` | Leave the REPL |
| `\help` `\h` `\?` `\d` | Help (`\d` also prints session status) |
| `\profile qdrant` | Capability profile |
| `\backend qdrant` | emit/execute vendor |
| `\connect URL` | Qdrant URL (`QDRANT_URL` otherwise) |
| `\explain [on\|off]` | Bare = explain mode; on/off = also print explain before emit/execute |
| `\emit` / `\execute` | Mode toggle. execute needs `\vectors` / `--vector` |
| `\vectors JSON\|PATH` | Bind dense/sparse vectors (no embed step) |
| `--execute` | Opt-in live Qdrant only |

A leading `EXPLAIN …` is handled by the CLI (the parser still rejects `EXPLAIN` as an RQL keyword) and forces explain output.

**JavaScript** ships a thin one-shot bin (`npx --prefix javascript rql`, or `node javascript/dist/cli.js` after `npm run build`): `-c`, file, `--json`, `--emit`, `--execute`. No REPL — use `python -m rql`.

## Profiles

Docs-derived capability flags (not live probes), bundled as JSON:

- `qdrant` — native RRF / weighted fusion / multi-vector late
- `elasticsearch` — native RRF / knn.filter PRE-like
- `pgvector` — POST/ITERATIVE filters; client RRF shim

## Honesty

Do **not** claim that `emit` runs queries against a vector database. `execute` is the opt-in live path and is proven in-repo with **mocked HTTP** plus an optional live smoke when `QDRANT_URL` is set. That is not a claim that every Qdrant collection, named-vector layout, or server version is supported.
