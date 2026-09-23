import { compile, parse } from "@vijaykumarjob0701/rql";
import { describe, expect, it } from "vitest";
import { ExecutionError } from "./execute";
import { buildPgQueryFromPhysical, executeAgainstPgvector, parseSqlFilter } from "./executePg";

const dense = Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0));

function physical(rql: string) {
  return compile(parse(rql), { profile: "pgvector" });
}

describe("pgvector execute helpers", () => {
  it("parses tenant + clearance into parameterized SQL", () => {
    expect(parseSqlFilter("tenant_id = 'acme' AND clearance >= 2")).toEqual({
      sql: "c.tenant_id = $2 AND c.clearance >= $3",
      params: ["acme", 2],
    });
  });

  it("fails closed on unparsed filter residue", () => {
    expect(() => parseSqlFilter("tenant_id = 'acme' OR clearance >= 2")).toThrow(ExecutionError);
  });

  it("builds a dense + filter <=> query against chunks", () => {
    const plan = physical(`RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 VECTOR_REF $q_dense
  WHERE tenant_id = 'acme' AND clearance >= 2
  ACL_HARD;
`);
    const q = buildPgQueryFromPhysical(plan, { vectors: { $q_dense: dense } });
    expect(q.table).toBe("chunks");
    expect(q.sql).toMatch(/ORDER BY c.embedding <=> \$1::vector/);
    expect(q.sql).toMatch(/c.tenant_id = \$2/);
    expect(q.params[0]).toMatch(/^\[/);
    expect(q.params.slice(1, 3)).toEqual(["acme", 2]);
  });

  it("aliases studio_demo to the demo chunks table", () => {
    const plan = physical(`RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 8 VECTOR_REF $q_dense;
`);
    const q = buildPgQueryFromPhysical(plan, {
      vectors: { $q_dense: dense },
      collection: "studio_demo",
    });
    expect(q.table).toBe("chunks");
  });

  it("fails closed on LateInteractExec", () => {
    const plan = physical(`RETRIEVE chunks
  SEARCH LATE ON token_vectors CANDIDATES 10 VECTOR_REF $q_tok;
`);
    expect(() => buildPgQueryFromPhysical(plan, { vectors: { $q_dense: dense } })).toThrow(
      /LateInteractExec/,
    );
  });

  it("fails closed on hybrid / linear fusion", () => {
    const plan = physical(`RETRIEVE chunks
  SEARCH
    DENSE ON embedding METRIC cosine CANDIDATES 30 VECTOR_REF $q_dense
    AND BM25 ON description CANDIDATES 30 QUERY 'electronics deals'
  FUSE LINEAR WEIGHTS (0.5, 0.5);
`);
    expect(() => buildPgQueryFromPhysical(plan, { vectors: { $q_dense: dense } })).toThrow(
      /FusionExec|Bm25Exec/,
    );
  });

  it("maps query() rows into ExecuteResult hits", async () => {
    const plan = physical(`RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 5 VECTOR_REF $q_dense;
`);
    const result = await executeAgainstPgvector({
      physical: plan,
      vectors: { $q_dense: dense },
      query: async (sql) => {
        if (sql.startsWith("INSERT")) return { rows: [] };
        return {
          rows: [{ id: "chunk-1", score: 0.9, payload: { tenant_id: "acme", topic: "research" } }],
        };
      },
    });
    expect(result.vendor).toBe("pgvector");
    expect(result.executed).toBe(true);
    expect(result.hits).toEqual([
      { id: "chunk-1", score: 0.9, payload: { tenant_id: "acme", topic: "research" } },
    ]);
  });
});
