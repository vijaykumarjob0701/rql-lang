import { useCallback, useEffect, useMemo, useState } from "react";
import { CollectionList } from "./components/CollectionList";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { PlanTree } from "./components/PlanTree";
import { QueryEditor } from "./components/QueryEditor";
import { ResultsPanel } from "./components/ResultsPanel";
import { SchemaPanel } from "./components/SchemaPanel";
import { VectorPlot } from "./components/VectorPlot";
import {
  emitRql,
  executeRql,
  explainRql,
  formatError,
  isApiError,
  getCollection,
  listCollections,
  scrollPoints,
  type CollectionInfo,
  type ScrollPoint,
} from "./lib/api";
import { loadConnection, saveConnection, type Connection } from "./lib/storage";
import { DEFAULT_RQL } from "./lib/snippets";

type Tab = "query" | "visualize" | "schema";

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
  const [rql, setRql] = useState(DEFAULT_RQL);
  const [vectorText, setVectorText] = useState("");
  const [demoUsed, setDemoUsed] = useState(false);
  const [vectorNote, setVectorNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const selectedInfo = useMemo(
    () => collections.find((c) => c.name === selected) ?? null,
    [collections, selected],
  );

  const persist = (next: Connection) => {
    setConn(next);
    saveConnection(next);
  };

  const connect = useCallback(async () => {
    setConnectBusy(true);
    setConnectError(null);
    try {
      saveConnection(conn);
      const listed = await listCollections(conn);
      const details = await Promise.all(
        listed.map(async (c) => {
          try {
            return await getCollection(conn, c.name);
          } catch {
            return {
              name: c.name,
              pointsCount: null,
              vectors: null,
              status: "unknown",
              raw: {},
            } satisfies CollectionInfo;
          }
        }),
      );
      setCollections(details);
      setConnected(true);
      const prefer = details.find((c) => c.name === "studio_demo") ?? details[0];
      setSelected(prefer?.name ?? null);
    } catch (err) {
      setConnected(false);
      setCollections([]);
      setSelected(null);
      setConnectError(formatError(err));
    } finally {
      setConnectBusy(false);
    }
  }, [conn]);

  useEffect(() => {
    if (conn.url) void connect();
    // initial restore only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connected || !selected) {
      setSample([]);
      return;
    }
    let cancelled = false;
    setSampleBusy(true);
    setSampleError(null);
    scrollPoints(conn, selected, 160)
      .then((pts) => {
        if (!cancelled) setSample(pts);
      })
      .catch((err) => {
        if (!cancelled) {
          setSample([]);
          setSampleError(formatError(err));
        }
      })
      .finally(() => {
        if (!cancelled) setSampleBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, selected, conn]);

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
  }, [rql, vectorText, conn, selected, demoUsed]);

  async function runExplain() {
    setBusy(true);
    setResultError(null);
    try {
      const res = await explainRql(rql);
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
      const res = await emitRql(rql);
      setLogical(res.logical);
      setPhysical(res.physical);
      setEmitJson(res.sketch);
      setHits(null);
      setRequest((res.sketch as { body?: unknown }).body ?? res.sketch);
      setTimingMs(null);
      setNotes(["emit() returns a VendorRequestSketch — notExecuted: true. This is not a live query."]);
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
          "Execute needs a query vector. Paste JSON, upload a file, or click \"Demo random vector\" (demo-only).",
        );
      }
      const vector = parseVectorJson(vectorText);
      const res = await executeRql({
        rql,
        conn,
        vectors: { $q_dense: vector, q_dense: vector, dense: vector },
        collection: selected ?? undefined,
      });
      setLogical(res.logical);
      setPhysical(res.physical);
      setHits(res.result.hits);
      setTimingMs(res.result.timingMs);
      setRequest(res.result.request);
      setNotes([
        ...res.result.notes,
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
    setVectorNote(null);
  }

  async function uploadVector(file: File) {
    const text = await file.text();
    parseVectorJson(text);
    setVectorText(text.trim());
    setDemoUsed(false);
    setVectorNote(`Loaded ${file.name} — treated as a caller-supplied dense vector, not an embedding step.`);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark">R</div>
          <div>
            <h1>RQL Studio</h1>
            <p>Qdrant explorer + retrieval query language</p>
          </div>
        </div>
        <div className="top-meta">
          <span className="pill">
            <span className={`dot ${connected ? "ok" : connectError ? "bad" : ""}`} />
            {connected ? conn.url.replace(/^https?:\/\//, "") : "not connected"}
          </span>
          {selected ? <span className="pill">{selected}</span> : null}
        </div>
        <div className="top-actions">
          <div className="tabs">
            {(
              [
                ["query", "Query"],
                ["visualize", "Visualize"],
                ["schema", "Schema"],
              ] as const
            ).map(([id, label]) => (
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
            onSelect={setSelected}
            emptyHint={
              connected
                ? "This instance has no collections. Run npm run seed against a local Qdrant."
                : "Connect to list collections. Default is http://127.0.0.1:6333."
            }
          />
        </aside>

        <main className="pane">
          {tab === "query" ? (
            <QueryEditor
              value={rql}
              onChange={setRql}
              vectorText={vectorText}
              onVectorText={(t) => {
                setVectorText(t);
                setDemoUsed(false);
              }}
              vectorNote={vectorNote}
              demoUsed={demoUsed}
              onDemoVector={useDemoVector}
              onUploadVector={(f) => void uploadVector(f)}
              onExplain={() => void runExplain()}
              onEmit={() => void runEmit()}
              onExecute={() => void runExecute()}
              busy={busy}
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
          <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> execute · <kbd>⌘</kbd>+<kbd>Shift</kbd>+
          <kbd>E</kbd> explain · profile qdrant
        </span>
        <span>parse in-browser · compile/explain/emit via @vijaykumarjob0701/rql</span>
      </footer>
    </div>
  );
}
