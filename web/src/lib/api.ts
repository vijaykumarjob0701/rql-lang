import type { Connection } from "./storage";

export type QdrantCollection = {
  name: string;
};

export type PayloadIndex = {
  field: string;
  dataType: string;
};

export type CollectionInfo = {
  name: string;
  pointsCount: number | null;
  vectors: unknown;
  sparseVectors: unknown;
  status: string;
  payloadIndexes: PayloadIndex[];
  raw: Record<string, unknown>;
};

export type InstanceHealth = {
  version: string | null;
  title: string | null;
  ready: string;
  live: string;
  cluster: unknown;
};

export type ScrollPoint = {
  id: unknown;
  payload: Record<string, unknown>;
  vector: unknown;
};

export type RqlExplainResponse = {
  logical: Record<string, unknown>;
  physical: Record<string, unknown>;
  text: string;
  object: Record<string, unknown>;
};

export type RqlEmitResponse = {
  logical: Record<string, unknown>;
  physical: Record<string, unknown>;
  sketch: Record<string, unknown>;
};

export type RqlExecuteResponse = {
  logical: Record<string, unknown>;
  physical: Record<string, unknown>;
  result: {
    hits: { id: unknown; score: unknown; payload: Record<string, unknown> }[];
    timingMs: number;
    request: Record<string, unknown>;
    notes: string[];
    collection: string;
    executed: true;
  };
};

export type ApiError = {
  error: string;
  name: string;
  status: number;
  logical?: Record<string, unknown>;
  physical?: Record<string, unknown>;
};

function connHeaders(conn: Connection): Record<string, string> {
  const headers: Record<string, string> = {
    "x-qdrant-url": conn.url,
  };
  if (conn.apiKey) headers["x-qdrant-api-key"] = conn.apiKey;
  return headers;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw { error: text.slice(0, 400) || res.statusText, name: "HttpError", status: res.status } satisfies ApiError;
  }
}

function asError(body: unknown, status: number): ApiError {
  if (body && typeof body === "object" && "error" in body) {
    const b = body as {
      error: unknown;
      name?: unknown;
      logical?: Record<string, unknown>;
      physical?: Record<string, unknown>;
    };
    return {
      error: String(b.error),
      name: String(b.name || "Error"),
      status,
      logical: b.logical,
      physical: b.physical,
    };
  }
  if (body && typeof body === "object" && "status" in body) {
    const b = body as { status?: { error?: string }; result?: { status?: { error?: string } } };
    const msg = b.status?.error || b.result?.status?.error;
    if (msg) return { error: msg, name: "QdrantError", status };
  }
  return { error: `HTTP ${status}`, name: "HttpError", status };
}

