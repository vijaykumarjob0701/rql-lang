#!/usr/bin/env node
/**
 * Opt-in live Qdrant execute demo (parse → compile → emit sketch → execute).
 *
 *   docker run --rm -p 6333:6333 qdrant/qdrant
 *   export QDRANT_URL=http://localhost:6333
 *   node examples/qdrant_live_execute.mjs [--seed]
 *
 * Run from the monorepo after `cd javascript && npm run build`, or via
 * `node --import tsx examples/qdrant_live_execute.mjs` with the TS sources.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
async function load(mod) {
  const dist = pathToFileURL(join(root, "javascript", "dist", `${mod}.js`)).href;
  try {
    return await import(dist);
  } catch {
    return await import(pathToFileURL(join(root, "javascript", "src", `${mod}.ts`)).href);
  }
}
const { parse, compile, emit, execute, ExecutionError } = await load("index");
const { QdrantAdapter } = await load("qdrant");

const RQL = `
RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 QUERY 'ACL-safe filtered ANN' VECTOR_REF $q_dense
  WHERE tenant_id = 'acme' AND clearance >= 2
  ACL_HARD;
`;
const DENSE = [0.95, 0.05, 0.0, 0.0];
const collection = "rql_demo";
const seed = process.argv.includes("--seed");

const logical = parse(RQL);
const physical = compile(logical, { profile: "qdrant" });
const sketch = emit(physical, { backend: "qdrant" });
console.log("emit.notExecuted =", sketch.notExecuted);
console.log("emit sketch query shape:", JSON.stringify(sketch.body.query, null, 2));

if (seed) {
  const adapter = new QdrantAdapter();
  await adapter.adminDelete(`/collections/${collection}`);
  await adapter.adminPut(`/collections/${collection}`, {
    vectors: { dense: { size: 4, distance: "Cosine" } },
  });
  await adapter.adminPut(`/collections/${collection}/points?wait=true`, {
    points: [
      { id: 1, vector: { dense: [1.0, 0.0, 0.0, 0.0] }, payload: { tenant_id: "acme", clearance: 5 } },
      { id: 2, vector: { dense: [0.0, 1.0, 0.0, 0.0] }, payload: { tenant_id: "other", clearance: 5 } },
    ],
  });
  console.log(`seeded collection ${JSON.stringify(collection)}`);
}

try {
  const result = await execute(physical, {
    backend: "qdrant",
    collection,
    vectors: { dense: DENSE },
  });
  console.log("executed =", result.executed);
  console.log("hits =", JSON.stringify(result.hits, null, 2));
  console.log("timingMs =", Number(result.timingMs.toFixed(2)));
} catch (err) {
  if (err instanceof ExecutionError) {
    console.log("execute failed (expected if Qdrant is down or collection is empty):", err.message);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
