# RQL cross-language API (v0.1)

Same surface in **Python** (`rql`) and **TypeScript/JavaScript** (`@vijaykumarjob0701/rql`).

## Types

| Name | Shape |
|------|--------|
| `LogicalPlan` | `{ schemaVersion: "0.1.0-draft", kind: "LogicalPlan", meta?, root }` |
| `PhysicalPlan` | `{ schemaVersion: "0.1.0-draft", kind: "PhysicalPlan", meta, capabilitiesUsed, budgets?, root }` |
| `EmitResult` | `{ kind: "VendorRequestSketch", vendor, format, approximate: true, notExecuted: true, body, notes, … }` |

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

Returns a **sketch** (`approximate: true`, `notExecuted: true`). No sockets / live DB calls in v0.1.

Pluggable `Adapter` / `register_adapter` / `registerAdapter` is ready for future live backends.

## Profiles

Docs-derived capability flags (not live probes), bundled as JSON:

- `qdrant` — native RRF / weighted fusion / multi-vector late
- `elasticsearch` — native RRF / knn.filter PRE-like
- `pgvector` — POST/ITERATIVE filters; client RRF shim

## Honesty

Do **not** claim that `emit` runs queries against a vector database. Live adapters are roadmap work.
