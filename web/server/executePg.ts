/**
 * Studio-owned live pgvector execute path (dense + simple AND filters only).
 * Library emit(profile=pgvector) remains a notExecuted SQL sketch.
 */

import {
  bindVector,
  ExecutionError,
  type ExecuteResult,
  type VectorBindings,
} from "./execute";
import { formatVectorLiteral } from "../src/lib/pgExamples";

const ALLOWED_TABLES = new Set(["chunks", "studio_demo"]);
const ALLOWED_COLUMNS = new Set(["tenant_id", "topic", "clearance", "document_id", "id"]);

function findOps(node: Record<string, unknown>, op: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  if (node.op === op) found.push(node);
  if (node.input && typeof node.input === "object") {
    found.push(...findOps(node.input as Record<string, unknown>, op));
  }
  for (const child of (node.inputs as Record<string, unknown>[] | undefined) || []) {
    if (child && typeof child === "object") found.push(...findOps(child, op));
  }
  return found;
}

function unwrapShim(node: Record<string, unknown>): Record<string, unknown> {
  if (node.op === "ShimCast") {
    const inner = node.input;
    if (!inner || typeof inner !== "object") throw new ExecutionError("ShimCast.input missing");
    return inner as Record<string, unknown>;
  }
  return node;
}

function predicateExpr(node: Record<string, unknown> | undefined): string | undefined {
  if (!node) return undefined;
  const pred = (node.predicate || {}) as Record<string, unknown>;
  return pred.expr as string | undefined;
}

const CMP =
  /([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|<>|=|>|<)\s*('(?:[^']*)'|"(?:[^"]*)"|-?\d+(?:\.\d+)?)/g;

export type SqlFilter = { sql: string; params: unknown[] };

export function parseSqlFilter(expr: string | undefined, startIndex = 2): SqlFilter {
  if (!expr || !expr.trim()) return { sql: "TRUE", params: [] };
  let leftover = expr;
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;
  for (const match of expr.matchAll(CMP)) {
    leftover = leftover.replace(match[0]!, " ");
    const key = match[1]!;
    const op = match[2]!;
    const raw = match[3]!;
    if (!ALLOWED_COLUMNS.has(key)) {
      throw new ExecutionError(`filter column ${JSON.stringify(key)} is not in the demo allowlist`);
    }
    const value =
      raw[0] === "'" || raw[0] === '"'
        ? raw.slice(1, -1)
        : raw.includes(".")
          ? Number(raw)
          : parseInt(raw, 10);
    const sqlOp = op === "<>" ? "!=" : op;
    clauses.push(`c.${key} ${sqlOp} $${i}`);
    params.push(value);
    i += 1;
  }
  const residue = leftover.replace(/\bAND\b/gi, " ").replace(/[()\s]+/g, "");
  if (residue) {
    throw new ExecutionError(`filter expression is not representable as SQL WHERE: ${JSON.stringify(expr)}`);
  }
  if (!clauses.length) {
    throw new ExecutionError(`filter expression produced no clauses: ${JSON.stringify(expr)}`);
  }
  return { sql: clauses.join(" AND "), params };
}

function collectionOf(node: Record<string, unknown>, override?: string): string {
  if (override && override.trim()) return override.trim();
  for (const ann of findOps(node, "AnnExec")) {
    if (ann.collection) return String(ann.collection);
  }
  return "chunks";
}

function resolveTable(name: string): string {
  if (!ALLOWED_TABLES.has(name)) {
    throw new ExecutionError(
      `pgvector execute is sandboxed to the demo chunks table (got ${JSON.stringify(name)})`,
    );
  }
  return "chunks";
}

export type PgQuery = {
  table: string;
  sql: string;
  params: unknown[];
  notes: string[];
};

