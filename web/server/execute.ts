/**
 * Studio-owned live Qdrant execute path.
 *
 * The library on `main` exposes parse / compile / explain / emit only.
 * Live `execute` lives on an unmerged adapter PR — this module mirrors that
 * fail-closed contract so Studio can run queries without modifying `javascript/`.
 */

export class ExecutionError extends Error {
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

export type VectorBindings = Record<string, unknown>;

const DENSE_NAME = "dense";
const SPARSE_NAME = "bm25_sparse";

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

function unwrapShim(node: Record<string, unknown>): Record<string, unknown> {
  if (node.op === "ShimCast") {
    const inner = node.input;
    if (!inner || typeof inner !== "object") throw new ExecutionError("ShimCast.input missing");
    return inner as Record<string, unknown>;
  }
  return node;
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
    const value =
      raw[0] === "'" || raw[0] === '"'
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
  if (kind === "dense") names.push("$q_dense", "q_dense", "dense", "vector");
  else names.push("$q_sparse", "q_sparse", "sparse", "bm25", "$q_bm25");

  const found = lookupVector(vectors, names);
  if (found == null) {
    throw new ExecutionError(
      kind === "dense"
        ? "missing dense query vector — paste a JSON number array, upload a file, or use the labeled demo vector"
        : "missing sparse query vector — hybrid RRF execute needs { indices, values } (no silent BM25 skip)",
    );
  }
  if (kind === "dense") {
    if (!Array.isArray(found) || !found.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new ExecutionError("dense vector must be a JSON array of finite numbers");
    }
    return found;
  }
  if (found && typeof found === "object" && "indices" in found && "values" in found) return found;
  throw new ExecutionError("sparse vector must be { indices: number[], values: number[] }");
}

function assertNotLate(node: Record<string, unknown>): void {
  for (const late of findOps(node, "LateInteractExec")) {
    throw new ExecutionError(
      `LateInteractExec (variant=${String(late.variant ?? "colbert")}) is not executed by RQL Studio — fail-closed, no silent dense substitute.`,
    );
  }
}

function fusionFamily(node: Record<string, unknown>): string | undefined {
  if (node.op === "FusionExec") return String(node.family || "");
  return undefined;
}

function collectionOf(node: Record<string, unknown>, override?: string): string {
  if (override && override.trim()) return override.trim();
  for (const ann of findOps(node, "AnnExec")) {
    if (ann.collection) return String(ann.collection);
  }
  for (const bm of findOps(node, "Bm25Exec")) {
    if (bm.collection) return String(bm.collection);
  }
  return "chunks";
}

function vectorNames(names?: Record<string, string>): [string, string] {
  return [names?.dense || DENSE_NAME, names?.sparse || SPARSE_NAME];
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
        `unsupported RRF child op ${JSON.stringify(child.op)} (Studio execute supports AnnExec + Bm25Exec prefetch only)`,
      );
    }
  }
  if (prefetches.length < 2) {
    throw new ExecutionError("RRF execute requires dense + sparse prefetch bindings");
  }
  notes.push("FusionExec family=rrf → prefetch + query.fusion=rrf.");
  return {
    prefetch: prefetches,
    query: { fusion: "rrf" },
    limit: Math.min(limit, 50),
    with_payload: true,
  };
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
    "Studio execute path — library emit() remains a notExecuted sketch. Library execute() is not on main yet.",
  ];
  const node = unwrapShim(rootObj);
  const filterNodes = findOps(rootObj, "FilterExec");
  const fnode = filterNodes[0];
  const filt = fnode ? parseQdrantFilter(predicateExpr(fnode)) : null;
  if (fnode) {
    notes.push(`FilterExec mode=${String(fnode.mode)} applied as a Query API filter.`);
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
      `FusionExec family=${JSON.stringify(node.family)} is not representable (RRF only). Linear fusion fails closed.`,
    );
  }
  if (node.op === "FilterExec") {
    if (!input) throw new ExecutionError("FilterExec.input missing");
    if (input.op === "FusionExec") {
      throw new ExecutionError(
        `FusionExec family=${JSON.stringify(input.family)} is not representable (RRF prefetch only).`,
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

export async function executeAgainstQdrant(args: {
  physical: Record<string, unknown>;
  vectors?: VectorBindings;
  collection?: string;
  url: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<ExecuteResult> {
  const { collection, request, notes } = buildQueryFromPhysical(args.physical, {
    vectors: args.vectors,
    collection: args.collection,
  });
  const base = args.url.replace(/\/$/, "");
  const path = `/collections/${encodeURIComponent(collection)}/points/query`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (args.apiKey) headers["api-key"] = args.apiKey;
  const t0 = performance.now();
  const fetchImpl = args.fetchImpl ?? fetch;
  const res = await fetchImpl(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ExecutionError("Qdrant JSON root was not an object");
      }
      json = parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof ExecutionError) throw err;
      throw new ExecutionError(`Qdrant returned non-JSON: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    throw new ExecutionError(`Qdrant HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  return {
    schemaVersion: "0.1.0-draft-execute",
    kind: "ExecuteResult",
    vendor: "qdrant",
    executed: true,
    collection,
    hits: parseHits(json),
    timingMs: performance.now() - t0,
    request,
    notes,
    meta: {
      endpoint: `POST ${path}`,
      qdrantTime: json.time,
      status: json.status,
    },
  };
}
