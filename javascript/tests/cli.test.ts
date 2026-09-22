import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { main } from "../src/cli.js";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");
const ONESHOT =
  "RETRIEVE chunks SEARCH DENSE ON embedding METRIC cosine CANDIDATES 5 VECTOR_REF $q_dense WHERE tenant_id = 'acme';";

function io() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write: (s: string) => { stdout += s; } },
    stderr: { write: (s: string) => { stderr += s; } },
    get out() { return stdout; },
    get err() { return stderr; },
  };
}

describe("rql JS one-shot CLI", () => {
  it("prints help", async () => {
    const s = io();
    const code = await main(["--help"], s);
    assert.equal(code, 0);
    assert.match(s.out, /--execute/);
    assert.match(s.out, /-c/);
  });

  it("explains a one-shot command", async () => {
    const s = io();
    const code = await main(["-c", ONESHOT], s);
    assert.equal(code, 0, s.err);
    assert.match(s.out, /AnnExec|FilterExec|PhysicalPlan explain/);
  });

  it("reads a file", async () => {
    const s = io();
    const code = await main([join(EXAMPLES, "02-filtered-dense.rql")], s);
    assert.equal(code, 0, s.err);
    assert.match(s.out, /FilterExec/);
  });

  it("emits JSON pipeline", async () => {
    const s = io();
    const code = await main(["--json", "-c", ONESHOT], s);
    assert.equal(code, 0, s.err);
    const data = JSON.parse(s.out) as { logical: { kind: string }; physical: { kind: string } };
    assert.equal(data.logical.kind, "LogicalPlan");
    assert.equal(data.physical.kind, "PhysicalPlan");
  });

  it("emits a notExecuted sketch", async () => {
    const s = io();
    const code = await main(["--emit", "-c", ONESHOT], s);
    assert.equal(code, 0, s.err);
    assert.match(s.out, /notExecuted=true/);
    assert.match(s.out, /VendorRequestSketch/);
  });

  it("refuses execute without vectors", async () => {
    const s = io();
    const code = await main(["--execute", "-c", ONESHOT], s);
    assert.equal(code, 1);
    assert.match(s.err, /vector/i);
    assert.match(s.err, /embed/i);
  });

  it("tells humans to use the Python REPL when invoked with no args", async () => {
    const s = io();
    const code = await main([], s);
    assert.equal(code, 2);
    assert.match(s.err, /python -m rql/);
  });

  it("can read the shared example file from disk", () => {
    const text = readFileSync(join(EXAMPLES, "01-hybrid-rrf.rql"), "utf8");
    assert.match(text, /FUSE RRF/);
  });
});
