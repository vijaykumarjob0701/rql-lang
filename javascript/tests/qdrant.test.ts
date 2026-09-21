import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  AdapterError,
  ExecutionError,
  compile,
  emit,
  execute,
  parse,
} from "../src/index.js";
import type { QdrantTransport } from "../src/index.js";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");
const DENSE = [0.1, 0.2, 0.3, 0.4];
const SPARSE = { indices: [1, 7], values: [0.9, 0.2] };

function readExample(name: string): string {
  return readFileSync(join(EXAMPLES, name), "utf8");
}

function filteredPhysical() {
  return compile(parse(readExample("02-filtered-dense.rql")), { profile: "qdrant" });
}

function rrfPhysical() {
  return compile(parse(readExample("01-hybrid-rrf.rql")), { profile: "qdrant" });
}

function latePhysical() {
  return compile(parse(readExample("03-late.rql")), { profile: "qdrant" });
}

function fakeTransport(opts: { status?: number; payload?: Record<string, unknown>; error?: Error } = {}) {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> | null }[] = [];
  const payload = opts.payload ?? {
    result: {
      points: [
        { id: 1, score: 0.91, payload: { tenant_id: "acme" } },
        { id: 2, score: 0.44, payload: { tenant_id: "acme" } },
      ],
    },
    status: "ok",
    time: 0.004,
  };
  const transport: QdrantTransport = async ({ method, url, headers, body }) => {
    calls.push({ method, url, headers, body });
    if (opts.error) throw opts.error;
    if ((opts.status ?? 200) >= 400) {
      throw new ExecutionError(`Qdrant HTTP ${opts.status}: boom`);
    }
    return { status: opts.status ?? 200, json: payload };
  };
  return { transport, calls };
}

describe("qdrant live execute (mocked HTTP)", () => {
  it("keeps emit as a notExecuted sketch", () => {
    const art = emit(filteredPhysical(), { backend: "qdrant" });
    assert.equal(art.notExecuted, true);
    assert.equal(art.kind, "VendorRequestSketch");
  });

  it("executes dense filtered PRE search", async () => {
    const { transport, calls } = fakeTransport();
    const result = await execute(filteredPhysical(), {
      backend: "qdrant",
      url: "http://qdrant.test:6333",
      apiKey: "secret-key",
      vectors: { dense: DENSE },
      transport,
    });
    assert.equal(result.kind, "ExecuteResult");
    assert.equal(result.executed, true);
    assert.equal(result.vendor, "qdrant");
    assert.equal(result.collection, "chunks");
    assert.deepEqual(result.hits.map((h) => h.id), [1, 2]);
    assert.equal(result.hits[0]!.score, 0.91);
    assert.equal((result.hits[0]!.payload as { tenant_id: string }).tenant_id, "acme");
    assert.equal(typeof result.timingMs, "number");

    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.method, "POST");
    assert.equal(call.url, "http://qdrant.test:6333/collections/chunks/points/query");
    assert.equal(call.headers["api-key"], "secret-key");
    const body = call.body as Record<string, unknown>;
    assert.deepEqual(body.query, DENSE);
    assert.equal(body.using, "dense");
    assert.equal(body.limit, 20);
    assert.equal(body.with_payload, true);
    const must = (body.filter as { must: unknown[] }).must;
    assert.ok(must.some((c) => JSON.stringify(c) === JSON.stringify({ key: "tenant_id", match: { value: "acme" } })));
    assert.ok(must.some((c) => JSON.stringify(c) === JSON.stringify({ key: "clearance", range: { gte: 2 } })));
    assert.ok(result.notes.some((n) => n.includes("PRE")));
  });

  it("executes hybrid RRF prefetch", async () => {
    const { transport, calls } = fakeTransport();
    const result = await execute(rrfPhysical(), {
      backend: "qdrant",
      vectors: { dense: DENSE, sparse: SPARSE },
      transport,
    });
    assert.equal(result.executed, true);
    const body = calls[0]!.body as { query: { fusion: string }; prefetch: Record<string, unknown>[] };
    assert.deepEqual(body.query, { fusion: "rrf" });
    assert.equal(body.prefetch.length, 2);
    assert.deepEqual(body.prefetch[0]!.query, DENSE);
    assert.equal(body.prefetch[0]!.using, "dense");
    assert.equal(body.prefetch[0]!.limit, 50);
    assert.deepEqual(body.prefetch[1]!.query, SPARSE);
    assert.equal(body.prefetch[1]!.using, "bm25_sparse");
    assert.equal((result.request.query as { fusion: string }).fusion, "rrf");
  });

  it("accepts a VendorRequestSketch", async () => {
    const sketch = emit(filteredPhysical(), { backend: "qdrant" });
    const { transport, calls } = fakeTransport();
    const result = await execute(sketch, {
      backend: "qdrant",
      vectors: { $q_dense: DENSE },
      transport,
    });
    assert.equal(result.executed, true);
    assert.deepEqual((calls[0]!.body as { query: unknown }).query, DENSE);
    assert.ok((calls[0]!.body as { filter: { must: unknown } }).filter.must);
  });

  it("fails closed on LateInteractExec", async () => {
    await assert.rejects(
      () => execute(latePhysical(), { backend: "qdrant", vectors: { dense: DENSE }, transport: fakeTransport().transport }),
      (e: unknown) => e instanceof ExecutionError && /LateInteract|not representable|fail-closed/i.test((e as Error).message),
    );
  });

  it("surfaces HTTP errors", async () => {
    const { transport } = fakeTransport({ status: 400 });
    await assert.rejects(
      () => execute(filteredPhysical(), { backend: "qdrant", vectors: { dense: DENSE }, transport }),
      (e: unknown) => e instanceof ExecutionError && /HTTP 400/.test((e as Error).message),
    );
  });

  it("requires a dense vector binding", async () => {
    await assert.rejects(
      () => execute(filteredPhysical(), { backend: "qdrant", transport: fakeTransport().transport }),
      (e: unknown) => e instanceof ExecutionError && /vector/i.test((e as Error).message),
    );
  });

  it("has no live adapter for elasticsearch", async () => {
    await assert.rejects(
      () => execute(filteredPhysical(), { backend: "elasticsearch", vectors: { dense: DENSE } }),
      (e: unknown) => e instanceof AdapterError && /elasticsearch|live/i.test((e as Error).message),
    );
  });

  it("fails closed on linear fusion", async () => {
    const physical = compile(parse(readExample("04-hybrid-linear.rql")), { profile: "qdrant" });
    await assert.rejects(
      () =>
        execute(physical, {
          backend: "qdrant",
          vectors: { dense: DENSE, sparse: SPARSE },
          transport: fakeTransport().transport,
        }),
      (e: unknown) => e instanceof ExecutionError && /not representable|linear|family/i.test((e as Error).message),
    );
  });
});
