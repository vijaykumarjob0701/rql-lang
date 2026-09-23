import { describe, expect, it } from "vitest";
import { buildUpsertPoints, parsePayloadIndexes } from "./api";

describe("admin helpers", () => {
  it("parsePayloadIndexes reads Qdrant payload_schema", () => {
    expect(
      parsePayloadIndexes({
        payload_schema: {
          tenant_id: { data_type: "keyword" },
          clearance: { data_type: "integer" },
        },
      }),
    ).toEqual([
      { field: "clearance", dataType: "integer" },
      { field: "tenant_id", dataType: "keyword" },
    ]);
  });

  it("buildUpsertPoints names the dense vector and optional sparse", () => {
    const body = buildUpsertPoints({
      id: 999,
      payload: { topic: "ops" },
      dense: [0.1, 0.2],
      sparse: { indices: [1], values: [0.5] },
    });
    expect(body.points[0]).toMatchObject({
      id: 999,
      payload: { topic: "ops" },
      vector: { dense: [0.1, 0.2], bm25_sparse: { indices: [1], values: [0.5] } },
    });
  });
});
