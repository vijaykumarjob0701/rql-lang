/**
 * Copy-paste Qdrant collection ops — the "update / index / delete / query"
 * examples, in vector-DB terms (not SQL).
 */
export type QdrantExampleKind = "update" | "index" | "delete" | "query";

export type QdrantExample = {
  id: string;
  kind: QdrantExampleKind;
  title: string;
  ui: string;
  http: string;
};

export function qdrantExamples(collection = "studio_demo"): QdrantExample[] {
  const col = collection || "studio_demo";
  const enc = encodeURIComponent(col);
  return [
    {
      id: "upsert",
      kind: "update",
      title: "Update / upsert a point",
      ui: `Data tab → select a row or New point → edit payload + dense vector → Upsert. Scoped to ${col}.`,
      http: `PUT /collections/${enc}/points?wait=true
{
  "points": [{
    "id": 999,
    "vector": { "dense": [<128 floats>] },
    "payload": { "title": "studio upsert" }
  }]
}`,
    },
    {
      id: "create-index",
      kind: "index",
      title: "Get / create a payload index",
      ui: `Indexes tab lists seed indexes for ${col}. Create a field (e.g. year as integer) or delete one.`,
      http: `PUT /collections/${enc}/index?wait=true
{ "field_name": "year", "field_schema": "integer" }

GET /collections/${enc}
# payload_schema lists indexes`,
    },
    {
      id: "delete-point",
      kind: "delete",
      title: "Delete a point",
      ui: `Data tab → Delete id on a scrolled row. Refresh scroll to confirm ${col} shrank.`,
      http: `POST /collections/${enc}/points/delete?wait=true
{ "points": [999] }`,
    },
    {
      id: "run-query",
      kind: "query",
      title: "Run a query (Query API)",
      ui: `Select ${col} → pick a Recipe (auto-binds a stored demo vector) → Execute. Hits come from POST /collections/${col}/points/query.`,
      http: `POST /collections/${enc}/points/query
{
  "query": [<128 floats>],
  "using": "dense",
  "limit": 8,
  "with_payload": true
}`,
    },
  ];
}

export function examplesByKind(kind: QdrantExampleKind, collection?: string): QdrantExample[] {
  return qdrantExamples(collection).filter((ex) => ex.kind === kind);
}
