# RQL Studio

Polished local console for browsing **Qdrant** or **Postgres/pgvector** and writing **RQL** on top of it — plus admin Data / Indexes / Health / SQL panels for an end-to-end demo.

```
parse → compile → explain / emit     (library: @vijaykumarjob0701/rql)
                 ↘ execute           (Studio server — library execute() is not on main yet)
writes / indexes / health            (Qdrant REST or sandboxed demo SQL — not RQL)
```

The UI does **not** reimplement the language. The editor calls the library parser in-browser. Explain / emit / compile run in the Vite process against the local `javascript` package (`file:../javascript`). Live execute builds a Qdrant Query API body **or** a parameterized `ORDER BY embedding <=> $1` SQL statement from the PhysicalPlan. Create / update / delete / indexes are labeled admin API (Qdrant REST or allowlisted Postgres examples). RQL still has no INSERT/UPDATE/DDL.

## Fastest local spin-up (Docker only)

No host Node required. From the **repo root** or `web/`:

```bash
docker compose -f web/docker-compose.yml up --build
# same stack from repo root:
# docker compose up --build
```

Then open **http://localhost:8080**. In the connection form use **`http://localhost:6333`** (or `http://127.0.0.1:6333`) and a blank API key. The browser talks to host-mapped Qdrant; the Studio container remaps that loopback URL to `http://qdrant:6333` on the compose network (`QDRANT_URL`).

| Service | Host port | Notes |
|---|---|---|
| **RQL Studio** | **8080** | Vite preview + API proxy (`STUDIO_PORT` changes the published host port) |
| Qdrant REST | 6333 | Persistent volume `rql_studio_qdrant` |
| Qdrant gRPC | 6334 | unused by Studio |

Reset the seeded collection / Qdrant disk:

```bash
docker compose -f web/docker-compose.yml down -v
```

Optional env (compose file): `QDRANT_API_KEY`, `QDRANT_INTERNAL_URL` (default `http://qdrant:6333`), `STUDIO_PORT` (host port, default `8080`).

## pgvector demo

Postgres + the `vector` extension coexist with Qdrant. Either command:

```bash
# dedicated dual-stack file (Qdrant + Postgres + both seeds + Studio)
docker compose -f web/docker-compose.pgvector.yml up --build

# same extras as a profile on the Qdrant compose file
docker compose -f web/docker-compose.yml --profile pgvector up --build
```

Open **http://localhost:8080**. In **Connection** pick **pgvector** and use:

```
postgres://rql:rql@127.0.0.1:5432/rql_studio
```

The browser still talks to host-mapped `:5432`; the Studio container remaps loopback to `postgres://rql:rql@postgres:5432/rql_studio` (`DATABASE_URL`). Qdrant stays on `:6333` — switch the backend toggle to use it.

| Service | Host port | Notes |
|---|---|---|
| RQL Studio | 8080 | same UI; `/api/pg` is the sandboxed demo SQL API |
| Postgres + pgvector | 5432 | user/password/db `rql` / `rql` / `rql_studio` |
| Qdrant REST | 6333 | unchanged |

`seed-pg` applies `web/sql/schema.sql` and inserts the same stored demo centroids as the Qdrant seed (not a model).

### Tables (≥5)

| Table | Role |
|---|---|
| `tenants` | ACL-ish tenant rows (`acme`, `globex`, `initech`) |
| `projects` | logical groupings (one per topic) |
| `documents` | source-doc metadata |
| `chunks` | text + `embedding vector(128)` + HNSW |
| `query_logs` | recipe / execute history |
| `embedding_jobs` | seed job rows (`demo-centroid-v0`) |

Indexes: HNSW `idx_chunks_embedding_hnsw` on `chunks.embedding`, plus B-trees on `tenant_id`, `document_id`, `project_id`, `topic`.

### Example queries (copy-paste)

These are **Postgres SQL**, not RQL. Studio’s **SQL** tab runs them only by id against the demo database.

**UPDATE** a row / embedding:

