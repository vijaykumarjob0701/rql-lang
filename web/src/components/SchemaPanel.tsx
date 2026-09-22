import type { CollectionInfo, ScrollPoint } from "../lib/api";
import { inferPayloadSchema } from "../lib/schema";

export function SchemaPanel({
  info,
  sample,
}: {
  info: CollectionInfo | null;
  sample: ScrollPoint[];
}) {
  if (!info) {
    return (
      <div className="empty">
        <h3>Select a collection</h3>
        <p>Vector config and a payload field sketch appear after you connect and pick one.</p>
      </div>
    );
  }
  const fields = inferPayloadSchema(sample.map((p) => p.payload));
  return (
    <div className="schema-grid">
      <div className="card">
        <h4>{info.name}</h4>
        <p className="muted" style={{ margin: 0 }}>
          {info.pointsCount == null ? "point count unknown" : `${info.pointsCount} points`} · status{" "}
          {info.status}
        </p>
      </div>
      <div className="card">
        <h4>Vector config</h4>
        <pre className="json-view">{JSON.stringify(info.vectors, null, 2)}</pre>
      </div>
      <div className="card">
        <h4>Payload sketch (from sample)</h4>
        {fields.length === 0 ? (
          <p className="muted">No payload fields in the scrolled sample.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>field</th>
                <th>types</th>
                <th>samples</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key}>
                  <td>{f.key}</td>
                  <td>{f.kinds.join(", ")}</td>
                  <td>{f.samples.map((s) => JSON.stringify(s)).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
