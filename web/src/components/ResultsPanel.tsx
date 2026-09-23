import { useState } from "react";

type Hit = { id: unknown; score: unknown; payload: Record<string, unknown> };

type Props = {
  hits: Hit[] | null;
  timingMs: number | null;
  request: unknown;
  notes: string[];
  error: string | null;
  explainText: string | null;
  emitJson: unknown;
};

export function ResultsPanel({ hits, timingMs, request, notes, error, explainText, emitJson }: Props) {
  const [asJson, setAsJson] = useState(false);
  const payloadKeys = Array.from(new Set((hits ?? []).flatMap((h) => Object.keys(h.payload)))).slice(0, 6);

  return (
    <div>
      {error ? <div className="banner err">{error}</div> : null}
      {notes.length ? (
        <div className="banner warn">
          {notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      ) : null}
      {timingMs != null ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Client timing <strong>{timingMs.toFixed(1)} ms</strong>
          {hits ? ` · ${hits.length} hit${hits.length === 1 ? "" : "s"}` : ""}
        </p>
      ) : null}

      {hits ? (
        hits.length === 0 ? (
          <div className="empty">
            <h3>No hits</h3>
            <p>The query executed. Qdrant returned an empty result set — check filters and the query vector.</p>
          </div>
        ) : asJson ? (
          <pre className="json-view">{JSON.stringify(hits, null, 2)}</pre>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>id</th>
                  <th>score</th>
                  {payloadKeys.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hits.map((h, i) => (
                  <tr key={String(h.id) + i}>
                    <td>{String(h.id)}</td>
                    <td>{h.score == null ? "—" : Number(h.score).toFixed(4)}</td>
                    {payloadKeys.map((k) => (
                      <td key={k}>{h.payload[k] == null ? "" : String(h.payload[k])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      <div className="row" style={{ margin: "10px 0" }}>
        <button className="btn tiny" type="button" onClick={() => setAsJson((v) => !v)} disabled={!hits}>
          {asJson ? "Table" : "JSON"}
        </button>
      </div>

      {explainText ? (
        <div className="card" style={{ marginBottom: 10 }}>
          <h4>Explain</h4>
          <pre className="json-view">{explainText}</pre>
        </div>
      ) : null}

      {emitJson ? (
        <div className="card" style={{ marginBottom: 10 }}>
          <h4>Emit sketch</h4>
          <pre className="json-view">{JSON.stringify(emitJson, null, 2)}</pre>
        </div>
      ) : null}

      {request ? (
        <div className="card">
          <h4>Request body</h4>
          <pre className="json-view">{JSON.stringify(request, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}
