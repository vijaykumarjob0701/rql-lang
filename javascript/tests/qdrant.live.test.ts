/**
 * Optional live Qdrant smoke. Skipped unless QDRANT_URL is set.
 *
 *   docker run --rm -p 6333:6333 qdrant/qdrant
 *   export QDRANT_URL=http://localhost:6333
 *   cd javascript && npm test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { compile, execute, parse } from "../src/index.js";
import { QdrantAdapter } from "../src/qdrant.js";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");
const COLLECTION = "rql_live_smoke";
const DENSE_A = [1.0, 0.0, 0.0, 0.0];
const DENSE_B = [0.0, 1.0, 0.0, 0.0];
const QUERY = [0.95, 0.05, 0.0, 0.0];
const SPARSE_A = { indices: [1, 2], values: [1.0, 0.4] };
const SPARSE_B = { indices: [8], values: [1.0] };
const SPARSE_Q = { indices: [1, 2], values: [0.8, 0.3] };

const live = Boolean(process.env.QDRANT_URL);

describe("qdrant live smoke", { skip: !live }, () => {
  it("filters dense search and runs RRF prefetch", async () => {
    const adapter = new QdrantAdapter();
    await adapter.adminDelete(`/collections/${COLLECTION}`);
    await adapter.adminPut(`/collections/${COLLECTION}`, {
      vectors: { dense: { size: 4, distance: "Cosine" } },
      sparse_vectors: { bm25_sparse: {} },
    });
    await adapter.adminPut(`/collections/${COLLECTION}/points?wait=true`, {
      points: [
        {
          id: 1,
          vector: { dense: DENSE_A, bm25_sparse: SPARSE_A },
          payload: { tenant_id: "acme", clearance: 5 },
        },
        {
          id: 2,
          vector: { dense: DENSE_B, bm25_sparse: SPARSE_B },
          payload: { tenant_id: "other", clearance: 5 },
        },
      ],
    });

    const filtered = compile(parse(readFileSync(join(EXAMPLES, "02-filtered-dense.rql"), "utf8")), {
      profile: "qdrant",
    });
    const dense = await execute(filtered, {
      backend: "qdrant",
      collection: COLLECTION,
      vectors: { dense: QUERY },
    });
    assert.equal(dense.executed, true);
    assert.ok(dense.hits.length);
    assert.ok(dense.hits.every((h) => (h.payload as { tenant_id: string }).tenant_id === "acme"));

    const rrf = await execute(
      compile(parse(readFileSync(join(EXAMPLES, "01-hybrid-rrf.rql"), "utf8")), { profile: "qdrant" }),
      {
        backend: "qdrant",
        collection: COLLECTION,
        vectors: { dense: QUERY, sparse: SPARSE_Q },
      },
    );
    assert.equal(rrf.executed, true);
    assert.equal((rrf.request.query as { fusion: string }).fusion, "rrf");
    assert.ok(rrf.hits.length);
  });
});
