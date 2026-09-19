/**
 * Emit vendor request sketches from PhysicalPlan.
 * Never opens sockets or hits live vector DBs. Adapter interface ready for live backends.
 */

export const VENDORS = ["qdrant", "elasticsearch", "pgvector"] as const;
export type Vendor = (typeof VENDORS)[number];

const SKETCH_BANNER =
  "SKETCH ONLY — docs-shaped emit from PhysicalPlan; not executed against a live DB. Live adapters are a v0.1+ roadmap item.";

export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterError";
  }
}

export type EmitResult = {
  schemaVersion: string;
  kind: "VendorRequestSketch";
  label: string;
  approximate: boolean;
  notExecuted: boolean;
  vendor: string;
  format: "json" | "sql";
  filesuggested_ext: string;
  notes: string[];
  banner: string;
  body: unknown;
  meta: Record<string, unknown>;
};

export type EmitOptions = {
  backend?: string;
  profile?: string;
};

export interface Adapter {
  name: string;
  emit(physical: Record<string, unknown>): EmitResult;
}

export function listVendors(): string[] {
  return [...VENDORS];
}

export function resolveVendor(physical: Record<string, unknown>, profile?: string | null): Vendor {
  if (profile) {
    const v = profile.trim().toLowerCase();
    if (!(VENDORS as readonly string[]).includes(v)) {
      throw new AdapterError(`unknown vendor/profile ${JSON.stringify(profile)}; expected one of ${VENDORS.join(",")}`);
    }
    return v as Vendor;
  }
  const meta = (physical.meta || {}) as Record<string, unknown>;
  const pid = String(meta.profileId || "").trim().toLowerCase();
  if ((VENDORS as readonly string[]).includes(pid)) return pid as Vendor;
  const caps = (physical.capabilitiesUsed || {}) as Record<string, unknown>;
  const hints = (caps.vendorHints || []) as unknown[];
  for (const h of hints) {
    const hl = String(h).trim().toLowerCase();
    if ((VENDORS as readonly string[]).includes(hl)) return hl as Vendor;
  }
  throw new AdapterError("cannot resolve vendor: pass backend/profile or set meta.profileId");
}

function findOps(node: Record<string, unknown>, op: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  if (node.op === op) found.push(node);
  if (node.input && typeof node.input === "object") found.push(...findOps(node.input as Record<string, unknown>, op));
  for (const child of (node.inputs as Record<string, unknown>[] | undefined) || []) {
    if (child && typeof child === "object") found.push(...findOps(child, op));
  }
  return found;
}

function unwrapShim(node: Record<string, unknown>): [Record<string, unknown>, Record<string, unknown> | null] {
  if (node.op === "ShimCast") {
    const inner = node.input;
    if (!inner || typeof inner !== "object") throw new AdapterError("ShimCast.input missing");
    return [inner as Record<string, unknown>, node];
  }
  return [node, null];
}

function predicateExpr(node: Record<string, unknown> | undefined): string | undefined {
  if (!node) return undefined;
  const pred = (node.predicate || {}) as Record<string, unknown>;
  return pred.expr as string | undefined;
}

function toyQdrantFilter(expr: string | undefined): Record<string, unknown> | null {
  if (!expr) return null;
  const must: Record<string, unknown>[] = [];
  const m1 = /tenant_id\s*=\s*'([^']+)'/.exec(expr);
  if (m1) must.push({ key: "tenant_id", match: { value: m1[1] } });
  const m2 = /clearance\s*>=\s*(\d+)/.exec(expr);
  if (m2) must.push({ key: "clearance", range: { gte: parseInt(m2[1]!, 10) } });
  if (!must.length) {
    return { _sketch_opaque_expr: expr, must: [{ key: "_unparsed", match: { value: "SEE_NOTES" } }] };
  }
  return { must };
}

