import { useMemo, useState } from "react";
import type { ScrollPoint } from "../lib/api";
import { storedDense } from "../lib/demoVectors";
import { extractDenseVector } from "../lib/pca";

type Draft = {
  id: string;
  topic: string;
  tenant_id: string;
  clearance: string;
  title: string;
  lang: string;
  source: string;
  year: string;
  vectorText: string;
};

const emptyDraft = (): Draft => ({
  id: "",
  topic: "research",
  tenant_id: "acme",
  clearance: "2",
  title: "",
  lang: "en",
  source: "memo",
  year: "2026",
  vectorText: JSON.stringify(storedDense("research")),
});

export function DataPanel({
  points,
  loading,
  error,
  busy,
  onRefresh,
  onUpsert,
  onDelete,
}: {
  points: ScrollPoint[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  onRefresh: () => void;
  onUpsert: (args: {
    id: string | number;
    payload: Record<string, unknown>;
    dense: number[];
  }) => Promise<void>;
  onDelete: (id: string | number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("{\n  \"id\": 999,\n  \"payload\": { \"topic\": \"ops\", \"tenant_id\": \"acme\", \"clearance\": 3, \"title\": \"studio upsert\" },\n  \"dense\": []\n}\n");

  const payloadKeys = useMemo(
    () => Array.from(new Set(points.flatMap((p) => Object.keys(p.payload)))).slice(0, 7),
    [points],
  );

  function loadRow(p: ScrollPoint) {
    const vec = extractDenseVector(p.vector);
    setDraft({
      id: String(p.id),
      topic: String(p.payload.topic ?? ""),
      tenant_id: String(p.payload.tenant_id ?? ""),
      clearance: String(p.payload.clearance ?? ""),
      title: String(p.payload.title ?? ""),
      lang: String(p.payload.lang ?? ""),
      source: String(p.payload.source ?? ""),
      year: String(p.payload.year ?? ""),
      vectorText: JSON.stringify(vec ?? storedDense("research")),
    });
    setMode("form");
  }

  async function submitForm() {
    setFormError(null);
    try {
      if (!draft.id.trim()) throw new Error("id is required");
      const dense = JSON.parse(draft.vectorText) as unknown;
      if (!Array.isArray(dense) || !dense.every((n) => typeof n === "number")) {
        throw new Error("vector must be a JSON number array");
      }
      const id = /^\d+$/.test(draft.id) ? Number(draft.id) : draft.id;
      await onUpsert({
        id,
        dense,
        payload: {
          topic: draft.topic,
          tenant_id: draft.tenant_id,
          clearance: Number(draft.clearance) || 0,
          title: draft.title || `point ${draft.id}`,
          lang: draft.lang,
          source: draft.source,
          year: Number(draft.year) || 2026,
        },
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitJson() {
    setFormError(null);
    try {
      const parsed = JSON.parse(jsonText) as {
        id?: string | number;
        payload?: Record<string, unknown>;
        dense?: number[];
      };
      if (parsed.id == null) throw new Error("JSON needs id");
      const dense =
        parsed.dense && parsed.dense.length ? parsed.dense : storedDense("research");
      await onUpsert({
        id: parsed.id,
        payload: parsed.payload || {},
        dense,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="pane-body">
      <div className="banner warn">
        Qdrant admin API via the Studio proxy — not RQL. Writes are PUT /points and POST
        /points/delete.
      </div>
      {error ? <div className="banner err">{error}</div> : null}
      {formError ? <div className="banner err">{formError}</div> : null}
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn tiny" type="button" onClick={onRefresh} disabled={busy || loading}>
          Refresh scroll
        </button>
        <button className="btn tiny" type="button" onClick={() => setDraft(emptyDraft())}>
          New point
        </button>
        <button className="btn tiny" type="button" onClick={() => setMode(mode === "form" ? "json" : "form")}>
          {mode === "form" ? "JSON panel" : "Form"}
        </button>
      </div>

      {mode === "form" ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <h4>Upsert / update</h4>
          <div className="form-grid">
            {(
              [
                ["id", "id"],
                ["title", "title"],
                ["topic", "topic"],
                ["tenant_id", "tenant_id"],
                ["clearance", "clearance"],
                ["lang", "lang"],
                ["source", "source"],
                ["year", "year"],
              ] as const
            ).map(([key, label]) => (
              <div className="field" key={key}>
                <label htmlFor={`pt-${key}`}>{label}</label>
                <input
                  id={`pt-${key}`}
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="field">
            <label htmlFor="pt-vector">Dense vector (JSON)</label>
            <textarea
              id="pt-vector"
              value={draft.vectorText}
              onChange={(e) => setDraft({ ...draft, vectorText: e.target.value })}
            />
            <p className="hint warn">
              Default is the stored research demo vector — not a text embedding.
            </p>
          </div>
          <div className="row">
            <button className="btn primary tiny" type="button" disabled={busy} onClick={() => void submitForm()}>
              Upsert
            </button>
            <button
              className="btn danger tiny"
              type="button"
              disabled={busy || !draft.id}
              onClick={() => {
                const id = /^\d+$/.test(draft.id) ? Number(draft.id) : draft.id;
                void onDelete(id);
              }}
            >
              Delete id
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 12 }}>
          <h4>JSON upsert</h4>
          <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} style={{ minHeight: 140 }} />
          <p className="hint">Empty dense array uses the stored research demo vector.</p>
          <button className="btn primary tiny" type="button" disabled={busy} onClick={() => void submitJson()}>
            Upsert JSON
          </button>
        </div>
      )}

      <div className="card">
        <h4>Scrolled points {loading ? "(loading…)" : `(${points.length})`}</h4>
        {points.length === 0 ? (
          <div className="empty">
            <h3>No points in sample</h3>
            <p>Connect and seed, or upsert a point above.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th />
                  <th>id</th>
                  {payloadKeys.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={String(p.id)}>
                    <td>
                      <button className="btn tiny" type="button" onClick={() => loadRow(p)}>
                        Edit
                      </button>
                    </td>
                    <td>{String(p.id)}</td>
                    {payloadKeys.map((k) => (
                      <td key={k}>{p.payload[k] == null ? "" : String(p.payload[k])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
