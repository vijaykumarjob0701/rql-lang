# RQL Studio

Polished local console for browsing a **Qdrant** instance and writing **RQL** on top of it — plus admin Data / Indexes / Health panels for an end-to-end demo.

```
parse → compile → explain / emit     (library: @vijaykumarjob0701/rql)
                 ↘ execute           (Studio server — library execute() is not on main yet)
writes / indexes / health            (Qdrant REST via the Vite proxy — not RQL)
```

The UI does **not** reimplement the language. The editor calls the library parser in-browser. Explain / emit / compile run in the Vite process against the local `javascript` package (`file:../javascript`). Live execute builds a Qdrant Query API body from the PhysicalPlan and POSTs it through a **local proxy**. Create / update / delete / indexes talk to Qdrant REST and are labeled as admin API.

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

Covers editor → library parse, demo recipe bindings, admin helpers, PCA, storage, execute fail-closed / mocked HTTP.

## Layout

```
web/
  Dockerfile           multi-stage: seed + javascript/web build + vite preview
  docker-compose.yml   qdrant + seed + studio (UI on :8080)
  src/                 React UI (recipes, query, data, indexes, health, PCA)
  server/              Vite middleware: Qdrant proxy + RQL compile/explain/emit/execute
  scripts/             seed.mjs, demo-data.mjs, mock-qdrant.mjs, try-demo.mjs
```