function toyEsFilter(expr: string | undefined): Record<string, unknown> | null {
  if (!expr) return null;
  const filters: Record<string, unknown>[] = [];
  const m1 = /tenant_id\s*=\s*'([^']+)'/.exec(expr);
  if (m1) filters.push({ term: { tenant_id: m1[1] } });
  const m2 = /clearance\s*>=\s*(\d+)/.exec(expr);
  if (m2) filters.push({ range: { clearance: { gte: parseInt(m2[1]!, 10) } } });
  if (!filters.length) return { query_string: { query: expr, _sketch: "opaque" } };
  return { bool: { filter: filters } };
}

function toySqlWhere(expr: string | undefined): string {
  if (!expr) return "TRUE /* no predicate */";
  return `(${expr}) /* opaque predicate pass-through */`;
}

function collectionHint(node: Record<string, unknown>): string | undefined {
  for (const ann of findOps(node, "AnnExec")) if (ann.collection) return String(ann.collection);
  for (const bm of findOps(node, "Bm25Exec")) if (bm.collection) return String(bm.collection);
  return undefined;
}

function qdrantRrf(
  fuse: Record<string, unknown>,
  filt: Record<string, unknown> | null,
  shim: Record<string, unknown> | null,
  notes: string[],
): [Record<string, unknown>, string[]] {
  const kRrf = (fuse.k_rrf as number) ?? 60;
  let limit = 10;
  const prefetches: Record<string, unknown>[] = [];
  for (const child of (fuse.inputs as Record<string, unknown>[]) || []) {
    if (!child) continue;
    const lim = Number(child.k || 50);
    limit = Math.max(limit, lim);
    if (child.op === "AnnExec") {
      const pref: Record<string, unknown> = {
        query: { nearest: { vector: { name: "dense", vector: child.queryRef || "$q_dense" } } },
        limit: lim,
      };
      if (filt) pref.filter = filt;
      if (child.efSearch) pref.params = { hnsw_ef: child.efSearch };
      prefetches.push(pref);
    } else if (child.op === "Bm25Exec") {
      const pref: Record<string, unknown> = {
        query: {
          nearest: {
            vector: {
              name: "bm25_sparse",
              vector: { _sketch_text: child.queryText, _note: "sparse/BM25 vector placeholder" },
            },
          },
        },
        limit: lim,
      };
      if (filt) pref.filter = filt;
      prefetches.push(pref);
    } else {
      prefetches.push({ _unsupported_child: child.op, limit: lim });
    }
  }
  const body: Record<string, unknown> = {
    _sketch: true, _label: "Hypothesis", _approximate: true, _notExecuted: true,
    collection: collectionHint(fuse) || "chunks",
    prefetch: prefetches,
    query: { fusion: "rrf" },
    limit: Math.min(limit, 50),
    params: { _rrf_k_hint: kRrf },
  };
  if (fuse.native) notes.push("FusionExec native=true → prefetch + fusion=rrf.");
  else {
    notes.push(`FusionExec native=false — client RRF (ShimCast=${shim?.shim ?? "n/a"}).`);
    body._client_rrf_required = true;
    if (shim) body._shim = { shim: shim.shim, expensive: shim.expensive, aclUnsafe: shim.aclUnsafe };
  }
  return [body, notes];
}

function qdrantSearch(
  node: Record<string, unknown>,
  filt: Record<string, unknown> | null,
  notes: string[],
  limitFrom: Record<string, unknown>,
): [Record<string, unknown>, string[]] {
  const limit = Number(limitFrom.k || 20);
  if (node.op === "AnnExec") {
    const body: Record<string, unknown> = {
      _sketch: true, _label: "Hypothesis", _approximate: true, _notExecuted: true,
      collection: node.collection || "chunks",
      query: { nearest: { vector: { name: "dense", vector: node.queryRef || "$q_dense" } } },
      limit,
    };
    if (filt) body.filter = filt;
    if (node.efSearch) body.params = { hnsw_ef: node.efSearch };
    notes.push("AnnExec → Query API nearest (dense) sketch.");
    return [body, notes];
  }
  if (node.op === "LateInteractExec") {
    const body: Record<string, unknown> = {
      _sketch: true, _label: "Hypothesis", _approximate: true, _notExecuted: true,
      collection: node.collection || "chunks",
      query: { nearest: { vector: { name: "colbert_multivector", vector: node.queryRef || "$q_late" } } },
      limit,
      _late_variant: node.variant || "colbert",
    };
    if (filt) body.filter = filt;
    notes.push("LateInteractExec → multivector nearest sketch.");
    return [body, notes];
  }
  const body: Record<string, unknown> = { _sketch: true, _label: "Hypothesis", query: { _unsupported: node.op }, limit };
  if (filt) body.filter = filt;
  return [body, notes];
}