```sql
UPDATE chunks
SET content = 'Demo-updated chunk — stored centroid, not a model re-embed.',
    embedding = $1::vector
WHERE id = 'chunk-demo-editable'
RETURNING id, document_id, left(content, 72) AS content;
```

**CREATE INDEX** / list indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

**DELETE**:

```sql
DELETE FROM query_logs
WHERE id = (SELECT max(id) FROM query_logs)
RETURNING id, recipe_id, created_at;
```

**Run a similarity query** (same shape `emit` sketches):

```sql
SELECT c.id, c.topic, c.tenant_id, c.clearance, d.title,
       c.embedding <=> $1::vector AS dist
FROM chunks c
JOIN documents d ON d.id = c.document_id
WHERE c.tenant_id = 'acme' AND c.clearance >= 2
ORDER BY c.embedding <=> $1::vector
LIMIT 8;
```

**Running queries**:

```sql
SELECT pid, usename, state, wait_event_type, left(query, 160) AS query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY pid;
```

`$1` in UPDATE/similarity is a stored demo vector (Recipes auto-bind one). Studio will not invent an embedding of the QUERY text.

### RQL `emit` profile `pgvector`

Explain / Emit with backend **pgvector** calls `emit(physical, { profile: "pgvector" })`. That is still a **SQL sketch** (`notExecuted: true`): `ORDER BY embedding <=> :q_embedding`, plus comments for ITERATIVE scans and ShimCast client RRF. It does **not** open a socket.

Studio **Execute** on this backend is a separate, fail-closed path: dense ANN + simple `AND` filters become a parameterized `SELECT` on `chunks`. Late / linear / hybrid BM25+RRF are refused (the profile sets `rrfNative: false`; this demo has no `tsv` column).

Host Vite against a running Postgres:

```bash
npm run compose:pg        # or start Postgres yourself
# in another terminal, if you only started the DB:
npm run seed:pg
npm run dev
```

## Full demo walkthrough

### 1. Start a vector DB (host Node)

Prefer real Qdrant when Docker is available (from this directory). This path starts **Qdrant only** so `npm run dev` can bind :5173:

```bash
npm install
npm run compose          # docker compose up -d qdrant
npm run seed             # or: npm run seed:demo
npm run dev
```

One-shot Qdrant + seed, then host Vite:

```bash
npm install
npm run demo             # compose qdrant + wait + seed
npm run dev
```

**No Docker?** Keep the in-memory mock (not Qdrant; implements scroll, upsert, delete, indexes, health, dense query, and toy RRF):

```bash
npm run mock-qdrant      # terminal 1 — http://127.0.0.1:6333
npm run seed             # terminal 2
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Connect with URL `http://127.0.0.1:6333` (blank API key).

### 2. What seed creates

Collection `studio_demo`:

- 120 points, 5 topics (`research`, `support`, `legal`, `product`, `ops`)
- Tenants `acme` / `globex` / `initech`, clearance 1–5, plus `title`, `lang`, `source`, `year`
- Named dense vector `dense` (128-d cosine) and sparse `bm25_sparse` (toy token ids — **not** a real BM25 analyzer)
- Payload indexes: `tenant_id`, `topic`, `clearance`, `lang`, `source`
- Stored demo query vectors written to `src/lib/demo-query-vectors.json` (labeled as such)

### 3. Try recipes (first-click Execute)

Sidebar **Recipes** load RQL **and** matching stored demo vectors. You do not need the Demo random vector button for these.

1. **Filtered dense + ACL** — already selected on first load. Click **Execute**. Hits should be `tenant_id=acme` and `clearance >= 2`.
2. **Dense only** — unfiltered support centroid.
3. **Globex tenant filter** — ACL-style tenant swap.
4. **Product topic** — payload `topic = 'product'`.
5. **Hybrid RRF** — binds a stored sparse `{indices,values}`. Works on real Qdrant and on mock-qdrant’s toy RRF.
6. **Late / ColBERT** and **Linear fusion** — Explain/Emit work; Execute **fail-closes** (no silent dense substitute).

