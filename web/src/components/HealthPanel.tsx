import type { CollectionInfo, InstanceHealth } from "../lib/api";

export function HealthPanel({
  health,
  collection,
  error,
  onRefresh,
  busy,
}: {
  health: InstanceHealth | null;
  collection: CollectionInfo | null;
  error: string | null;
  onRefresh: () => void;
  busy: boolean;
}) {
  return (
    <div className="pane-body">
      <div className="banner warn">Instance health is Qdrant REST (`/`, `/readyz`, `/livez`, `/cluster`).</div>
      {error ? <div className="banner err">{error}</div> : null}
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn tiny" type="button" disabled={busy} onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {!health ? (
        <div className="empty">
          <h3>Not connected</h3>
          <p>Connect to a Qdrant or mock-qdrant URL to read cluster health.</p>
        </div>
      ) : (
        <div className="schema-grid">
          <div className="card">
            <h4>Process</h4>
            <p className="muted" style={{ margin: 0 }}>
              {health.title || "Qdrant"} · version {health.version || "unknown"}
            </p>
          </div>
          <div className="card">
            <h4>Ready / live</h4>
            <pre className="json-view">{`readyz: ${health.ready}\nlivez: ${health.live}`}</pre>
          </div>
          <div className="card">
            <h4>Cluster</h4>
            <pre className="json-view">{JSON.stringify(health.cluster, null, 2)}</pre>
          </div>
          {collection ? (
            <div className="card">
              <h4>Selected collection</h4>
              <p className="muted" style={{ margin: "0 0 8px" }}>
                {collection.name} · {collection.pointsCount ?? "?"} points · status {collection.status}
              </p>
              <pre className="json-view">
                {JSON.stringify(
                  { vectors: collection.vectors, sparse_vectors: collection.sparseVectors },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
