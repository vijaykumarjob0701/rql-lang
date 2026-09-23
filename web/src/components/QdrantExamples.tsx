import { qdrantExamples } from "../lib/qdrantExamples";

export function QdrantExamples({ collection }: { collection: string | null }) {
  const name = collection || "studio_demo";
  return (
    <details className="card" style={{ marginBottom: 12 }} data-testid="qdrant-examples">
      <summary>
        Collection ops on <code>{name}</code> — update / index / delete / query
      </summary>
      <p className="muted" style={{ margin: "8px 0" }}>
        These are Qdrant REST calls (admin API), not RQL. The selected collection is the demo
        &quot;table&quot;.
      </p>
      {qdrantExamples(name).map((ex) => (
        <div key={ex.id} data-testid={`qdrant-ex-${ex.kind}`} style={{ marginBottom: 10 }}>
          <h4>
            {ex.title}
            <span className="recipe-kind">{ex.kind}</span>
          </h4>
          <p className="muted" style={{ margin: "0 0 6px" }}>
            {ex.ui}
          </p>
          <pre className="json-view">{ex.http}</pre>
        </div>
      ))}
    </details>
  );
}
