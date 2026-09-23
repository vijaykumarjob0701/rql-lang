/**
 * Copy-paste SQL for the pgvector demo admin panel + README.
 * Studio executes these only by id (sandboxed). It never runs raw client SQL.
 * RQL still has no INSERT/UPDATE/DDL — these are labeled Postgres examples.
 */

export const DEMO_PG_TABLES = [
  "tenants",
  "projects",
  "documents",
  "chunks",
  "query_logs",
  "embedding_jobs",
] as const;

export type PgExampleKind = "update" | "index" | "delete" | "similarity" | "running";

export type PgExample = {
  id: string;
  kind: PgExampleKind;
  title: string;
  blurb: string;
  sql: string;
  runnable: boolean;
  writes: boolean;
  /** Inject the stored demo dense vector as $1::vector when running. */
  usesDemoVector?: boolean;
};

export const PG_EXAMPLES: PgExample[] = [
  {
    id: "update-chunk",
    kind: "update",
    title: "UPDATE a chunk / embedding",
    blurb: "Labeled SQL — not RQL. Rewrites the editable demo row; embedding stays a stored centroid.",
    runnable: true,
    writes: true,
    usesDemoVector: true,
    sql: `UPDATE chunks
SET content = 'Demo-updated chunk — stored centroid, not a model re-embed.',
    embedding = $1::vector
WHERE id = 'chunk-demo-editable'
RETURNING id, document_id, left(content, 72) AS content;`,
  },
  {
    id: "create-hnsw-index",
    kind: "index",
    title: "CREATE INDEX (HNSW)",
    blurb: "Seed already creates this. IF NOT EXISTS makes the example safe to re-run.",
    runnable: true,
    writes: true,
    sql: `CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);`,
  },
  {
    id: "list-indexes",
    kind: "index",
    title: "List indexes (pg_indexes)",
    blurb: "B-tree tenant/document indexes plus the HNSW embedding index.",
    runnable: true,
    writes: false,
    sql: `SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;`,
  },
  {
    id: "delete-query-log",
    kind: "delete",
    title: "DELETE a query_logs row",
    blurb: "Deletes the newest log row so the chunks corpus stays intact.",
    runnable: true,
    writes: true,
    sql: `DELETE FROM query_logs
WHERE id = (SELECT max(id) FROM query_logs)
RETURNING id, recipe_id, created_at;`,
  },
  {
    id: "similarity",
    kind: "similarity",
    title: "Run a similarity query",
    blurb: "Same shape emit(profile=pgvector) sketches: ORDER BY embedding <=> $1.",
    runnable: true,
    writes: false,
    usesDemoVector: true,
    sql: `SELECT c.id, c.topic, c.tenant_id, c.clearance, d.title,
       c.embedding <=> $1::vector AS dist
FROM chunks c
JOIN documents d ON d.id = c.document_id
WHERE c.tenant_id = 'acme' AND c.clearance >= 2
ORDER BY c.embedding <=> $1::vector
LIMIT 8;`,
  },
  {
    id: "running-queries",
    kind: "running",
    title: "Running queries (pg_stat_activity)",
    blurb: "Who is connected and what SQL is in flight on this demo database.",
    runnable: true,
    writes: false,
    sql: `SELECT pid, usename, state, wait_event_type, left(query, 160) AS query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY pid;`,
  },
];

export function pgExampleById(id: string): PgExample | undefined {
  return PG_EXAMPLES.find((ex) => ex.id === id);
}

export function examplesByKind(kind: PgExampleKind): PgExample[] {
  return PG_EXAMPLES.filter((ex) => ex.kind === kind);
}

export function formatVectorLiteral(values: number[]): string {
  if (!values.length || !values.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new Error("demo vector must be a finite number array");
  }
  return `[${values.join(",")}]`;
}
