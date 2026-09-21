/**
 * Opt-in live Qdrant Query API adapter.
 * emit() stays sketch-only; execute() POSTs /collections/{name}/points/query.
 */

import { AdapterError, emitPlan, resolveVendor } from "./emit.js";
import type { EmitResult } from "./emit.js";

export const DEFAULT_QDRANT_URL = "http://localhost:6333";
const DENSE_NAME = "dense";
const SPARSE_NAME = "bm25_sparse";

export class ExecutionError extends AdapterError {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

export type ExecuteHit = {
  id: unknown;
  score: unknown;
  payload: Record<string, unknown>;
};

export type ExecuteResult = {
  schemaVersion: string;
  kind: "ExecuteResult";
  vendor: string;
  executed: true;
  collection: string;
  hits: ExecuteHit[];
  timingMs: number;
  request: Record<string, unknown>;
  notes: string[];
  meta: Record<string, unknown>;
};

export type QdrantTransport = (args: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown> | null;
  timeout?: number;
}) => Promise<{ status: number; json: Record<string, unknown> }>;

export type VectorBindings = Record<string, unknown>;

export type QdrantExecuteOptions = {
  url?: string;
  apiKey?: string;
  vectors?: VectorBindings;
  collection?: string;
  vectorNames?: Record<string, string>;
  timeout?: number;
  transport?: QdrantTransport;
};

function envUrl(): string {
  return (process.env.QDRANT_URL || DEFAULT_QDRANT_URL).replace(/\/$/, "");
}

function envApiKey(): string | undefined {
  return process.env.QDRANT_API_KEY || undefined;
}

