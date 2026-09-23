import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_PG_TABLES,
  formatVectorLiteral,
  pgExampleById,
  PG_EXAMPLES,
  type PgExample,
} from "../src/lib/pgExamples";
import stored from "../src/lib/demo-query-vectors.json";
import type { PgQueryFn } from "./executePg";

const DEMO_TABLE_SET = new Set<string>(DEMO_PG_TABLES);

export function listedDemoTables(): readonly string[] {
  return DEMO_PG_TABLES;
}

export function schemaSqlText(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "../sql/schema.sql"), "utf8");
}

export function assertDemoTable(name: string): string {
  if (!DEMO_TABLE_SET.has(name)) {
    throw new Error(`table ${JSON.stringify(name)} is outside the demo schema`);
  }
  return name;
}

export function exampleCatalog(): PgExample[] {
  return PG_EXAMPLES;
}

export async function runPgExample(
  query: PgQueryFn,
  id: string,
  vector?: number[],
): Promise<{ example: PgExample; rows: Record<string, unknown>[]; rowCount: number }> {
  const example = pgExampleById(id);
  if (!example || !example.runnable) {
    throw new Error(`unknown or non-runnable example ${JSON.stringify(id)}`);
  }
  const params: unknown[] = [];
  if (example.usesDemoVector) {
    const values = vector && vector.length ? vector : stored.dense.research;
    params.push(formatVectorLiteral(values));
  }
  const result = await query(example.sql, params);
  return { example, rows: result.rows, rowCount: result.rows.length };
}

export async function listTableStats(query: PgQueryFn): Promise<
  { name: string; rows: number; columns: { name: string; type: string }[] }[]
> {
  const { rows: tables } = await query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const out: { name: string; rows: number; columns: { name: string; type: string }[] }[] = [];
  for (const row of tables) {
    const name = String(row.table_name);
    if (!DEMO_TABLE_SET.has(name)) continue;
    const count = await query(`SELECT count(*)::int AS n FROM ${name}`);
    const cols = await query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [name],
    );
    out.push({
      name,
      rows: Number(count.rows[0]?.n ?? 0),
      columns: cols.rows.map((c) => ({ name: String(c.column_name), type: String(c.data_type) })),
    });
  }
  return out;
}

export async function listPgIndexes(query: PgQueryFn): Promise<
  { table: string; name: string; def: string }[]
> {
  const { rows } = await query(
    `SELECT tablename, indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY tablename, indexname`,
  );
  return rows.map((r) => ({
    table: String(r.tablename),
    name: String(r.indexname),
    def: String(r.indexdef),
  }));
}

export async function scrollChunks(
  query: PgQueryFn,
  limit = 160,
): Promise<{ id: string; payload: Record<string, unknown>; vector: number[] | null }[]> {
  const { rows } = await query(
    `SELECT c.id, c.document_id, c.tenant_id, c.topic, c.clearance, c.content,
            d.title, d.source, d.lang, d.year,
            c.embedding::text AS embedding
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     ORDER BY c.id
     LIMIT $1`,
    [Math.min(400, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: String(row.id),
    payload: {
      topic: row.topic,
      tenant_id: row.tenant_id,
      clearance: row.clearance,
      title: row.title,
      content: row.content,
      document_id: row.document_id,
      lang: row.lang,
      source: row.source,
      year: row.year,
    },
    vector: parseVectorText(row.embedding),
  }));
}

export function parseVectorText(raw: unknown): number[] | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!trimmed) return null;
  const nums = trimmed.split(",").map((p) => Number(p.trim()));
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
}

export async function upsertChunk(
  query: PgQueryFn,
  args: {
    id: string;
    payload: Record<string, unknown>;
    dense: number[];
  },
): Promise<void> {
  const id = String(args.id);
  if (!id.startsWith("chunk-")) {
    throw new Error("pgvector demo upserts are limited to chunk-* rows");
  }
  const content =
    typeof args.payload.content === "string" && args.payload.content.trim()
      ? args.payload.content
      : typeof args.payload.title === "string"
        ? args.payload.title
        : id;
  await query(
    `UPDATE chunks
     SET topic = COALESCE($2, topic),
         tenant_id = COALESCE($3, tenant_id),
         clearance = COALESCE($4, clearance),
         content = $5,
         embedding = $6::vector
     WHERE id = $1`,
    [
      id,
      typeof args.payload.topic === "string" ? args.payload.topic : null,
      typeof args.payload.tenant_id === "string" ? args.payload.tenant_id : null,
      typeof args.payload.clearance === "number" ? args.payload.clearance : null,
      content,
      formatVectorLiteral(args.dense),
    ],
  );
}

export async function deleteChunk(query: PgQueryFn, id: string): Promise<number> {
  if (!String(id).startsWith("chunk-")) {
    throw new Error("pgvector demo deletes are limited to chunk-* rows");
  }
  const { rows } = await query(`DELETE FROM chunks WHERE id = $1 RETURNING id`, [id]);
  return rows.length;
}

export async function pgHealth(query: PgQueryFn): Promise<{
  version: string | null;
  title: string;
  ready: string;
  live: string;
  cluster: unknown;
}> {
  const version = await query("SELECT version() AS v");
  const ext = await query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  const activity = await query(
    `SELECT pid, usename, state, wait_event_type, left(query, 120) AS query
     FROM pg_stat_activity
     WHERE datname = current_database()
     ORDER BY pid`,
  );
  const tables = await listTableStats(query);
  const ver = String(version.rows[0]?.v ?? "");
  return {
    version: ver.split(",")[0] || ver || null,
    title: "PostgreSQL + pgvector",
    ready: ext.rows[0] ? `pgvector ${ext.rows[0].extversion}` : "pgvector extension missing",
    live: "connected",
    cluster: { tables, activity: activity.rows },
  };
}