export async function qdrantRequest(
  conn: Connection,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; text: string }> {
  const headers: Record<string, string> = { ...connHeaders(conn) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api/qdrant${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    throw asError(json ?? { error: text.slice(0, 400) || res.statusText }, res.status);
  }
  return { status: res.status, json, text };
}

export async function qdrantGet(conn: Connection, path: string): Promise<unknown> {
  const { json, text } = await qdrantRequest(conn, "GET", path);
  return json ?? text;
}

export async function qdrantPost(conn: Connection, path: string, body: unknown): Promise<unknown> {
  return (await qdrantRequest(conn, "POST", path, body)).json;
}

export async function qdrantPut(conn: Connection, path: string, body: unknown): Promise<unknown> {
  return (await qdrantRequest(conn, "PUT", path, body)).json;
}

export async function qdrantDelete(conn: Connection, path: string, body?: unknown): Promise<unknown> {
  return (await qdrantRequest(conn, "DELETE", path, body)).json;
}

export function parsePayloadIndexes(result: Record<string, unknown>): PayloadIndex[] {
  const schema = (result.payload_schema || result.payloadSchema || {}) as Record<string, unknown>;
  return Object.entries(schema)
    .map(([field, spec]) => {
      if (spec && typeof spec === "object" && "data_type" in spec) {
        return { field, dataType: String((spec as { data_type: unknown }).data_type) };
      }
      if (typeof spec === "string") return { field, dataType: spec };
      return { field, dataType: "unknown" };
    })
    .sort((a, b) => a.field.localeCompare(b.field));
}

export function buildUpsertPoints(input: {
  id: string | number;
  payload: Record<string, unknown>;
  dense: number[];
  sparse?: { indices: number[]; values: number[] };
}): { points: Record<string, unknown>[] } {
  const vector: Record<string, unknown> = { dense: input.dense };
  if (input.sparse) vector.bm25_sparse = input.sparse;
  return { points: [{ id: input.id, vector, payload: input.payload }] };
}

export async function listCollections(conn: Connection): Promise<QdrantCollection[]> {
  const json = (await qdrantGet(conn, "/collections")) as {
    result?: { collections?: { name: string }[] };
  };
  return json.result?.collections ?? [];
}

export async function getCollection(conn: Connection, name: string): Promise<CollectionInfo> {
  const json = (await qdrantGet(conn, `/collections/${encodeURIComponent(name)}`)) as {
    result?: Record<string, unknown>;
  };
  const result = json.result || {};
  const config = (result.config || {}) as Record<string, unknown>;
  const params = (config.params || {}) as Record<string, unknown>;
  const points =
    (typeof result.points_count === "number" ? result.points_count : null) ??
    (typeof result.pointsCount === "number" ? result.pointsCount : null);
  return {
    name,
    pointsCount: points,
    vectors: params.vectors ?? null,
    sparseVectors: params.sparse_vectors ?? params.sparseVectors ?? null,
    status: String(result.status ?? "unknown"),
    payloadIndexes: parsePayloadIndexes(result),
    raw: result,
  };
}

export async function scrollPoints(
  conn: Connection,
  name: string,
  limit = 120,
  offset = 0,
): Promise<ScrollPoint[]> {
  const json = (await qdrantPost(conn, `/collections/${encodeURIComponent(name)}/points/scroll`, {
    limit,
    offset,
    with_payload: true,
    with_vector: true,
  })) as { result?: { points?: Record<string, unknown>[] } };
  const points = json.result?.points ?? [];
  return points.map((p) => ({
    id: p.id,
    payload: (p.payload as Record<string, unknown>) || {},
    vector: p.vector,
  }));
}

export async function upsertPoints(
  conn: Connection,
  name: string,
  body: { points: Record<string, unknown>[] },
): Promise<unknown> {
  return qdrantPut(conn, `/collections/${encodeURIComponent(name)}/points?wait=true`, body);
}

export async function deletePoints(conn: Connection, name: string, ids: Array<string | number>): Promise<unknown> {
  return qdrantPost(conn, `/collections/${encodeURIComponent(name)}/points/delete?wait=true`, {
    points: ids,
  });
}

export async function retrievePoints(
  conn: Connection,
  name: string,
  ids: Array<string | number>,
): Promise<ScrollPoint[]> {
  const json = (await qdrantPost(conn, `/collections/${encodeURIComponent(name)}/points`, {
    ids,
    with_payload: true,
    with_vector: true,
  })) as { result?: Record<string, unknown>[] };
  const points = json.result ?? [];
  return points.map((p) => ({
    id: p.id,
    payload: (p.payload as Record<string, unknown>) || {},
    vector: p.vector,
  }));
}

export async function createPayloadIndex(
  conn: Connection,
  name: string,
  field: string,
  schema: string,
): Promise<unknown> {
  return qdrantPut(conn, `/collections/${encodeURIComponent(name)}/index?wait=true`, {
    field_name: field,
    field_schema: schema,
  });
}

export async function deletePayloadIndex(conn: Connection, name: string, field: string): Promise<unknown> {
  return qdrantDelete(conn, `/collections/${encodeURIComponent(name)}/index/${encodeURIComponent(field)}`);
}

export async function getInstanceHealth(conn: Connection): Promise<InstanceHealth> {
  let version: string | null = null;
  let title: string | null = null;
  try {
    const root = (await qdrantGet(conn, "/")) as { version?: string; title?: string };
    if (root && typeof root === "object") {
      version = root.version ?? null;
      title = root.title ?? null;
    }
  } catch {
    version = null;
  }
  const ready = await qdrantRequest(conn, "GET", "/readyz")
    .then((r) => r.text || JSON.stringify(r.json))
    .catch((err) => formatError(err));
  const live = await qdrantRequest(conn, "GET", "/livez")
    .then((r) => r.text || JSON.stringify(r.json))
    .catch((err) => formatError(err));
  let cluster: unknown = null;
  try {
    cluster = await qdrantGet(conn, "/cluster");
  } catch (err) {
    cluster = { error: formatError(err) };
  }
  return { version, title, ready, live, cluster };
}

async function rqlPost<T>(action: string, body: Record<string, unknown>, conn?: Connection): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (conn) Object.assign(headers, connHeaders(conn));
  const res = await fetch(`/api/rql/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok) throw asError(json, res.status);
  return json as T;
}

export function explainRql(rql: string, profile = "qdrant"): Promise<RqlExplainResponse> {
  return rqlPost("explain", { rql, profile });
}

export function emitRql(rql: string, profile = "qdrant"): Promise<RqlEmitResponse> {
  return rqlPost("emit", { rql, profile, backend: profile });
}

export function executeRql(args: {
  rql: string;
  conn: Connection;
  vectors: Record<string, unknown>;
  collection?: string;
  profile?: string;
}): Promise<RqlExecuteResponse> {
  return rqlPost(
    "execute",
    {
      rql: args.rql,
      profile: args.profile ?? "qdrant",
      vectors: args.vectors,
      collection: args.collection,
      url: args.conn.url,
      apiKey: args.conn.apiKey,
    },
    args.conn,
  );
}

export function isApiError(err: unknown): err is ApiError {
  return Boolean(err && typeof err === "object" && "error" in err && "name" in err);
}

export function formatError(err: unknown): string {
  if (isApiError(err)) return `${err.name}: ${err.error}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
