import { useState, type ReactNode } from "react";
import type { PayloadIndex } from "../lib/api";

const SCHEMAS = ["keyword", "integer", "float", "bool", "text", "uuid"];

export function IndexPanel({
  indexes,
  busy,
  error,
  onCreate,
  onDelete,
  disclaimer,
  createLabel = "Create payload index",
  hideDelete = false,
  simpleCreate = false,
  ops,
}: {
  indexes: PayloadIndex[];
  busy: boolean;
  error: string | null;
  disclaimer?: string;
  createLabel?: string;
  hideDelete?: boolean;
  simpleCreate?: boolean;
  onCreate: (field: string, schema: string) => Promise<void>;
  onDelete: (field: string) => Promise<void>;
  ops?: ReactNode;
}) {
  const [field, setField] = useState("year");
  const [schema, setSchema] = useState("integer");
  return (
    <div className="pane-body">
      <div className="banner warn">
        {disclaimer ??
          "Payload indexes are Qdrant admin API (`PUT/DELETE /collections/…/index`), not RQL."}
      </div>
      {ops}
      {error ? <div className="banner err">{error}</div> : null}
      <div className="card" style={{ marginBottom: 12 }}>
        <h4>{createLabel}</h4>
        {simpleCreate ? (
          <button
            className="btn primary tiny"
            type="button"
            disabled={busy}
            onClick={() => void onCreate("embedding", "hnsw")}
          >
            CREATE INDEX IF NOT EXISTS (HNSW)
          </button>
        ) : (
          <div className="row">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="idx-field">Field</label>
              <input id="idx-field" value={field} onChange={(e) => setField(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="idx-schema">Schema</label>
              <select id="idx-schema" value={schema} onChange={(e) => setSchema(e.target.value)}>
                {SCHEMAS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn primary tiny"
              type="button"
              disabled={busy || !field.trim()}
              onClick={() => void onCreate(field.trim(), schema)}
              style={{ alignSelf: "end" }}
            >
              Create
            </button>
          </div>
        )}
      </div>
      <div className="card">
        <h4>Existing indexes</h4>
        {indexes.length === 0 ? (
          <p className="muted">None reported on this collection. Seed creates tenant_id, topic, clearance, lang, source.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>field</th>
                <th>type</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => (
                <tr key={idx.field}>
                  <td>{idx.field}</td>
                  <td>{idx.dataType}</td>
                  <td>
                    {hideDelete ? null : (
                      <button
                        className="btn danger tiny"
                        type="button"
                        disabled={busy}
                        onClick={() => void onDelete(idx.field)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