export function buildPgQueryFromPhysical(
  physical: Record<string, unknown>,
  opts: { vectors?: VectorBindings; collection?: string } = {},
): PgQuery {
  if (physical.kind !== "PhysicalPlan") {
    throw new ExecutionError(`expected kind=PhysicalPlan, got ${JSON.stringify(physical.kind)}`);
  }
  const root = physical.root;
  if (!root || typeof root !== "object") throw new ExecutionError("PhysicalPlan.root missing or not an object");
  const rootObj = root as Record<string, unknown>;
  for (const late of findOps(rootObj, "LateInteractExec")) {
    throw new ExecutionError(
      `LateInteractExec (variant=${String(late.variant ?? "colbert")}) is not executed against pgvector — fail-closed.`,
    );
  }
  const notes = [
    "Live Postgres/pgvector: parameterized SELECT … ORDER BY embedding <=> $1::vector.",
    "Studio execute path — library emit(profile=pgvector) remains a notExecuted SQL sketch.",
  ];
  const node = unwrapShim(rootObj);
  if (findOps(rootObj, "Bm25Exec").length) {
    throw new ExecutionError(
      "Bm25Exec / hybrid RRF is not executed on the pgvector demo (rrfNative=false; no tsv column). Fail-closed.",
    );
  }
  if (node.op === "FusionExec" || findOps(rootObj, "FusionExec").length) {
    throw new ExecutionError(
      "FusionExec is not executed on pgvector (client RRF/linear shim only). Fail-closed.",
    );
  }
  const filterNodes = findOps(rootObj, "FilterExec");
  const fnode = filterNodes[0];
  const filt = parseSqlFilter(predicateExpr(fnode));
  if (fnode) notes.push(`FilterExec mode=${String(fnode.mode)} applied as a parameterized WHERE.`);

  const ann =
    node.op === "AnnExec"
      ? node
      : node.op === "FilterExec" && node.input && typeof node.input === "object"
        ? (node.input as Record<string, unknown>)
        : node;
  if (ann.op !== "AnnExec") {
    throw new ExecutionError(`unsupported physical op for live pgvector execute: ${JSON.stringify(node.op)}`);
  }

  const table = resolveTable(collectionOf(rootObj, opts.collection));
  const k = Math.min(50, Number(ann.k || 20));
  const dense = bindVector(ann.queryRef, opts.vectors, "dense") as number[];
  const params: unknown[] = [formatVectorLiteral(dense), ...filt.params, k];
  const limitPlaceholder = `$${filt.params.length + 2}`;
  const sql = `SELECT c.id,
       (1 - (c.embedding <=> $1::vector)) AS score,
       jsonb_build_object(
         'tenant_id', c.tenant_id,
         'topic', c.topic,
         'clearance', c.clearance,
         'content', c.content,
         'document_id', c.document_id
       ) AS payload
FROM ${table} c
WHERE ${filt.sql}
ORDER BY c.embedding <=> $1::vector
LIMIT ${limitPlaceholder}`;

  return { table, sql, params, notes };
}

export type PgQueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export async function executeAgainstPgvector(args: {
  physical: Record<string, unknown>;
  vectors?: VectorBindings;
  collection?: string;
  query: PgQueryFn;
}): Promise<ExecuteResult> {
  const built = buildPgQueryFromPhysical(args.physical, {
    vectors: args.vectors,
    collection: args.collection,
  });
  const t0 = performance.now();
  const { rows } = await args.query(built.sql, built.params);
  const hits = rows.map((row) => ({
    id: row.id,
    score: row.score,
    payload: (row.payload as Record<string, unknown>) || {},
  }));
  try {
    await args.query(
      `INSERT INTO query_logs (tenant_id, recipe_id, rql, hit_count, latency_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        typeof hits[0]?.payload?.tenant_id === "string" ? hits[0].payload.tenant_id : null,
        "studio-execute",
        "RETRIEVE chunks",
        hits.length,
        performance.now() - t0,
      ],
    );
  } catch {
    /* logging is best-effort */
  }
  return {
    schemaVersion: "0.1.0-draft-execute",
    kind: "ExecuteResult",
    vendor: "pgvector",
    executed: true,
    collection: built.table,
    hits,
    timingMs: performance.now() - t0,
    request: { sql: built.sql, params: ["[vector]", ...built.params.slice(1)] },
    notes: built.notes,
    meta: { endpoint: "SELECT chunks ORDER BY embedding <=> $1::vector" },
  };
}