function emitQdrant(root: Record<string, unknown>): [unknown, string[]] {
  const notes = ["Qdrant Query API-shaped JSON sketch — not executed."];
  const [node, shim] = unwrapShim(root);
  const filterNodes = findOps(root, "FilterExec");
  const fnode = filterNodes[0];
  const filt = toyQdrantFilter(predicateExpr(fnode));
  if (fnode) notes.push(`FilterExec mode=${fnode.mode} pruningStrategy=${fnode.pruningStrategy}`);
  if (node.op === "FusionExec" && node.family === "rrf") return qdrantRrf(node, filt, shim, notes);
  if (node.op === "FilterExec") {
    const inner = (node.input || {}) as Record<string, unknown>;
    return qdrantSearch(inner, filt, notes, inner);
  }
  if (["AnnExec", "Bm25Exec", "LateInteractExec"].includes(String(node.op))) {
    return qdrantSearch(node, filt, notes, node);
  }
  notes.push(`fallback: unsupported root op=${node.op}`);
  return [{ query: { error: "unsupported_op", op: node.op }, _sketch: true }, notes];
}

function esRrf(
  fuse: Record<string, unknown>,
  filt: Record<string, unknown> | null,
  shim: Record<string, unknown> | null,
  notes: string[],
): [Record<string, unknown>, string[]] {
  const retrievers: Record<string, unknown>[] = [];
  let window = 50;
  for (const child of (fuse.inputs as Record<string, unknown>[]) || []) {
    if (!child) continue;
    window = Math.max(window, Number(child.k || 50));
    if (child.op === "AnnExec") {
      const knn: Record<string, unknown> = {
        field: "embedding",
        query_vector: child.queryRef || "$q_dense",
        k: child.k || 50,
        num_candidates: Math.max(100, Number(child.efSearch || 100)),
      };
      if (filt) knn.filter = filt;
      retrievers.push({ knn });
    } else if (child.op === "Bm25Exec") {
      const std: Record<string, unknown> = { standard: { query: { match: { text: child.queryText || "" } } } };
      if (filt) (std.standard as Record<string, unknown>).filter = filt;
      retrievers.push(std);
    } else retrievers.push({ _unsupported_child: child.op });
  }
  const body: Record<string, unknown> = {
    _sketch: true, _label: "Hypothesis", _approximate: true, _notExecuted: true,
    retriever: { rrf: { retrievers, rank_constant: fuse.k_rrf ?? 60, rank_window_size: window } },
    size: Math.min(window, 50),
  };
  if (fuse.native) notes.push("FusionExec native RRF → retriever.rrf sketch.");
  else {
    notes.push("native=false — emit still shows RRF shape.");
    body._client_rrf_required = true;
    if (shim) body._shim = { shim: shim.shim, expensive: shim.expensive };
  }
  return [body, notes];
}

