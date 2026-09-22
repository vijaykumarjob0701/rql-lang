import { compile, parse } from "@vijaykumarjob0701/rql";
import { describe, expect, it } from "vitest";
import {
  bindVector,
  buildQueryFromPhysical,
  ExecutionError,
  executeAgainstQdrant,
  parseHits,
  parseQdrantFilter,
} from "./execute";

const dense = Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0));

function physical(rql: string) {
  return compile(parse(rql), { profile: "qdrant" });
}

describe("Studio execute helpers", () => {
  it("parses tenant + clearance filters", () => {
    expect(parseQdrantFilter("tenant_id = 'acme' AND clearance >= 2")).toEqual({
      must: [
        { key: "tenant_id", match: { value: "acme" } },
        { key: "clearance", range: { gte: 2 } },
      ],
    });
  });

  it("fails closed on unparsed filter residue", () => {
    expect(() => parseQdrantFilter("tenant_id = 'acme' OR clearance >= 2")).toThrow(ExecutionError);
  });

  it("builds a dense + filter Query API body", () => {
    const plan = physical(`RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 VECTOR_REF $q_dense
  WHERE tenant_id = 'acme' AND clearance >= 2
  ACL_HARD;
`);
    const { collection, request } = buildQueryFromPhysical(plan, {
      vectors: { $q_dense: dense },
      collection: "studio_demo",
    });
    expect(collection).toBe("studio_demo");
    expect(request.query).toEqual(dense);
    expect(request.using).toBe("dense");
    expect(request.filter).toBeTruthy();
  });

  it("fails closed on LateInteractExec", () => {
    const plan = physical(`RETRIEVE studio_demo
  SEARCH LATE ON token_vectors CANDIDATES 10 VECTOR_REF $q_tok;
`);
    expect(() => buildQueryFromPhysical(plan, { vectors: { $q_dense: dense } })).toThrow(
      /LateInteractExec/,
    );
  });

  it("fails closed on linear fusion", () => {
    const plan = physical(`RETRIEVE studio_demo
  SEARCH
    DENSE ON embedding METRIC cosine CANDIDATES 30 VECTOR_REF $q_dense
    AND BM25 ON description CANDIDATES 30 QUERY 'electronics deals'
  FUSE LINEAR WEIGHTS (0.5, 0.5);
`);
    expect(() => buildQueryFromPhysical(plan, { vectors: { $q_dense: dense } })).toThrow(/linear|FusionExec/i);
  });

  it("requires a sparse binding for RRF (no silent BM25 drop)", () => {
    const plan = physical(`RETRIEVE studio_demo
  SEARCH
    DENSE ON embedding METRIC cosine CANDIDATES 50 VECTOR_REF $q_dense
    AND BM25 ON content CANDIDATES 50 QUERY 'portable retrieval'
  FUSE RRF K 60;
`);
    expect(() => buildQueryFromPhysical(plan, { vectors: { $q_dense: dense } })).toThrow(/sparse/i);
  });

  it("bindVector rejects non-arrays for dense", () => {
    expect(() => bindVector("$q_dense", { $q_dense: "nope" }, "dense")).toThrow(ExecutionError);
  });

  it("parses Qdrant hit envelopes", () => {
    const hits = parseHits({
      result: { points: [{ id: 1, score: 0.9, payload: { topic: "research" } }] },
    });
    expect(hits).toEqual([{ id: 1, score: 0.9, payload: { topic: "research" } }]);
  });

  it("executeAgainstQdrant posts the request via the provided fetch", async () => {
    const plan = physical(`RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 5 VECTOR_REF $q_dense;
`);
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toMatch(/\/collections\/studio_demo\/points\/query$/);
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as { query: number[] };
      expect(body.query).toEqual(dense);
      return new Response(
        JSON.stringify({ result: { points: [{ id: "a", score: 0.42, payload: {} }] }, time: 0.01 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await executeAgainstQdrant({
      physical: plan,
      vectors: { $q_dense: dense },
      collection: "studio_demo",
      url: "http://127.0.0.1:6333",
      fetchImpl,
    });
    expect(result.executed).toBe(true);
    expect(result.hits).toHaveLength(1);
  });
});
