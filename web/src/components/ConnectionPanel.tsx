import { useState } from "react";
import type { Backend, Connection } from "../lib/storage";

type Props = {
  value: Connection;
  connected: boolean;
  busy: boolean;
  error: string | null;
  onChange: (next: Connection) => void;
  onConnect: () => void;
};

export function ConnectionPanel({ value, connected, busy, error, onChange, onConnect }: Props) {
  const [showKey, setShowKey] = useState(false);
  const backend = value.backend ?? "qdrant";

  function setBackend(next: Backend) {
    onChange({ ...value, backend: next });
  }

  return (
    <section>
      <div className="pane-head">Connection</div>
      <div className="pane-body">
        <div className="seg" role="group" aria-label="Backend">
          <button
            type="button"
            data-testid="backend-qdrant"
            className={backend === "qdrant" ? "active" : ""}
            onClick={() => setBackend("qdrant")}
          >
            Qdrant
          </button>
          <button
            type="button"
            data-testid="backend-pgvector"
            className={backend === "pgvector" ? "active" : ""}
            onClick={() => setBackend("pgvector")}
          >
            pgvector
          </button>
        </div>
        {backend === "qdrant" ? (
          <>
            <div className="field">
              <label htmlFor="qdrant-url">Qdrant URL</label>
              <input
                id="qdrant-url"
                data-testid="qdrant-url"
                value={value.url}
                placeholder="http://127.0.0.1:6333"
                autoComplete="off"
                onChange={(e) => onChange({ ...value, url: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="qdrant-key">API key (optional)</label>
              <input
                id="qdrant-key"
                data-testid="qdrant-key"
                type={showKey ? "text" : "password"}
                value={value.apiKey}
                placeholder="not stored in logs"
                autoComplete="off"
                onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
              />
            </div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="pg-url">Postgres URL</label>
            <input
              id="pg-url"
              data-testid="pg-url"
              value={value.pgUrl}
              placeholder="postgres://rql:rql@127.0.0.1:5432/rql_studio"
              autoComplete="off"
              onChange={(e) => onChange({ ...value, pgUrl: e.target.value })}
            />
          </div>
        )}
        <div className="row">
          <button className="btn primary" type="button" disabled={busy} onClick={onConnect}>
            {busy ? "Connecting…" : connected ? "Reconnect" : "Connect"}
          </button>
          {backend === "qdrant" ? (
            <button className="btn ghost tiny" type="button" onClick={() => setShowKey((s) => !s)}>
              {showKey ? "Hide key" : "Show key"}
            </button>
          ) : null}
        </div>
        <p className="hint">
          {backend === "qdrant" ? (
            <>
              Browser traffic goes through the local Vite proxy (<code>/api/qdrant</code>). The key is
              kept in localStorage and sent as <code>x-qdrant-api-key</code> — it is never logged.
            </>
          ) : (
            <>
              Demo admin + Execute go through <code>/api/pg</code> (allowlisted SQL only). The password
              stays in localStorage and is never logged. Loopback remaps to <code>DATABASE_URL</code>{" "}
              inside Docker.
            </>
          )}
        </p>
        {error ? <div className="banner err">{error}</div> : null}
      </div>
    </section>
  );
}