export async function defaultTransport(args: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown> | null;
  timeout?: number;
}): Promise<{ status: number; json: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const ms = (args.timeout ?? 10) * 1000;
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(args.url, {
      method: args.method,
      headers: args.headers,
      body: args.body == null ? undefined : JSON.stringify(args.body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          json = parsed as Record<string, unknown>;
        } else {
          throw new ExecutionError("Qdrant JSON root was not an object");
        }
      } catch (err) {
        if (err instanceof ExecutionError) throw err;
        throw new ExecutionError(`Qdrant returned non-JSON: ${text.slice(0, 200)}`);
      }
    }
    if (!res.ok) {
      throw new ExecutionError(`Qdrant HTTP ${res.status}: ${text.slice(0, 800)}`);
    }
    return { status: res.status, json };
  } catch (err) {
    if (err instanceof ExecutionError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExecutionError(`Qdrant request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

function findOps(node: Record<string, unknown>, op: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  if (node.op === op) found.push(node);
  if (node.input && typeof node.input === "object") {
    found.push(...findOps(node.input as Record<string, unknown>, op));
  }
  for (const child of (node.inputs as Record<string, unknown>[] | undefined) || []) {
    if (child && typeof child === "object") found.push(...findOps(child, op));
  }
  return found;
}

function unwrapShim(node: Record<string, unknown>): [Record<string, unknown>, Record<string, unknown> | null] {
  if (node.op === "ShimCast") {
    const inner = node.input;
    if (!inner || typeof inner !== "object") throw new ExecutionError("ShimCast.input missing");
    return [inner as Record<string, unknown>, node];
  }
  return [node, null];
}

function predicateExpr(node: Record<string, unknown> | undefined): string | undefined {
  if (!node) return undefined;
  const pred = (node.predicate || {}) as Record<string, unknown>;
  return pred.expr as string | undefined;
}

const CMP =
  /([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|!=|<>|=|>|<)\s*('(?:[^']*)'|"(?:[^"]*)"|-?\d+(?:\.\d+)?)/g;

export function parseQdrantFilter(expr: string | undefined): Record<string, unknown> | null {
  if (!expr || !expr.trim()) return null;
  let leftover = expr;
  const must: Record<string, unknown>[] = [];
  const mustNot: Record<string, unknown>[] = [];
  for (const match of expr.matchAll(CMP)) {
    leftover = leftover.replace(match[0]!, " ");
    const key = match[1]!;
    const op = match[2]!;
    const raw = match[3]!;
    const value = raw[0] === "'" || raw[0] === '"'
      ? raw.slice(1, -1)
      : raw.includes(".")
        ? Number(raw)
        : parseInt(raw, 10);
    if (op === "=") must.push({ key, match: { value } });
    else if (op === "!=" || op === "<>") mustNot.push({ key, match: { value } });
    else {
      const rangeKey = ({ "<": "lt", "<=": "lte", ">": "gt", ">=": "gte" } as Record<string, string>)[op]!;
      must.push({ key, range: { [rangeKey]: value } });
    }
  }
  const residue = leftover.replace(/\bAND\b/gi, " ").replace(/[()\s]+/g, "");
  if (residue) {
    throw new ExecutionError(`filter expression is not representable as a Qdrant Filter: ${JSON.stringify(expr)}`);
  }
  if (!must.length && !mustNot.length) {
    throw new ExecutionError(`filter expression produced no clauses: ${JSON.stringify(expr)}`);
  }
  const out: Record<string, unknown> = {};
  if (must.length) out.must = must;
  if (mustNot.length) out.must_not = mustNot;
  return out;
}

function lookupVector(vectors: VectorBindings | undefined, names: string[]): unknown {
  if (!vectors) return undefined;
  for (const name of names) {
    if (vectors[name] != null) return vectors[name];
    const alt = name.startsWith("$") ? name.slice(1) : `$${name}`;
    if (vectors[alt] != null) return vectors[alt];
  }
  return undefined;
}

export function bindVector(
  ref: unknown,
  vectors: VectorBindings | undefined,
  kind: "dense" | "sparse",
): unknown {
  if (Array.isArray(ref)) return ref;
  if (ref && typeof ref === "object" && "indices" in ref && "values" in (ref as object)) {
    const s = ref as { indices: unknown[]; values: unknown[] };
    return { indices: [...s.indices], values: [...s.values] };
  }
  const names: string[] = [];
  if (typeof ref === "string") {
    names.push(ref, ref.startsWith("$") ? ref.slice(1) : `$${ref}`);
  }
  if (kind === "dense") names.push("dense", "$q_dense");
  else names.push("sparse", "bm25_sparse", "$q_sparse");
  const found = lookupVector(vectors, names);
  if (found == null) {
    throw new ExecutionError(`missing vector binding for ${JSON.stringify(ref ?? kind)} (${kind})`);
  }
  if (kind === "sparse") {
    if (!found || typeof found !== "object" || !("indices" in found) || !("values" in found)) {
      throw new ExecutionError(`sparse binding for ${JSON.stringify(ref ?? kind)} must be {indices, values}`);
    }
    const s = found as { indices: unknown[]; values: unknown[] };
    return { indices: [...s.indices], values: [...s.values] };
  }
  if (!Array.isArray(found)) {
    throw new ExecutionError(`dense binding for ${JSON.stringify(ref ?? kind)} must be a list of floats`);
  }
  return found;
}

function vectorNames(overrides?: Record<string, string>): [string, string] {
  const o = overrides || {};
  return [o.dense || o.using || DENSE_NAME, o.sparse || o.bm25 || SPARSE_NAME];
}

function collectionOf(node: Record<string, unknown>, override?: string): string {
  if (override) return override;
  for (const op of ["AnnExec", "Bm25Exec", "LateInteractExec"]) {
    for (const found of findOps(node, op)) {
      if (found.collection) return String(found.collection);
    }
  }
  return "chunks";
}

function assertNotLate(node: Record<string, unknown>): void {
  if (findOps(node, "LateInteractExec").length) {
    throw new ExecutionError(
      "LateInteractExec is not representable on the live Qdrant adapter (fail-closed: will not silently substitute dense cosine).",
    );
  }
}

function fusionFamily(node: Record<string, unknown>): string | undefined {
  if (node.op === "FusionExec") return String(node.family || "");
  return undefined;
}

function annBody(
  node: Record<string, unknown>,
  filt: Record<string, unknown> | null,
  vectors: VectorBindings | undefined,
  denseName: string,
): Record<string, unknown> {
  if (node.op !== "AnnExec") {
    throw new ExecutionError(`expected AnnExec for dense search, got ${JSON.stringify(node.op)}`);
  }
  const body: Record<string, unknown> = {
    query: bindVector(node.queryRef, vectors, "dense"),
    using: denseName,
    limit: Number(node.k || 20),
    with_payload: true,
  };
  if (filt) body.filter = filt;
  if (node.efSearch) body.params = { hnsw_ef: node.efSearch };
  return body;
}

function rrfBody(
  fuse: Record<string, unknown>,
  filt: Record<string, unknown> | null,
  vectors: VectorBindings | undefined,
  denseName: string,
  sparseName: string,
  notes: string[],
): Record<string, unknown> {
  const prefetches: Record<string, unknown>[] = [];
  let limit = 10;
  for (const child of (fuse.inputs as Record<string, unknown>[]) || []) {
    if (!child) continue;
    const lim = Number(child.k || 50);
    limit = Math.max(limit, lim);
    if (child.op === "AnnExec") {
      const pref: Record<string, unknown> = {
        query: bindVector(child.queryRef, vectors, "dense"),
        using: denseName,
        limit: lim,
      };
      if (filt) pref.filter = filt;
      if (child.efSearch) pref.params = { hnsw_ef: child.efSearch };
      prefetches.push(pref);
    } else if (child.op === "Bm25Exec") {
      const pref: Record<string, unknown> = {
        query: bindVector(undefined, vectors, "sparse"),
        using: sparseName,
        limit: lim,
      };
      if (filt) pref.filter = filt;
      prefetches.push(pref);
    } else {
      throw new ExecutionError(
        `unsupported RRF child op ${JSON.stringify(child.op)} (live adapter supports AnnExec + Bm25Exec prefetch only)`,
      );
    }
  }
  if (prefetches.length < 2) {
    throw new ExecutionError("RRF execute requires dense + sparse prefetch bindings");
  }
  notes.push(
    "FusionExec family=rrf → prefetch + query.fusion=rrf (matches emit sketch; Query API since Qdrant 1.10).",
  );
  const body: Record<string, unknown> = {
    prefetch: prefetches,
    query: { fusion: "rrf" },
    limit: Math.min(limit, 50),
    with_payload: true,
  };
  if (fuse.k_rrf != null) {
    body.params = { _rrf_k_hint: fuse.k_rrf };
    notes.push(
      `k_rrf=${fuse.k_rrf} recorded as a hint; FusionQuery {fusion: rrf} does not take k on all Qdrant versions.`,
    );
  }
  return body;
}

export function buildQueryFromPhysical(
  physical: Record<string, unknown>,
  opts: { vectors?: VectorBindings; collection?: string; vectorNames?: Record<string, string> } = {},
): { collection: string; request: Record<string, unknown>; notes: string[] } {
  if (physical.kind !== "PhysicalPlan") {
    throw new ExecutionError(`expected kind=PhysicalPlan, got ${JSON.stringify(physical.kind)}`);
  }
  const root = physical.root;
  if (!root || typeof root !== "object") throw new ExecutionError("PhysicalPlan.root missing or not an object");
  const rootObj = root as Record<string, unknown>;
  assertNotLate(rootObj);
  const notes = [
    "Live Qdrant Query API (POST /collections/{collection}/points/query).",
    "Opt-in execute path — emit() remains a notExecuted sketch.",
  ];
  const [node] = unwrapShim(rootObj);
  const filterNodes = findOps(rootObj, "FilterExec");
  const fnode = filterNodes[0];
  const filt = fnode ? parseQdrantFilter(predicateExpr(fnode)) : null;
  if (fnode) {
    notes.push(
      `FilterExec mode=${fnode.mode} applied as Query API filter (leaf-propagated PRE-style; planner mode=${fnode.mode}).`,
    );
  }
  const [denseName, sparseName] = vectorNames(opts.vectorNames);
  const collection = collectionOf(rootObj, opts.collection);

  const input = node.input && typeof node.input === "object" ? (node.input as Record<string, unknown>) : undefined;
  if (fusionFamily(node) === "rrf" || (node.op === "FilterExec" && input && fusionFamily(input) === "rrf")) {
    const fuse = node.op === "FusionExec" ? node : input!;
    return { collection, request: rrfBody(fuse, filt, opts.vectors, denseName, sparseName, notes), notes };
  }
  if (fusionFamily(node) && fusionFamily(node) !== "rrf") {
    throw new ExecutionError(
      `FusionExec family=${JSON.stringify(node.family)} is not representable on the live Qdrant adapter (RRF prefetch only).`,
    );
  }
  if (node.op === "FilterExec") {
    if (!input) throw new ExecutionError("FilterExec.input missing");
    if (input.op === "FusionExec") {
      throw new ExecutionError(
        `FusionExec family=${JSON.stringify(input.family)} is not representable on the live Qdrant adapter (RRF prefetch only).`,
      );
    }
    return { collection, request: annBody(input, filt, opts.vectors, denseName), notes };
  }
  if (node.op === "AnnExec") {
    return { collection, request: annBody(node, filt, opts.vectors, denseName), notes };
  }
  if (node.op === "Bm25Exec") {
    const body: Record<string, unknown> = {
      query: bindVector(undefined, opts.vectors, "sparse"),
      using: sparseName,
      limit: Number(node.k || 20),
      with_payload: true,
    };
    if (filt) body.filter = filt;
    notes.push("Bm25Exec → sparse Query API (named vector).");
    return { collection, request: body, notes };
  }
  throw new ExecutionError(`unsupported physical op for live Qdrant execute: ${JSON.stringify(node.op)}`);
}

function stripSketchKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripSketchKeys);
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!k.startsWith("_")) out[k] = stripSketchKeys(v);
    }
    return out;
  }
  return obj;
}

function materializeQueryField(q: unknown, vectors: VectorBindings | undefined): unknown {
  if (Array.isArray(q)) return q;
  if (!q || typeof q !== "object") return q;
  const obj = q as Record<string, unknown>;
  if ("fusion" in obj) return { fusion: obj.fusion };
  if ("rrf" in obj) return { fusion: "rrf" };
  const nearest = obj.nearest;
  if (nearest && typeof nearest === "object") {
    const n = nearest as Record<string, unknown>;
    const vecWrap = n.vector && typeof n.vector === "object" ? (n.vector as Record<string, unknown>) : n;
    const name = vecWrap.name;
    const raw = vecWrap.vector;
    if (name === "colbert_multivector" || (typeof name === "string" && name.includes("colbert"))) {
      throw new ExecutionError("late / multivector sketch is not representable on the live Qdrant adapter");
    }
    const kind: "dense" | "sparse" =
      name === SPARSE_NAME || name === "sparse" || (raw && typeof raw === "object" && ("_sketch_text" in (raw as object) || "indices" in (raw as object)))
        ? "sparse"
        : "dense";
    const bindRaw = raw && typeof raw === "object" && "_sketch_text" in (raw as object) ? undefined : raw;
    return bindVector(bindRaw, vectors, kind);
  }
  if ("indices" in obj && "values" in obj) return bindVector(obj, vectors, "sparse");
  if (obj.error || obj._unsupported || obj.unsupported) {
    throw new ExecutionError(`emit sketch is unsupported: ${JSON.stringify(obj)}`);
  }
  return obj;
}

export function buildQueryFromSketch(
  art: Record<string, unknown>,
  opts: { vectors?: VectorBindings; collection?: string; vectorNames?: Record<string, string> } = {},
): { collection: string; request: Record<string, unknown>; notes: string[] } {
  if (art.kind !== "VendorRequestSketch") {
    throw new ExecutionError(`expected kind=VendorRequestSketch, got ${JSON.stringify(art.kind)}`);
  }
  const vendor = String(art.vendor || "").toLowerCase();
  if (vendor && vendor !== "qdrant") {
    throw new ExecutionError(`cannot execute ${JSON.stringify(art.vendor)} sketch on Qdrant`);
  }
  const bodyIn = art.body;
  if (!bodyIn || typeof bodyIn !== "object") {
    throw new ExecutionError("EmitResult.body must be a Qdrant JSON object");
  }
  const rawBody = bodyIn as Record<string, unknown>;
  const q = rawBody.query;
  const nearestVec =
    q && typeof q === "object"
      ? ((q as Record<string, unknown>).nearest as Record<string, unknown> | undefined)
      : undefined;
  const nearestName =
    nearestVec && typeof nearestVec.vector === "object"
      ? (nearestVec.vector as Record<string, unknown>).name
      : undefined;
  if (rawBody._late_variant || nearestName === "colbert_multivector") {
    throw new ExecutionError(
      "LateInteractExec sketch is not representable on the live Qdrant adapter (fail-closed).",
    );
  }
  if (q && typeof q === "object" && ((q as Record<string, unknown>).error || (q as Record<string, unknown>)._unsupported)) {
    throw new ExecutionError(`emit sketch is unsupported: ${JSON.stringify(q)}`);
  }
  const notes = ["Live execute from VendorRequestSketch — placeholders bound, sketch flags stripped."];
  const [denseName, sparseName] = vectorNames(opts.vectorNames);
  const collection = opts.collection || String(rawBody.collection || "chunks");
  const cleaned = stripSketchKeys(rawBody) as Record<string, unknown>;
  delete cleaned.collection;
  if (cleaned.prefetch) {
    const prefetches: Record<string, unknown>[] = [];
    for (const pref of (cleaned.prefetch as Record<string, unknown>[]) || []) {
      if (!pref || typeof pref !== "object") continue;
      if (pref._unsupported_child) throw new ExecutionError(`unsupported prefetch child: ${JSON.stringify(pref)}`);
      const pq = materializeQueryField(pref.query, opts.vectors);
      const using =
        (pref.using as string | undefined) ||
        (pq && typeof pq === "object" && "indices" in (pq as object) ? sparseName : denseName);
      const item: Record<string, unknown> = { ...pref, query: pq, using };
      delete item._unsupported_child;
      prefetches.push(item);
    }
    cleaned.prefetch = prefetches;
    cleaned.query = { fusion: "rrf" };
    notes.push("Sketch prefetch + fusion=rrf materialized with bound vectors.");
  } else {
    cleaned.query = materializeQueryField(cleaned.query, opts.vectors);
    if (cleaned.using == null) {
      cleaned.using =
        cleaned.query && typeof cleaned.query === "object" && "indices" in (cleaned.query as object)
          ? sparseName
          : denseName;
    }
  }
  cleaned.with_payload = true;
  if (cleaned.params && typeof cleaned.params === "object") {
    const params = Object.fromEntries(
      Object.entries(cleaned.params as Record<string, unknown>).filter(([k]) => !k.startsWith("_")),
    );
    if (Object.keys(params).length) cleaned.params = params;
    else delete cleaned.params;
  }
  return { collection, request: cleaned, notes };
}

export function parseHits(payload: Record<string, unknown>): ExecuteHit[] {
  const result = payload.result;
  let points: unknown[] = [];
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    const raw = r.points ?? r.result ?? [];
    points = Array.isArray(raw) ? raw : [];
  } else if (Array.isArray(result)) {
    points = result;
  }
  const hits: ExecuteHit[] = [];
  for (const p of points) {
    if (!p || typeof p !== "object") continue;
    const row = p as Record<string, unknown>;
    hits.push({
      id: row.id,
      score: row.score,
      payload: (row.payload as Record<string, unknown>) || {},
    });
  }
  return hits;
}

export class QdrantAdapter {
  name = "qdrant";
  url: string;
  apiKey?: string;
  transport?: QdrantTransport;
  timeout: number;

  constructor(opts: { url?: string; apiKey?: string; transport?: QdrantTransport; timeout?: number } = {}) {
    this.url = (opts.url || envUrl()).replace(/\/$/, "");
    this.apiKey = opts.apiKey !== undefined ? opts.apiKey : envApiKey();
    this.transport = opts.transport;
    this.timeout = opts.timeout ?? 10;
  }

  emit(physical: Record<string, unknown>): EmitResult {
    return emitPlan(physical, "qdrant");
  }

  headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) headers["api-key"] = this.apiKey;
    return headers;
  }

  async request(method: string, path: string, body?: Record<string, unknown> | null): Promise<{ status: number; json: Record<string, unknown> }> {
    const url = `${this.url}${path}`;
    const transport = this.transport ?? defaultTransport;
    return transport({ method, url, headers: this.headers(), body, timeout: this.timeout });
  }

  async adminPut(path: string, body?: Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const { json } = await this.request("PUT", path, body ?? null);
    return json;
  }

  async adminDelete(path: string): Promise<Record<string, unknown> | null> {
    try {
      const { json } = await this.request("DELETE", path, null);
      return json;
    } catch {
      return null;
    }
  }

  async execute(planOrEmit: Record<string, unknown>, opts: QdrantExecuteOptions = {}): Promise<ExecuteResult> {
    const kind = planOrEmit.kind;
    let collection: string;
    let request: Record<string, unknown>;
    let notes: string[];
    if (kind === "PhysicalPlan") {
      const vendor = resolveVendor(planOrEmit, "qdrant");
      if (vendor !== "qdrant") throw new ExecutionError(`plan vendor ${JSON.stringify(vendor)} is not qdrant`);
      ({ collection, request, notes } = buildQueryFromPhysical(planOrEmit, {
        vectors: opts.vectors,
        collection: opts.collection,
        vectorNames: opts.vectorNames,
      }));
    } else if (kind === "VendorRequestSketch") {
      ({ collection, request, notes } = buildQueryFromSketch(planOrEmit, {
        vectors: opts.vectors,
        collection: opts.collection,
        vectorNames: opts.vectorNames,
      }));
    } else {
      throw new ExecutionError(`execute expects PhysicalPlan or VendorRequestSketch, got ${JSON.stringify(kind)}`);
    }
    const path = `/collections/${encodeURIComponent(collection)}/points/query`;
    const t0 = performance.now();
    const { json } = await this.request("POST", path, request);
    const timingMs = performance.now() - t0;
    return {
      schemaVersion: "0.1.0-draft-execute",
      kind: "ExecuteResult",
      vendor: "qdrant",
      executed: true,
      collection,
      hits: parseHits(json),
      timingMs,
      request,
      notes,
      meta: {
        url: this.url,
        endpoint: `POST ${path}`,
        qdrantTime: json.time,
        status: json.status,
      },
    };
  }
}