function esKnn(node: Record<string, unknown>, filt: Record<string, unknown> | null, notes: string[]): [Record<string, unknown>, string[]] {
  if (node.op === "AnnExec") {
    const knn: Record<string, unknown> = {
      field: "embedding",
      query_vector: node.queryRef || "$q_dense",
      k: node.k || 20,
      num_candidates: Math.max(100, Number(node.efSearch || 100)),
    };
    if (filt) knn.filter = filt;
    notes.push("AnnExec → knn (+ optional filter) sketch.");
    return [{ _sketch: true, _label: "Hypothesis", _approximate: true, _notExecuted: true, knn, size: node.k || 20 }, notes];
  }
  if (node.op === "Bm25Exec") {
    let query: Record<string, unknown> = { match: { text: node.queryText || "" } };
    if (filt) query = { bool: { must: [query], filter: [filt] } };
    return [{ _sketch: true, _label: "Hypothesis", query, size: node.k || 20 }, notes];
  }
  return [{ _sketch: true, _label: "Hypothesis", error: "unsupported", op: node.op }, notes];
}

function emitElasticsearch(root: Record<string, unknown>): [unknown, string[]] {
  const notes = ["Elasticsearch retriever / knn request sketch — not executed."];
  const [node, shim] = unwrapShim(root);
  const filterNodes = findOps(root, "FilterExec");
  const fnode = filterNodes[0];
  const filt = toyEsFilter(predicateExpr(fnode));
  if (fnode) notes.push(`FilterExec mode=${fnode.mode}`);
  if (node.op === "FusionExec" && node.family === "rrf") return esRrf(node, filt, shim, notes);
  if (node.op === "FusionExec" && node.family === "linear") {
    notes.push("Fuse_linear → weighted / boost sketch.");
    const [body, n2] = esRrf(node, filt, shim, notes);
    body.retriever = {
      _linear_fusion_sketch: true,
      _note: "ES often uses query+knn score sum with boosts; not identical to RRF",
      rrf_shape_reused_for_structure_only: body.retriever,
    };
    return [body, n2];
  }
  if (node.op === "FilterExec") return esKnn((node.input || {}) as Record<string, unknown>, filt, notes);
  if (["AnnExec", "Bm25Exec", "LateInteractExec"].includes(String(node.op))) return esKnn(node, filt, notes);
  return [{ _sketch: true, error: "unsupported_op", op: node.op }, notes];
}

