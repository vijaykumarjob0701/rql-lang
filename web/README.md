# RQL Studio

Polished local console for browsing a **Qdrant** instance and writing **RQL** on top of it.

```
parse → compile → explain / emit     (library: @vijaykumarjob0701/rql)
                 ↘ execute           (Studio server — library execute() is not on main yet)
```

The UI does **not** reimplement the language. The editor calls the library parser in-browser. Explain / emit / compile run in the Vite process against the local `javascript` package (`file:../javascript`). Live execute builds a Qdrant Query API body from the PhysicalPlan and POSTs it through a **local proxy** (Qdrant Cloud and local Docker almost never send usable CORS headers).

## Run

From this directory:

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

`npm run dev` builds `../javascript` first so `compile` / `explain` / `emit` resolve.

### Connect to local Qdrant

```bash
docker run --rm -p 6333:6333 qdrant/qdrant
```

In Studio: URL `http://127.0.0.1:6333`, API key blank, **Connect**.

Seed the demo collection (128-d cosine, named vector `dense`, payload `topic` / `tenant_id` / `clearance`):

```bash
npm run seed
```

Then reopen **Visualize** — PCA of the sample should show three topic clusters.

### No Docker?

This repo ships a **subset mock** that speaks enough of the Qdrant HTTP API for browse / visualize / dense execute:

```bash
npm run mock-qdrant   # http://127.0.0.1:6333
# other terminal
npm run seed
npm run dev
```

The mock is labeled in its startup log. It is **not** Qdrant. Hybrid RRF / fusion queries are rejected (same honesty as fail-closed execute).

### Qdrant Cloud

Paste the cluster URL + API key. Traffic is `browser → Vite `/api/qdrant` → your URL`. The key is stored in `localStorage` (`rql-studio.connection`) and forwarded as `api-key`. **It is never logged.**

## Keyboard

| Shortcut | Action |
|---|---|
| `⌘/Ctrl-Enter` | Execute against the connected instance |
| `⌘/Ctrl-Shift-E` | Explain (logical + physical text) |
| `⌘/Ctrl-Shift-M` | Emit vendor sketch JSON |

## Query vectors

Execute still needs a dense vector. Studio will not invent an embedding of the `QUERY` text.

- Paste a JSON number array
- Upload a `.json` file
- **Demo random vector** — clearly labeled demo-only. Scores from that path are **not** semantic retrieval.

## Fail-closed execute

Representable today: dense ANN + simple `AND` filters (`=` / ranges) on the seeded collection.

Rejected with the error on screen (no silent substitute):

- `SEARCH LATE` / ColBERT (`LateInteractExec`)
- `FUSE LINEAR`
- Hybrid `FUSE RRF` without a sparse `{ indices, values }` binding
- Filter expressions the adapter cannot parse (`OR`, functions, …)

`emit` always returns a `VendorRequestSketch` with `notExecuted: true`.

When [the live adapter PR](https://github.com/vijaykumarjob0701/rql-lang/pull/1) lands, this server can switch to library `execute()` without changing the UI.

## Tests

```bash
npm test
```

Covers editor → library parse, PCA, connection storage, and execute fail-closed / mocked HTTP.

## Layout

```
web/
  src/           React UI (Monaco, PCA plot, results, plan tree)
  server/        Vite middleware: Qdrant proxy + RQL compile/explain/emit/execute
  scripts/       seed.mjs, mock-qdrant.mjs
```
