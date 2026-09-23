import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollectionList } from "./components/CollectionList";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { DataPanel } from "./components/DataPanel";
import { HealthPanel } from "./components/HealthPanel";
import { IndexPanel } from "./components/IndexPanel";
import { PlanTree } from "./components/PlanTree";
import { QueryEditor } from "./components/QueryEditor";
import { RecipeList } from "./components/RecipeList";
import { ResultsPanel } from "./components/ResultsPanel";
import { SchemaPanel } from "./components/SchemaPanel";
import { QdrantExamples } from "./components/QdrantExamples";
import { SqlExamples } from "./components/SqlExamples";
import { VectorPlot } from "./components/VectorPlot";
import {
  buildUpsertPoints,
  createPayloadIndex,
  deletePayloadIndex,
  deletePgChunk,
  deletePoints,
  emitRql,
  executeRql,
  explainRql,
  formatError,
  fetchAllCollections,
  getCollection,
  getInstanceHealth,
  getPgHealth,
  isApiError,
  listPgIndexesApi,
  listPgTables,
  runPgExampleApi,
  scrollPgChunks,
  scrollPoints,
  tablesToCollections,
  upsertPgChunk,
  upsertPoints,
  type CollectionInfo,
  type InstanceHealth,
  type ScrollPoint,
} from "./lib/api";
import {
  defaultRecipeFor,
  DEMO_VECTOR_LABEL,
  recipeBindings,
  recipesForBackend,
  retargetRetrieve,
  type DemoRecipe,
} from "./lib/demoVectors";
import { COLLECTION_POLL_MS, preferCollection } from "./lib/collections";
import type { PgExample } from "./lib/pgExamples";
import { loadConnection, saveConnection, type Connection } from "./lib/storage";

type Tab = "query" | "data" | "indexes" | "health" | "visualize" | "schema" | "sql";

const DEFAULT_RECIPE = defaultRecipeFor("qdrant");

function demoUnitVector(dim: number): number[] {
  const v = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  const n = Math.hypot(...v);
  return v.map((x) => x / (n || 1));
}

function inferDim(vectors: unknown): number {
  if (vectors && typeof vectors === "object" && "size" in vectors) {
    return Number((vectors as { size?: number }).size) || 128;
  }
  if (vectors && typeof vectors === "object") {
    const first = Object.values(vectors as Record<string, { size?: number }>)[0];
    if (first?.size) return Number(first.size);
  }
  return 128;
}

function parseVectorJson(text: string): number[] {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return parsed;
  }
  if (parsed && typeof parsed === "object" && "vector" in parsed) {
    return parseVectorJson(JSON.stringify((parsed as { vector: unknown }).vector));
  }
  throw new Error("query vector must be a JSON array of finite numbers");
}

function applyRecipeVectors(recipe: DemoRecipe): { dense: string; sparse: string } {
  const bind = recipeBindings(recipe);
  return {
    dense: bind.dense ? JSON.stringify(bind.dense) : "",
    sparse: bind.sparse ? JSON.stringify(bind.sparse) : "",
  };
}

const initialVectors = applyRecipeVectors(DEFAULT_RECIPE);

