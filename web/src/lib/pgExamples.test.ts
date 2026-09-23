import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEMO_PG_TABLES,
  examplesByKind,
  formatVectorLiteral,
  PG_EXAMPLES,
  pgExampleById,
} from "./pgExamples";

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../sql/schema.sql"), "utf8");

describe("pgvector demo schema + SQL examples", () => {
  it("defines at least 5 real tables", () => {
    expect(DEMO_PG_TABLES.length).toBeGreaterThanOrEqual(5);
    for (const table of DEMO_PG_TABLES) {
      expect(schema).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
    }
  });

  it("creates an HNSW vector index and B-tree helpers", () => {
    expect(schema).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
    expect(schema).toMatch(/CREATE INDEX IF NOT EXISTS idx_chunks_tenant_id/);
    expect(schema).toMatch(/CREATE INDEX IF NOT EXISTS idx_chunks_document_id/);
    expect(schema).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/);
  });

  it("ships UPDATE / index / DELETE / similarity / running-query examples", () => {
    expect(examplesByKind("update").length).toBeGreaterThan(0);
    expect(examplesByKind("index").length).toBeGreaterThan(0);
    expect(examplesByKind("delete").length).toBeGreaterThan(0);
    expect(examplesByKind("similarity").length).toBeGreaterThan(0);
    expect(examplesByKind("running").length).toBeGreaterThan(0);
    expect(pgExampleById("similarity")?.sql).toMatch(/ORDER BY c\.embedding <=> \$1/);
    expect(pgExampleById("running-queries")?.sql).toMatch(/pg_stat_activity/);
    expect(pgExampleById("create-hnsw-index")?.sql).toMatch(/CREATE INDEX/i);
    expect(pgExampleById("list-indexes")?.sql).toMatch(/pg_indexes/);
    expect(pgExampleById("update-chunk")?.sql).toMatch(/^UPDATE /);
    expect(pgExampleById("delete-query-log")?.sql).toMatch(/^DELETE /);
    expect(PG_EXAMPLES.every((ex) => ex.sql.trim().length > 10)).toBe(true);
  });

  it("formats a stored demo vector literal", () => {
    expect(formatVectorLiteral([0.1, -0.2, 1])).toBe("[0.1,-0.2,1]");
    expect(() => formatVectorLiteral([])).toThrow(/finite/);
  });
});
