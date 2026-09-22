import { useState } from "react";
import type { Connection } from "../lib/storage";

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
  return (
    <section>
      <div className="pane-head">Connection</div>
      <div className="pane-body">
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
        <div className="row">
          <button className="btn primary" type="button" disabled={busy} onClick={onConnect}>
            {busy ? "Connecting…" : connected ? "Reconnect" : "Connect"}
          </button>
          <button className="btn ghost tiny" type="button" onClick={() => setShowKey((s) => !s)}>
            {showKey ? "Hide key" : "Show key"}
          </button>
        </div>
        <p className="hint">
          Browser traffic goes through the local Vite proxy (<code>/api/qdrant</code>). The key is
          kept in localStorage and sent as <code>x-qdrant-api-key</code> — it is never logged.
        </p>
        {error ? <div className="banner err">{error}</div> : null}
      </div>
    </section>
  );
}