function pgLeafSql(node: Record<string, unknown>, where: string): string[] {
  const table = String(node.collection || "chunks");
  const k = Number(node.k || 20);
  const lines: string[] = [];
  if (node.op === "AnnExec") {
    const qref = node.queryRef || ":q_embedding";
    lines.push(
      `SELECT id, embedding <=> ${qref} AS dist\nFROM ${table}\nWHERE ${where}\nORDER BY embedding <=> ${qref}\nLIMIT ${k};`,
    );
    if (node.efSearch) lines.push(`-- hnsw.ef_search = ${node.efSearch}  -- session GUC hint, not executed`);
  } else if (node.op === "Bm25Exec") {
    const qtext = String(node.queryText || "").replace(/'/g, "''");
    lines.push(
      `SELECT id, ts_rank(tsv, plainto_tsquery('english', '${qtext}')) AS rank\nFROM ${table}\nWHERE ${where}\n  AND tsv @@ plainto_tsquery('english', '${qtext}')\nORDER BY rank DESC\nLIMIT ${k};`,
    );
  } else if (node.op === "LateInteractExec") {
    lines.push(`-- LateInteractExec variant=${node.variant}: no first-class MaxSim in pgvector; Placeholder LIMIT ${k} on ${table}.`);
  } else lines.push(`-- leaf op=${node.op} not sketched`);
  return lines;
}

function emitPgvector(root: Record<string, unknown>): [unknown, string[]] {
  const notes = ["pgvector SQL sketch — not executed."];
  const [node, shim] = unwrapShim(root);
  const filterNodes = findOps(root, "FilterExec");
  const fnode = filterNodes[0];
  const where = toySqlWhere(predicateExpr(fnode));
  const mode = fnode?.mode as string | undefined;
  const parts: string[] = [];
  if (mode === "ITERATIVE") {
    parts.push("-- FilterExec mode=ITERATIVE: enable iterative index scans (pgvector ≥0.8.0)");
    parts.push("-- SET hnsw.iterative_scan = strict_order;  -- illustrative, not executed");
    notes.push("ITERATIVE → comment + SET hint.");
  } else if (mode === "POST") parts.push("-- FilterExec mode=POST: approx index scan then SQL WHERE.");
  else if (mode === "PRE") parts.push("-- FilterExec mode=PRE requested; pgvector approx indexes are typically POST.");

  if (node.op === "FilterExec") parts.push(...pgLeafSql((node.input || {}) as Record<string, unknown>, where));
  else if (node.op === "FusionExec") {
    parts.push(`-- FusionExec: pgvector has no native RRF/weighted fuse — family=${node.family} native=${node.native}.`);
    if (shim) {
      parts.push(`-- ShimCast shim=${shim.shim} expensive=${shim.expensive} — client merges ranked lists.`);
      notes.push(`ShimCast ${shim.shim} → dual SQL + client merge note.`);
    }
    ((node.inputs as Record<string, unknown>[]) || []).forEach((child, i) => {
      if (child) {
        parts.push(`-- --- branch ${i}: ${child.op} ---`);
        parts.push(...pgLeafSql(child, where));
      }
    });
  } else if (["AnnExec", "Bm25Exec", "LateInteractExec"].includes(String(node.op))) {
    parts.push(...pgLeafSql(node, where));
  } else parts.push(`-- unsupported op=${node.op}`);

  return [{ sql: parts.join("\n") + "\n", _sketch: true, _label: "Hypothesis", _approximate: true, _notExecuted: true }, notes];
}

export function emitPlan(physical: Record<string, unknown>, profile?: string | null): EmitResult {
  if (physical.kind !== "PhysicalPlan") {
    throw new AdapterError(`expected kind=PhysicalPlan, got ${JSON.stringify(physical.kind)}`);
  }
  const vendor = resolveVendor(physical, profile);
  const root = physical.root;
  if (!root || typeof root !== "object") throw new AdapterError("PhysicalPlan.root missing or not an object");

  let body: unknown;
  let notes: string[];
  let fmt: "json" | "sql";
  let ext: string;
  if (vendor === "qdrant") {
    [body, notes] = emitQdrant(root as Record<string, unknown>);
    fmt = "json"; ext = "request.json";
  } else if (vendor === "elasticsearch") {
    [body, notes] = emitElasticsearch(root as Record<string, unknown>);
    fmt = "json"; ext = "request.json";
  } else {
    [body, notes] = emitPgvector(root as Record<string, unknown>);
    fmt = "sql"; ext = "request.sql";
  }

  const meta = (physical.meta || {}) as Record<string, unknown>;
  return {
    schemaVersion: "0.1.0-draft-emit",
    kind: "VendorRequestSketch",
    label: "Hypothesis",
    approximate: true,
    notExecuted: true,
    vendor,
    format: fmt,
    filesuggested_ext: ext,
    notes,
    banner: SKETCH_BANNER,
    body,
    meta: {
      sourceProfileId: meta.profileId,
      logicalPlanRef: meta.logicalPlanRef,
      emitHonesty: "strings/JSON only; no live DB calls",
    },
  };
}

class SketchAdapter implements Adapter {
  name: string;
  constructor(vendor: Vendor) { this.name = vendor; }
  emit(physical: Record<string, unknown>): EmitResult {
    return emitPlan(physical, this.name);
  }
}

const adapters: Record<string, Adapter> = Object.fromEntries(
  VENDORS.map((v) => [v, new SketchAdapter(v)]),
);

export function registerAdapter(adapter: Adapter): void {
  adapters[adapter.name] = adapter;
}

/** Emit a vendor request sketch (EmitResult). No live DB I/O. */
export function emit(physical: Record<string, unknown>, options: EmitOptions = {}): EmitResult {
  const vendor = options.backend || options.profile;
  if (vendor && adapters[vendor]) return adapters[vendor]!.emit(physical);
  return emitPlan(physical, vendor);
}
