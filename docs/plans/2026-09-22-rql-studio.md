---
title: RQL Studio
date: 2026-09-22
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: user-request
execution: code
---

# RQL Studio

## Goal Capsule

Ship a polished developer console — **RQL Studio** — inside this monorepo so a user can connect to Qdrant, browse collections, project a sample of vectors, and write/explain/emit/execute RQL without reimplementing the language.

**Authority:** user product request (2026-09-22). Independent PR targeting `main`. Do **not** pile onto `cursor/qdrant-live-adapter-c935` (draft; unmerged).

**Stop when:** `web/` runs locally from documented steps; connect + browse + explain/emit/execute work against reachable Qdrant (mocked in tests); visualizer shows a real 2D projection of a seeded sample; PR open with screenshots.

## Product Contract

### Actors

- A local developer exploring a Qdrant instance and drafting RQL. No SSO.

### Requirements

- **R1. Connect.** Form for Qdrant `url` + optional API key. Persist in `localStorage`. Never log the key. Default URL `http://127.0.0.1:6333`.
- **R2. Browse.** List collections with point counts and vector config. Sample payloads and inferred schema fields.
- **R3. Visualize.** 2D projection (in-browser PCA) of a scrolled sample. Hover id/payload. Optional color-by payload field.
- **R4. Write RQL.** Monaco editor, `.rql` highlighting, example snippets, ⌘/Ctrl-Enter execute. Actions: Explain, Emit, Execute.
- **R5. Reuse library.** UI/server call existing JS `parse` / `compile` / `explain` / `emit`. Do not reimplement the grammar.
- **R6. Execute.** Run against connected Qdrant via Studio's thin live path (library `execute` is not on `main`). User supplies dense vector JSON, upload, or a **clearly labeled demo-only** random vector. Fail closed for late/linear/unparsed filters.
- **R7. Results.** Hits table (id, score, payload), timing, request body, JSON toggle.
- **R8. Plan viz.** Tree of LogicalPlan / PhysicalPlan nodes.
- **R9. Honest states.** Empty/error copy; no silent fake embeddings presented as real.
- **R10. Docs + tests.** README how-to (`npm install && npm run dev`, docker Qdrant, seed). Unit/component smoke for editor → parse. Screenshots on the PR.

### Acceptance examples

- **AE1.** Paste `examples/02-filtered-dense.rql` (collection overridden to `studio_demo`), Explain shows FilterExec + AnnExec text; Emit shows Qdrant JSON sketch with `notExecuted: true`.
- **AE2.** Seeded `studio_demo` + demo vector + Execute returns scored hits with payloads; late example 03 fails closed with a visible error.
- **AE3.** Visualizer plots seeded clusters; hover shows id + topic; color-by `topic` changes point colors.
- **AE4.** Disconnect / bad URL shows an error, not a hang or empty crash. API key never appears in console logs.

### Out of scope

- Auth/SSO, multi-user, publishing the JS package, Elasticsearch/pgvector live execute, real text embeddings, piling execute into `javascript/` (conflicts with the open adapter PR).

## Planning Contract

### Key technical decisions

- **KTD1. App location `web/`.** Vite + React + TypeScript. Path dependency `"@vijaykumarjob0701/rql": "file:../javascript"` — no publish, no root npm workspaces (avoids fighting `javascript/package-lock.json`).
- **KTD2. Node proxy, not browser→Qdrant.** Local Qdrant and Qdrant Cloud typically lack usable CORS. A Vite middleware proxies `/api/qdrant/*` using `x-qdrant-url` + `x-qdrant-api-key` headers and never logs them. Same plugin serves `/api/rql/*` so `compile`/`explain`/`emit` can use the Node `fs`-backed planner.
- **KTD3. Client parse, server compile.** `javascript/src/parser.ts` has no Node builtins — the editor imports it for live diagnostics. `compile` / `explain` / `emit` run in the Vite plugin (built package). Studio-owned `execute` builds a Query API body from PhysicalPlan (same fail-closed contract as the unmerged adapter) and POSTs through the proxy.
- **KTD4. Independent execute.** Do not copy `javascript/src/execute.ts` into the library on this branch. When the adapter PR merges, Studio can switch the server import; until then Studio documents the gap honestly.
- **KTD5. In-browser PCA.** Center + covariance + power iteration for 2 components. No Python/UMAP service.
- **KTD6. Seed + mock.** `web/scripts/seed.mjs` against real Qdrant. Tests mock HTTP. A small in-process mock (optional `npm run mock-qdrant`) exists so the visualizer/execute path can be exercised without Docker.

### Assumptions

- Library `execute` is **not** on `main` (confirmed). Planner uses `node:fs` (confirmed).
- Named vector `dense` on the demo collection matches `using: "dense"`.
- Docker may be absent in CI/agent VMs; seed is documented, tests do not require a live server.

### Sequencing

U1 scaffold → U2 proxy/RQL/execute → U3 UI shells → U4 visualizer → U5 tests/docs/seed.

## Implementation Units

### U1. Scaffold `web/` Vite app and path dependency

- Add `web/package.json`, Vite/React/TS configs, `index.html`, Tailwind-free dark CSS, `.gitignore` entries.
- Dev script builds `javascript` then starts Vite.
- Files: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`

### U2. Proxy, RQL API, fail-closed execute

- Vite plugin: Qdrant proxy + `POST /api/rql/{parse,compile,explain,emit,execute}`.
- Pure helpers: filter parse, vector bind, `buildQueryFromPhysical`, hit parse.
- Files: `web/server/plugin.ts`, `web/server/execute.ts`, `web/src/lib/api.ts`, `web/src/lib/rqlParse.ts`
- Tests: `web/src/lib/rqlParse.test.ts`, `web/server/execute.test.ts`

### U3. Connection, browse, editor, results, plan tree

- Connection form + localStorage. Collection list + sample/schema. Monaco + snippets + shortcuts. Results table/JSON. Plan tree.
- Files: `web/src/components/*`, `web/src/lib/storage.ts`, `web/src/lib/snippets.ts`, `web/src/monaco-rql.ts`
- Tests: `web/src/lib/storage.test.ts`, `web/src/lib/rqlParse.test.ts` (editor → parse smoke)

### U4. Vector visualizer + seed

- Scroll sample with vectors, PCA, canvas scatter, color-by field.
- `web/scripts/seed.mjs` creates `studio_demo` (128-d cosine, named `dense`, ~90 clustered points, payload `topic` / `tenant_id` / `clearance`).
- Files: `web/src/lib/pca.ts`, `web/src/components/VectorPlot.tsx`, `web/scripts/seed.mjs`, `web/scripts/mock-qdrant.mjs`
- Tests: `web/src/lib/pca.test.ts`

### U5. README, root pointer, screenshots

- `web/README.md` + root README section. Honest proxy/execute notes.

## Verification Contract

- `cd javascript && npm test` still passes (library untouched).
- `cd web && npm test` — parse smoke, execute fail-closed, PCA, storage.
- Manual / browser: connect → list → visualize → explain/emit/execute against seed or mock.
- No API key in logs.

## Definition of Done

- U1–U5 landed on `cursor/rql-studio-0f90`.
- Documented `npm install && npm run dev` from `web/`.
- PR against `main` with screenshots; independent of the Qdrant adapter PR.
