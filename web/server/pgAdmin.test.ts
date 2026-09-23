import { describe, expect, it } from "vitest";
import {
  assertDemoTable,
  exampleCatalog,
  listedDemoTables,
  parseVectorText,
  runPgExample,
  schemaSqlText,
} from "./pgAdmin";

describe("pg admin helpers", () => {
  it("allowlists only the demo tables", () => {
    expect(listedDemoTables().length).toBeGreaterThanOrEqual(5);
    expect(assertDemoTable("chunks")).toBe("chunks");
    expect(() => assertDemoTable("pg_shadow")).toThrow(/outside the demo schema/);
  });

  it("schema SQL on disk matches the allowlist", () => {
    const sql = schemaSqlText();
    for (const table of listedDemoTables()) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
    }
  });

  it("runs examples only by id with a injected query fn", async () => {
    const seen: { sql: string; params?: unknown[] }[] = [];
    const out = await runPgExample(
      async (sql, params) => {
        seen.push({ sql, params });
        return { rows: [{ tablename: "chunks", indexname: "idx_chunks_embedding_hnsw" }] };
      },
      "list-indexes",
    );
    expect(out.example.id).toBe("list-indexes");
    expect(seen[0]?.sql).toMatch(/pg_indexes/);
    expect(out.rowCount).toBe(1);
    await expect(runPgExample(async () => ({ rows: [] }), "not-a-real-example")).rejects.toThrow(
      /unknown/,
    );
  });

  it("injects a demo vector for similarity", async () => {
    let params: unknown[] | undefined;
    await runPgExample(
      async (_sql, p) => {
        params = p;
        return { rows: [] };
      },
      "similarity",
      [0.25, 0.5],
    );
    expect(params).toEqual(["[0.25,0.5]"]);
  });

  it("parses pgvector text output", () => {
    expect(parseVectorText("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseVectorText("nope")).toBeNull();
  });

  it("exposes the four example kinds in the catalog", () => {
    const kinds = new Set(exampleCatalog().map((e) => e.kind));
    expect(kinds.has("update")).toBe(true);
    expect(kinds.has("index")).toBe(true);
    expect(kinds.has("delete")).toBe(true);
    expect(kinds.has("similarity")).toBe(true);
  });
});
