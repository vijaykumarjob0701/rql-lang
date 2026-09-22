#!/usr/bin/env node
/**
 * Thin one-shot CLI for @vijaykumarjob0701/rql.
 * Interactive REPL is Python-first: `python -m rql`.
 */
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { VERSION, parse, compile, explain, emit, execute, ExecutionError, AdapterError, ParseError, PlanError } from "./index.js";

const HELP = `rql (JavaScript one-shot) — parse → compile → explain / emit / execute

Usage:
  rql -c "RETRIEVE …;"
  rql file.rql
  rql --json -c "…"
  rql --execute --vector '{"dense":[0.1,0.2]}' file.rql

Interactive REPL: python -m rql   (this bin is one-shot only)

Options:
  -c, --command TEXT     RQL string
  --profile NAME         qdrant | elasticsearch | pgvector (default qdrant)
  --backend NAME         emit/execute vendor (default: --profile)
  --json                 machine-readable LogicalPlan/PhysicalPlan/…
  --explain              explain mode (default)
  --emit                 VendorRequestSketch (notExecuted)
  --execute              live Qdrant (needs --vector / --vectors-file)
  --vector JSON          bindings; no fake embeddings
  --vectors-file PATH
  --url URL              Qdrant URL (else QDRANT_URL)
  --api-key KEY
  --collection NAME
  --help, -h
  --version
`;

function parseVectors(raw: string): Record<string, unknown> {
  const data = JSON.parse(raw) as unknown;
  if (Array.isArray(data)) return { dense: data };
  if (data && typeof data === "object") return data as Record<string, unknown>;
  throw new Error("vectors JSON must be an object or a dense float array");
}

function loadVectors(vector?: string, file?: string): Record<string, unknown> | undefined {
  if (vector && file) throw new Error("use only one of --vector or --vectors-file");
  if (file) return parseVectors(readFileSync(file, "utf8"));
  if (vector) return parseVectors(vector);
  return undefined;
}

function stripExplain(text: string): { src: string; forceExplain: boolean } {
  const m = /^\s*EXPLAIN\b\s*/i.exec(text);
  if (m) return { src: text.slice(m[0].length).trimStart(), forceExplain: true };
  return { src: text, forceExplain: false };
}

export async function main(argv: string[], io: { stdout: { write: (s: string) => void }; stderr: { write: (s: string) => void } } = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  let values: Record<string, unknown>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        command: { type: "string", short: "c" },
        profile: { type: "string", default: "qdrant" },
        backend: { type: "string" },
        json: { type: "boolean", default: false },
        explain: { type: "boolean", default: false },
        emit: { type: "boolean", default: false },
        execute: { type: "boolean", default: false },
        vector: { type: "string" },
        "vectors-file": { type: "string" },
        url: { type: "string" },
        "api-key": { type: "string" },
        collection: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", default: false },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    io.stderr.write(`rql: ${err instanceof Error ? err.message : err}\n`);
    return 2;
  }

  if (values.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout.write(`rql ${VERSION}\n`);
    return 0;
  }

  const command = values.command as string | undefined;
  const file = positionals[0];
  if (command && file) {
    io.stderr.write("rql: pass a file or -c, not both\n");
    return 2;
  }
  if (!command && !file) {
    io.stderr.write("rql: one-shot only (pass -c or a .rql file). Interactive REPL: python -m rql\n");
    io.stderr.write("Try rql --help\n");
    return 2;
  }

  let text: string;
  if (command != null) text = command;
  else {
    try {
      text = readFileSync(file!, "utf8");
    } catch (err) {
      io.stderr.write(`rql: ${err instanceof Error ? err.message : err}\n`);
      return 2;
    }
  }

  let vectors: Record<string, unknown> | undefined;
  try {
    vectors = loadVectors(values.vector as string | undefined, values["vectors-file"] as string | undefined);
  } catch (err) {
    io.stderr.write(`rql: vectors: ${err instanceof Error ? err.message : err}\n`);
    return 2;
  }

  const { src, forceExplain } = stripExplain(text);
  if (!src.trim()) {
    io.stderr.write("rql: EXPLAIN requires a statement\n");
    return 1;
  }

  const profile = (values.profile as string) || "qdrant";
  const backend = (values.backend as string) || profile;
  let mode = "explain";
  if (values.execute) mode = "execute";
  else if (values.emit) mode = "emit";
  if (forceExplain) mode = "explain";

  let logical;
  let physical;
  try {
    logical = parse(src);
    physical = compile(logical, { profile });
  } catch (err) {
    const msg = err instanceof ParseError || err instanceof PlanError || err instanceof Error ? err.message : String(err);
    io.stderr.write(`rql: ${msg}\n`);
    return 1;
  }

  const payload: Record<string, unknown> = {
    logical,
    physical,
    explain: explain(physical, { format: "object" }),
  };

  const jsonMode = Boolean(values.json);
  if (!jsonMode && (mode === "explain" || forceExplain)) {
    io.stdout.write(String(explain(physical)) + "\n");
  }

  if (mode === "emit") {
    try {
      const art = emit(physical, { backend });
      payload.emit = art;
      if (!jsonMode) {
        io.stdout.write(
          `-- VendorRequestSketch  notExecuted=${art.notExecuted}  vendor=${art.vendor}  approximate=${art.approximate}\n`,
        );
        io.stdout.write(JSON.stringify(art.body, null, 2) + "\n");
      }
    } catch (err) {
      io.stderr.write(`rql: ${err instanceof Error ? err.message : err}\n`);
      return 1;
    }
  }

  if (mode === "execute") {
    if (!vectors) {
      io.stderr.write(
        'rql: execute requires query vectors; pass --vector \'{"dense":[...]}\' or --vectors-file FILE (no embeddings are generated)\n',
      );
      return 1;
    }
    try {
      const art = await execute(physical, {
        backend,
        url: values.url as string | undefined,
        apiKey: values["api-key"] as string | undefined,
        vectors,
        collection: values.collection as string | undefined,
      });
      payload.execute = art;
      if (!jsonMode) {
        io.stdout.write(
          `ExecuteResult  executed=${art.executed}  collection=${art.collection}  timingMs=${art.timingMs}\n`,
        );
        if (!art.hits.length) io.stdout.write("  (no hits)\n");
        art.hits.forEach((h, i) => {
          io.stdout.write(`  ${i + 1}. id=${h.id}  score=${h.score}  payload=${JSON.stringify(h.payload)}\n`);
        });
      }
    } catch (err) {
      const msg = err instanceof ExecutionError || err instanceof AdapterError || err instanceof Error ? err.message : String(err);
      io.stderr.write(`rql: ${msg}\n`);
      return 1;
    }
  }

  if (jsonMode) {
    io.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  }
  return 0;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
