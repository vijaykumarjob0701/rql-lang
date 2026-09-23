import { useState } from "react";
import { PG_EXAMPLES, type PgExample } from "../lib/pgExamples";

export function SqlExamples({
  connected,
  busy,
  error,
  lastRows,
  onRun,
}: {
  connected: boolean;
  busy: boolean;
  error: string | null;
  lastRows: Record<string, unknown>[] | null;
  onRun: (example: PgExample) => Promise<void>;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copySql(ex: PgExample) {
    try {
      await navigator.clipboard.writeText(ex.sql);
      setCopied(ex.id);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="pane-body">
      <div className="banner warn">
        These are <strong>Postgres SQL</strong> examples — not RQL. v0.1 RQL is retrieve-only;
        Studio runs them only by id against the demo database.
      </div>
      {error ? <div className="banner err">{error}</div> : null}
      {PG_EXAMPLES.map((ex) => (
        <div className="card" key={ex.id} style={{ marginBottom: 10 }} data-testid={`sql-${ex.id}`}>
          <h4>
            {ex.title}
            <span className={`recipe-kind ${ex.writes ? "fail-closed" : ""}`}>{ex.kind}</span>
          </h4>
          <p className="muted" style={{ margin: "0 0 8px" }}>
            {ex.blurb}
          </p>
          <pre className="json-view">{ex.sql}</pre>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn tiny" type="button" onClick={() => void copySql(ex)}>
              {copied === ex.id ? "Copied" : "Copy SQL"}
            </button>
            <button
              className="btn primary tiny"
              type="button"
              disabled={!connected || busy || !ex.runnable}
              onClick={() => void onRun(ex)}
            >
              Run
            </button>
          </div>
        </div>
      ))}
      {lastRows ? (
        <div className="card">
          <h4>Last result</h4>
          <pre className="json-view">{JSON.stringify(lastRows, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}
