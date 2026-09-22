import type { Connection } from "./storage";

export type QdrantCollection = {
  name: string;
};

export type CollectionInfo = {
  name: string;
  pointsCount: number | null;
  vectors: unknown;
  status: string;
  raw: Record<string, unknown>;
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
    const b = body as { error: unknown; name?: unknown };
    return { error: String(b.error), name: String(b.name || "Error"), status };
  }
  if (body && typeof body === "object" && "status" in body) {
    const b = body as { status?: { error?: string }; result?: { status?: { error?: string } } };
    const msg = b.status?.error || b.result?.status?.error;
    if (msg) return { error: msg, name: "QdrantError", status };
  }
  return { error: `HTTP ${status}`, name: "HttpError", status };
}

export async function qdrantGet(conn: Connection, path: string): Promise<unknown> {
  const res = await fetch(`/api/qdrant${path}`, { headers: connHeaders(conn) });
  const body = await readJson(res);
  if (!res.ok) throw asError(body, res.status);
  return body;
}

export async function qdrantPost(conn: Connection, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`/api/qdrant${path}`, {
    method: "POST",
    headers: { ...connHeaders(conn), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok) throw asError(json, res.status);
  return json;
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
    status: String(result.status ?? "unknown"),
    raw: result,
  };
}

export async function scrollPoints(
  conn: Connection,
  name: string,
  limit = 120,
): Promise<ScrollPoint[]> {
  const json = (await qdrantPost(conn, `/collections/${encodeURIComponent(name)}/points/scroll`, {
    limit,
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