Yellow notes say the query vector is a **stored demo vector**, not an embedding of the QUERY text.

### 4. Inspect, write, index, re-query

1. **Schema** / **Visualize** — payload sketch, vector config, PCA color-by `topic`.
2. **Data** (admin API) — scroll the sample, **Edit** a row, change title, **Upsert**. Or **JSON panel**. **Delete id** removes a point. Refresh scroll.
3. **Indexes** (admin API) — list seed indexes; create `year` as `integer`; delete it if you want.
4. **Health** — `/`, `/readyz`, `/livez`, `/cluster`, plus the selected collection’s counts/config.
5. Go back to **Query**, run **Filtered dense + ACL** again — if you upserted an `acme` point with clearance ≥ 2 it can appear in hits.

Writes are **not** RQL `INSERT`. v0.1 RQL is retrieve-only; the Data panel is honest Qdrant REST.

## Keyboard

| Shortcut | Action |
|---|---|
| `⌘/Ctrl-Enter` | Execute against the connected instance |
| `⌘/Ctrl-Shift-E` | Explain (logical + physical text) |
| `⌘/Ctrl-Shift-M` | Emit vendor sketch JSON |

## Query vectors

Execute still needs a dense vector. Studio will not invent an embedding of the `QUERY` text.

- **Recipes** auto-fill stored demo query vectors (labeled)
- Paste a JSON number array / upload `.json`
- **Demo random vector** — extra demo-only path; scores are **not** semantic retrieval

## Fail-closed execute

Representable: dense ANN + simple `AND` filters; hybrid RRF when a sparse binding is present (recipes ship one).

Rejected on screen:

- `SEARCH LATE` / ColBERT
- `FUSE LINEAR`
- Hybrid RRF **without** a sparse `{ indices, values }` binding
- Filter expressions the adapter cannot parse (`OR`, functions, …)

`emit` always returns a `VendorRequestSketch` with `notExecuted: true`.

When [the live adapter PR](https://github.com/vijaykumarjob0701/rql-lang/pull/1) lands, the retrieve path can switch to library `execute()` without a UI rewrite.

## Qdrant Cloud

Paste the cluster URL + API key. Traffic is `browser → Vite /api/qdrant → your URL`. The key is stored in `localStorage` (`rql-studio.connection`) and forwarded as `api-key`. **It is never logged.**

## Screenshots

Captured against the seeded mock (`npm run mock-qdrant && npm run seed`).

**Execute** — filtered dense + demo vector, hits table, request notes:

<img alt="RQL Studio execute results" src="docs/screenshots/query-execute.webp" width="900" />

**Visualize** — in-browser PCA, color-by `topic`:

<img alt="RQL Studio PCA visualizer" src="docs/screenshots/visualize-pca.webp" width="900" />

**Fail-closed late** — `LateInteractExec` is refused, no silent dense substitute:

<img alt="RQL Studio late-interaction error" src="docs/screenshots/late-fail-closed.webp" width="900" />

## Tests

```bash
npm test
```

Covers editor → library parse, demo recipe bindings, admin helpers, PCA, storage, execute fail-closed / mocked HTTP, pgvector schema (≥5 tables) + SQL examples + execute/admin helpers.

## Layout

```
web/
  Dockerfile           multi-stage: seed + javascript/web build + vite preview
  docker-compose.yml            qdrant + seed + studio (UI on :8080); `--profile pgvector` adds Postgres
  docker-compose.pgvector.yml   dual stack (Qdrant + pgvector)
  sql/schema.sql                ≥5 tables, HNSW + B-tree indexes
  src/                          React UI (recipes, query, data, indexes, SQL, health, PCA)
  server/                       Vite middleware: Qdrant proxy + /api/pg + RQL execute
  scripts/                      seed.mjs, seed-pg.mjs, demo-data.mjs, mock-qdrant.mjs
```