export default function App() {
  const [conn, setConn] = useState<Connection>(() => loadConnection());
  const [connected, setConnected] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sample, setSample] = useState<ScrollPoint[]>([]);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("query");
  const [recipeId, setRecipeId] = useState<string | null>(DEFAULT_RECIPE.id);
  const [rql, setRql] = useState(DEFAULT_RECIPE.rql);
  const [vectorText, setVectorText] = useState(initialVectors.dense);
  const [sparseText, setSparseText] = useState(initialVectors.sparse);
  const [demoUsed, setDemoUsed] = useState(false);
  const [storedDemo, setStoredDemo] = useState(true);
  const [vectorNote, setVectorNote] = useState<string | null>(DEMO_VECTOR_LABEL);
  const [busy, setBusy] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [hits, setHits] = useState<
    { id: unknown; score: unknown; payload: Record<string, unknown> }[] | null
  >(null);
  const [timingMs, setTimingMs] = useState<number | null>(null);
  const [request, setRequest] = useState<unknown>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [explainText, setExplainText] = useState<string | null>(null);
  const [emitJson, setEmitJson] = useState<unknown>(null);
  const [logical, setLogical] = useState<Record<string, unknown> | null>(null);
  const [physical, setPhysical] = useState<Record<string, unknown> | null>(null);
  const [health, setHealth] = useState<InstanceHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [sqlRows, setSqlRows] = useState<Record<string, unknown>[] | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [listRefreshedAt, setListRefreshedAt] = useState<number | null>(null);
  const selectedRef = useRef<string | null>(null);
  const recipeIdRef = useRef<string | null>(null);

  const backend = conn.backend ?? "qdrant";
  const recipes = recipesForBackend(backend, selected ?? "studio_demo");
  const profile = backend === "pgvector" ? "pgvector" : "qdrant";
  selectedRef.current = selected;
  recipeIdRef.current = recipeId;

  const selectedInfo = useMemo(
    () => collections.find((c) => c.name === selected) ?? null,
    [collections, selected],
  );

  const persist = (next: Connection) => {
    const backendChanged = next.backend !== conn.backend;
    setConn(next);
    saveConnection(next);
    if (backendChanged) {
      const recipe = defaultRecipeFor(next.backend);
      const bound = applyRecipeVectors(recipe);
      setRecipeId(recipe.id);
      setRql(recipe.rql);
      setVectorText(bound.dense);
      setSparseText(bound.sparse);
      setStoredDemo(Boolean(bound.dense));
      setDemoUsed(false);
      setVectorNote(bound.dense ? DEMO_VECTOR_LABEL : null);
      setConnected(false);
      setCollections([]);
      setSelected(null);
      setHits(null);
      setSqlRows(null);
    }
  };

  const refreshCollection = useCallback(
    async (name: string) => {
      try {
        const info = await getCollection(conn, name);
        setCollections((prev) => prev.map((c) => (c.name === name ? info : c)));
        return info;
      } catch (err) {
        setAdminError(formatError(err));
        return null;
      }
    },
    [conn],
  );

  const loadSample = useCallback(async () => {
    if (!selected) {
      setSample([]);
      return;
    }
    setSampleBusy(true);
    setSampleError(null);
    try {
      if (conn.backend === "pgvector") {
        if (selected !== "chunks") {
          setSample([]);
          return;
        }
        const { points } = await scrollPgChunks(conn, 160);
        setSample(points);
      } else {
        setSample(await scrollPoints(conn, selected, 160));
      }
    } catch (err) {
      setSample([]);
      setSampleError(formatError(err));
    } finally {
      setSampleBusy(false);
    }
  }, [conn, selected]);

  const applyListSelection = useCallback(
    (next: string | null) => {
      const prev = selectedRef.current;
      if (next === prev) return;
      if (!next) {
        setSelected(null);
        return;
      }
      setSelected(next);
      if (conn.backend !== "qdrant") return;
      const rid = recipeIdRef.current;
      if (rid) {
        const scoped = recipesForBackend("qdrant", next).find((r) => r.id === rid);
        if (scoped) {
          const bound = applyRecipeVectors(scoped);
          setRecipeId(scoped.id);
          setRql(scoped.rql);
          setVectorText(bound.dense);
          setSparseText(bound.sparse);
          setStoredDemo(Boolean(bound.dense));
          setVectorNote(bound.dense ? DEMO_VECTOR_LABEL : null);
          return;
        }
      }
      setRql((current) => retargetRetrieve(current, next));
    },
    [conn.backend],
  );

  const refreshCollections = useCallback(
    async (mode: "connect" | "silent") => {
      if (mode === "connect") {
        setConnectBusy(true);
        setConnectError(null);
      }
      try {
        saveConnection(conn);
        let details: CollectionInfo[];
        if (conn.backend === "pgvector") {
          const { tables } = await listPgTables(conn);
          details = tablesToCollections(tables);
        } else {
          details = await fetchAllCollections(conn);
        }
        const names = details.map((d) => d.name);
        const fallback = conn.backend === "pgvector" ? "chunks" : "studio_demo";
        const next = preferCollection(names, selectedRef.current, fallback);
        setCollections(details);
        setConnected(true);
        setListRefreshedAt(Date.now());
        applyListSelection(next);
      } catch (err) {
        if (mode === "connect") {
          setConnected(false);
          setCollections([]);
          setSelected(null);
          setListRefreshedAt(null);
          setConnectError(formatError(err));
        }
      } finally {
        if (mode === "connect") setConnectBusy(false);
      }
    },
    [conn, applyListSelection],
  );

  const connect = useCallback(() => refreshCollections("connect"), [refreshCollections]);

  useEffect(() => {
    if (conn.url) void refreshCollections("connect");
    // initial restore only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshCollections("silent");
    };
    const id = window.setInterval(tick, COLLECTION_POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [connected, refreshCollections]);

  useEffect(() => {
    void loadSample();
  }, [loadSample]);

  const loadHealth = useCallback(async () => {
    if (!connected) {
      setHealth(null);
      return;
    }
    setHealthError(null);
    try {
      setHealth(conn.backend === "pgvector" ? await getPgHealth(conn) : await getInstanceHealth(conn));
    } catch (err) {
      setHealth(null);
      setHealthError(formatError(err));
    }
  }, [conn, connected]);

  useEffect(() => {
    if (tab === "health" && connected) void loadHealth();
  }, [tab, connected, loadHealth]);

  function applyRecipe(recipe: DemoRecipe, jumpToQuery: boolean) {
    const next = applyRecipeVectors(recipe);
    setRecipeId(recipe.id);
    setRql(recipe.rql);
    setVectorText(next.dense);
    setSparseText(next.sparse);
    setDemoUsed(false);
    setStoredDemo(Boolean(next.dense));
    setVectorNote(next.dense ? DEMO_VECTOR_LABEL : null);
    if (jumpToQuery) setTab("query");
  }

  function loadRecipe(recipe: DemoRecipe) {
    applyRecipe(recipe, true);
  }

  function selectCollection(name: string) {
    setSelected(name);
    if (backend !== "qdrant") return;
    if (recipeId) {
      const scoped = recipesForBackend("qdrant", name).find((r) => r.id === recipeId);
      if (scoped) {
        applyRecipe(scoped, false);
        return;
      }
    }
    setRql((current) => retargetRetrieve(current, name));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void runExecute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rql, vectorText, sparseText, conn, selected, demoUsed, storedDemo]);

  async function runExplain() {
    setBusy(true);
    setResultError(null);
    try {
      const res = await explainRql(rql, profile);
      setLogical(res.logical);
      setPhysical(res.physical);
      setExplainText(res.text);
      setHits(null);
      setRequest(null);
      setTimingMs(null);
      setNotes([]);
    } catch (err) {
      setResultError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function runEmit() {
    setBusy(true);
    setResultError(null);
    try {
      const res = await emitRql(rql, profile);
      setLogical(res.logical);
      setPhysical(res.physical);
      setEmitJson(res.sketch);
      setHits(null);
      setRequest((res.sketch as { body?: unknown }).body ?? res.sketch);
      setTimingMs(null);
      setNotes([
        `emit(profile=${profile}) returns a VendorRequestSketch — notExecuted: true. This is not a live query.`,
      ]);
    } catch (err) {
      setResultError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function runExecute() {
    setBusy(true);
    setResultError(null);
    try {
      if (!vectorText.trim()) {
        throw new Error(
          "Execute needs a query vector. Paste JSON, upload a file, pick a Recipe, or click \"Demo random vector\" (demo-only).",
        );
      }
      const vector = parseVectorJson(vectorText);
      const vectors: Record<string, unknown> = { $q_dense: vector, q_dense: vector, dense: vector };
      if (sparseText.trim()) {
        const sparse = JSON.parse(sparseText) as unknown;
        vectors.$q_sparse = sparse;
        vectors.q_sparse = sparse;
        vectors.sparse = sparse;
        vectors.bm25 = sparse;
      }
      const res = await executeRql({
        rql,
        conn,
        vectors,
        collection: selected ?? undefined,
        profile,
      });
      setLogical(res.logical);
      setPhysical(res.physical);
      setHits(res.result.hits);
      setTimingMs(res.result.timingMs);
      setRequest(res.result.request);
      setNotes([
        ...res.result.notes,
        ...(storedDemo ? [DEMO_VECTOR_LABEL] : []),
        ...(demoUsed ? ["Query vector is a DEMO random unit vector — not a text embedding."] : []),
      ]);
      setExplainText(null);
    } catch (err) {
      setHits(null);
      setTimingMs(null);
      setRequest(null);
      setNotes([]);
      setEmitJson(null);
      setExplainText(null);
      if (isApiError(err) && err.logical) setLogical(err.logical);
      if (isApiError(err) && err.physical) setPhysical(err.physical);
      setResultError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function useDemoVector() {
    const dim = inferDim(selectedInfo?.vectors);
    setVectorText(JSON.stringify(demoUnitVector(dim)));
    setDemoUsed(true);
    setStoredDemo(false);
    setVectorNote(null);
  }

  async function uploadVector(file: File) {
    const text = await file.text();
    parseVectorJson(text);
    setVectorText(text.trim());
    setDemoUsed(false);
    setStoredDemo(false);
    setVectorNote(`Loaded ${file.name} — treated as a caller-supplied dense vector, not an embedding step.`);
  }

  async function handleUpsert(args: {
    id: string | number;
    payload: Record<string, unknown>;
    dense: number[];
  }) {
    if (!selected) throw new Error("select a collection");
    setAdminBusy(true);
    setAdminError(null);
    try {
      if (conn.backend === "pgvector") {
        await upsertPgChunk(conn, args);
      } else {
        await upsertPoints(conn, selected, buildUpsertPoints(args));
        await refreshCollection(selected);
      }
      await loadSample();
    } catch (err) {
      setAdminError(formatError(err));
      throw err;
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleDelete(id: string | number) {
    if (!selected) return;
    setAdminBusy(true);
    setAdminError(null);
    try {
      if (conn.backend === "pgvector") {
        await deletePgChunk(conn, id);
      } else {
        await deletePoints(conn, selected, [id]);
        await refreshCollection(selected);
      }
      await loadSample();
    } catch (err) {
      setAdminError(formatError(err));
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleCreateIndex(field: string, schema: string) {
    if (!selected) return;
    setAdminBusy(true);
    setAdminError(null);
    try {
      if (conn.backend === "pgvector") {
        await runPgExampleApi(conn, "create-hnsw-index");
        await loadPgIndexes();
      } else {
        await createPayloadIndex(conn, selected, field, schema);
        await refreshCollection(selected);
      }
    } catch (err) {
      setAdminError(formatError(err));
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleDeleteIndex(field: string) {
    if (!selected) return;
    setAdminBusy(true);
    setAdminError(null);
    try {
      await deletePayloadIndex(conn, selected, field);
      await refreshCollection(selected);
    } catch (err) {
      setAdminError(formatError(err));
    } finally {
      setAdminBusy(false);
    }
  }

  const loadPgIndexes = useCallback(async () => {
    if (conn.backend !== "pgvector" || !connected) return;
    try {
      const { indexes } = await listPgIndexesApi(conn);
      setCollections((prev) =>
        prev.map((c) => ({
          ...c,
          payloadIndexes: indexes
            .filter((idx) => idx.table === c.name)
            .map((idx) => ({ field: idx.name, dataType: idx.def })),
        })),
      );
    } catch (err) {
      setAdminError(formatError(err));
    }
  }, [conn, connected]);

  useEffect(() => {
    if (tab === "indexes" && backend === "pgvector" && connected) void loadPgIndexes();
  }, [tab, backend, connected, loadPgIndexes]);

  async function handleRunSql(example: PgExample) {
    setAdminBusy(true);
    setSqlError(null);
    try {
      const vector = vectorText.trim() ? parseVectorJson(vectorText) : undefined;
      const res = await runPgExampleApi(conn, example.id, vector);
      setSqlRows(res.rows);
      if (example.id === "create-hnsw-index" || example.id === "list-indexes") {
        await loadPgIndexes();
      }
      if (selected === "chunks") await loadSample();
    } catch (err) {
      setSqlError(formatError(err));
    } finally {
      setAdminBusy(false);
    }
  }

  const TABS: [Tab, string][] = [
    ["query", "Query"],
    ["data", "Data"],
    ["indexes", "Indexes"],
    ["sql", "SQL"],
    ["health", "Health"],
    ["visualize", "Visualize"],
    ["schema", "Schema"],
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark">R</div>
          <div>
            <h1>RQL Studio</h1>
            <p>Qdrant collections explorer + retrieval query language</p>
          </div>
        </div>
        <div className="top-meta">
          <span className="pill">
            <span className={`dot ${connected ? "ok" : connectError ? "bad" : ""}`} />
            {connected ? conn.url.replace(/^https?:\/\//, "") : "not connected"}
          </span>
          <span className="pill">{backend}</span>
          {selected ? <span className="pill">{selected}</span> : null}
        </div>
        <div className="top-actions">
          <div className="tabs">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`tab ${tab === id ? "active" : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="pane">
          <ConnectionPanel
            value={conn}
            connected={connected}
            busy={connectBusy}
            error={connectError}
            onChange={persist}
            onConnect={() => void connect()}
          />
          <CollectionList
            items={collections}
            selected={selected}
            onSelect={selectCollection}
            title={backend === "pgvector" ? "Tables" : "Collections"}
            itemNoun={backend === "pgvector" ? "rows" : "points"}
            updatedAt={listRefreshedAt}
            emptyHint={
              connected
                ? backend === "pgvector"
                  ? "No demo tables. docker compose -f web/docker-compose.pgvector.yml up --build"
                  : "No collections. Seed creates six (studio_demo + docs_* + logs_ops): docker compose -f web/docker-compose.yml up --build"
                : backend === "pgvector"
                  ? "Connect with postgres://rql:rql@127.0.0.1:5432/rql_studio"
                  : "Connect to list collections. Default is http://127.0.0.1:6333."
            }
          />
          <RecipeList recipes={recipes} selectedId={recipeId} onSelect={loadRecipe} />
        </aside>

        <main className="pane">
          {tab === "query" ? (
            <QueryEditor
              value={rql}
              onChange={(next) => {
                setRql(next);
                setRecipeId(null);
              }}
              vectorText={vectorText}
              onVectorText={(t) => {
                setVectorText(t);
                setDemoUsed(false);
                setStoredDemo(false);
              }}
              sparseText={sparseText}
              onSparseText={setSparseText}
              vectorNote={vectorNote}
              demoUsed={demoUsed}
              storedDemo={storedDemo}
              onDemoVector={useDemoVector}
              onUploadVector={(f) => void uploadVector(f)}
              onExplain={() => void runExplain()}
              onEmit={() => void runEmit()}
              onExecute={() => void runExecute()}
              busy={busy}
              collection={selected}
            />
          ) : null}
          {tab === "data" ? (
            <DataPanel
              points={sample}
              loading={sampleBusy}
              error={adminError || sampleError}
              busy={adminBusy}
              disclaimer={
                backend === "pgvector"
                  ? "Sandboxed demo SQL (UPDATE/DELETE chunks-*) — not RQL. v0.1 RQL is retrieve-only."
                  : undefined
              }
              ops={backend === "qdrant" ? <QdrantExamples collection={selected} /> : null}
              onRefresh={() => void loadSample()}
              onUpsert={handleUpsert}
              onDelete={handleDelete}
            />
          ) : null}
          {tab === "indexes" ? (
            <IndexPanel
              indexes={selectedInfo?.payloadIndexes ?? []}
              busy={adminBusy}
              error={adminError}
              disclaimer={
                backend === "pgvector"
                  ? "pg_indexes + CREATE INDEX IF NOT EXISTS on chunks.embedding (HNSW). Not RQL DDL."
                  : undefined
              }
              createLabel={backend === "pgvector" ? "Ensure HNSW index" : "Create payload index"}
              hideDelete={backend === "pgvector"}
              simpleCreate={backend === "pgvector"}
              ops={backend === "qdrant" ? <QdrantExamples collection={selected} /> : null}
              onCreate={handleCreateIndex}
              onDelete={handleDeleteIndex}
            />
          ) : null}
          {tab === "sql" ? (
            <SqlExamples
              connected={connected && backend === "pgvector"}
              busy={adminBusy}
              error={sqlError}
              lastRows={sqlRows}
              onRun={handleRunSql}
            />
          ) : null}
          {tab === "health" ? (
            <HealthPanel
              health={health}
              collection={selectedInfo}
              error={healthError}
              busy={false}
              disclaimer={
                backend === "pgvector"
                  ? "Postgres version, pgvector extension, table counts, and pg_stat_activity."
                  : undefined
              }
              emptyHint={
                backend === "pgvector"
                  ? "Connect to the demo Postgres URL to read pg_stat_activity."
                  : undefined
              }
              onRefresh={() => void loadHealth()}
            />
          ) : null}
          {tab === "visualize" ? (
            <div className="pane-body">
              <VectorPlot points={sample} loading={sampleBusy} error={sampleError} />
            </div>
          ) : null}
          {tab === "schema" ? (
            <div className="pane-body">
              <SchemaPanel info={selectedInfo} sample={sample} />
            </div>
          ) : null}
        </main>

        <aside className="pane">
          <div className="pane-head">Results + plan</div>
          <div className="pane-body">
            <ResultsPanel
              hits={hits}
              timingMs={timingMs}
              request={request}
              notes={notes}
              error={resultError}
              explainText={explainText}
              emitJson={emitJson}
            />
            <div style={{ marginTop: 14 }}>
              <PlanTree logical={logical} physical={physical} />
            </div>
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <span>
          <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> execute · recipes auto-bind stored demo
          vectors · Data/Indexes/Health = admin API
        </span>
        <span>parse in-browser · compile/explain/emit via @vijaykumarjob0701/rql</span>
      </footer>
    </div>
  );
}
