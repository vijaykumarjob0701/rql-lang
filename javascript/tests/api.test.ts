import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  parse,
  ParseError,
  compile,
  explain,
  emit,
  listProfiles,
  listVendors,
} from "../src/index.js";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");

describe("rql API", () => {
  it("parse hybrid rrf", () => {
    const text = readFileSync(join(EXAMPLES, "01-hybrid-rrf.rql"), "utf8");
    const plan = parse(text);
    assert.equal(plan.kind, "LogicalPlan");
    assert.equal(plan.schemaVersion, "0.1.0-draft");
    assert.equal(plan.root.op, "Fuse_rrf");
    assert.equal((plan.root.inputs as unknown[]).length, 2);
  });

  it("parse filtered dense acl", () => {
    const plan = parse(readFileSync(join(EXAMPLES, "02-filtered-dense.rql"), "utf8"));
    assert.equal(plan.root.op, "Filter");
    assert.equal((plan.root.predicate as { aclHard: boolean }).aclHard, true);
    assert.equal((plan.root.input as { op: string }).op, "Search_dense");
  });

  it("rejects EMBED", () => {
    assert.throws(
      () => parse("RETRIEVE c EMBED TEXT $q SEARCH DENSE CANDIDATES 5 QUERY 'x';"),
      (e: unknown) => e instanceof ParseError,
    );
  });

  it("compile qdrant native rrf", () => {
    const logical = parse(readFileSync(join(EXAMPLES, "01-hybrid-rrf.rql"), "utf8"));
    const physical = compile(logical, { profile: "qdrant" });
    assert.equal(physical.kind, "PhysicalPlan");
    assert.equal(physical.root.op, "FusionExec");
    assert.equal(physical.root.native, true);
    assert.equal(physical.meta.profileId, "qdrant");
  });

  it("compile pgvector shim rrf", () => {
    const logical = parse(readFileSync(join(EXAMPLES, "01-hybrid-rrf.rql"), "utf8"));
    const physical = compile(logical, { profile: "pgvector" });
    assert.equal(physical.root.op, "ShimCast");
    assert.equal(physical.root.shim, "client_rrf");
  });

  it("compile filter modes", () => {
    const logical = parse(readFileSync(join(EXAMPLES, "02-filtered-dense.rql"), "utf8"));
    const pq = compile(logical, { profile: "qdrant" });
    const pp = compile(logical, { profile: "pgvector" });
    assert.equal(pq.root.op, "FilterExec");
    assert.equal(pq.root.mode, "PRE");
    assert.equal(pp.root.mode, "ITERATIVE");
  });

  it("explain text and object", () => {
    const logical = parse(readFileSync(join(EXAMPLES, "03-late.rql"), "utf8"));
    const physical = compile(logical, { profile: "qdrant" });
    const text = explain(physical);
    assert.equal(typeof text, "string");
    assert.match(text as string, /LateInteractExec/);
    const obj = explain(physical, { format: "object" }) as { kind: string; notExecuted: boolean; ops: { op: string }[] };
    assert.equal(obj.kind, "PhysicalPlanExplain");
    assert.equal(obj.notExecuted, true);
    assert.ok(obj.ops.some((o) => o.op === "LateInteractExec"));
  });

  it("emit sketches not executed", () => {
    const logical = parse(readFileSync(join(EXAMPLES, "02-filtered-dense.rql"), "utf8"));
    const physical = compile(logical, { profile: "elasticsearch" });
    const art = emit(physical, { backend: "elasticsearch" });
    assert.equal(art.notExecuted, true);
    assert.equal(art.approximate, true);
    assert.equal(art.vendor, "elasticsearch");
    const body = art.body as { knn: { filter: unknown } };
    assert.ok(body.knn);
    assert.ok(body.knn.filter);
  });

  it("emit qdrant rrf prefetch", () => {
    const logical = parse(readFileSync(join(EXAMPLES, "01-hybrid-rrf.rql"), "utf8"));
    const physical = compile(logical, { profile: "qdrant" });
    const art = emit(physical, { backend: "qdrant" });
    const body = art.body as { query: { fusion: string }; prefetch: unknown[] };
    assert.equal(body.query.fusion, "rrf");
    assert.ok(body.prefetch?.length);
  });

  it("emit pgvector sql sketch", () => {
    const logical = parse(readFileSync(join(EXAMPLES, "02-filtered-dense.rql"), "utf8"));
    const physical = compile(logical, { profile: "pgvector" });
    const art = emit(physical, { backend: "pgvector" });
    const sql = (art.body as { sql: string }).sql;
    assert.match(sql, /<=>/);
    assert.match(sql, /ITERATIVE|iterative/);
  });

  it("lists profiles and vendors", () => {
    assert.ok(listProfiles().includes("qdrant"));
    assert.ok(listVendors().includes("elasticsearch"));
  });

  it("linear fusion", () => {
    const logical = parse(readFileSync(join(EXAMPLES, "04-hybrid-linear.rql"), "utf8"));
    assert.equal(logical.root.op, "Filter");
    const physical = compile(logical, { profile: "qdrant" });
    assert.equal(physical.root.op, "FilterExec");
  });
});
