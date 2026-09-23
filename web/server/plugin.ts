import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { compile, emit, explain, parse } from "@vijaykumarjob0701/rql";
import { ExecutionError, executeAgainstQdrant } from "./execute";
import { executeAgainstPgvector } from "./executePg";
import {
  deleteChunk,
  exampleCatalog,
  listPgIndexes,
  listTableStats,
  pgHealth,
  runPgExample,
  scrollChunks,
  upsertChunk,
} from "./pgAdmin";
import { pgQuery } from "./pgPool";
import { redactDatabaseUrl, resolvePgTarget } from "./pgTarget";
import { resolveQdrantApiKey, resolveQdrantTarget } from "./qdrantTarget";

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function rqlErrorPayload(err: unknown): { error: string; name: string } {
  if (err && typeof err === "object" && "name" in err && "message" in err) {
    const e = err as { name: string; message: string };
    return { error: e.message, name: e.name || "Error" };
  }
  return { error: String(err), name: "Error" };
}

async function handleRql(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "POST required", name: "MethodError" });
    return;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: "invalid JSON body", name: "RequestError" });
    return;
  }
  const rql = String(payload.rql ?? "");
  const profile = String(payload.profile ?? "qdrant");
  const backend = String(payload.backend ?? profile);
  try {
    const logical = parse(rql);
    if (action === "parse") {
      sendJson(res, 200, { logical });
      return;
    }
    const physical = compile(logical, { profile });
    if (action === "compile") {
      sendJson(res, 200, { logical, physical });
      return;
    }
    if (action === "explain") {
      const text = explain(physical);
      const object = explain(physical, { format: "object" });
      sendJson(res, 200, { logical, physical, text, object });
      return;
    }
    if (action === "emit") {
      const sketch = emit(physical, { backend });
      sendJson(res, 200, { logical, physical, sketch });
      return;
    }
    if (action === "execute") {
      const collection = payload.collection ? String(payload.collection) : undefined;
      const vectors = (payload.vectors as Record<string, unknown> | undefined) ?? undefined;
      const usePg = backend === "pgvector" || profile === "pgvector";
      try {
        const result = usePg
          ? await executeAgainstPgvector({
              physical,
              vectors,
              collection,
              query: pgQuery(resolvePgUrl(req, payload)),
            })
          : await executeAgainstQdrant({
              physical,
              vectors,
              collection,
              url: resolveQdrantTarget(String(payload.url ?? header(req, "x-qdrant-url") ?? "")),
              apiKey: resolveQdrantApiKey(String(payload.apiKey ?? header(req, "x-qdrant-api-key") ?? "")),
            });
        sendJson(res, 200, { logical, physical, result });
      } catch (err) {
        sendJson(res, err instanceof ExecutionError ? 422 : 400, {
          ...rqlErrorPayload(err),
          logical,
          physical,
        });
      }
      return;
    }
    sendJson(res, 404, { error: `unknown rql action ${action}`, name: "RequestError" });
  } catch (err) {
    const status = err instanceof ExecutionError ? 422 : 400;
    sendJson(res, status, rqlErrorPayload(err));
  }
}

async function handleQdrantProxy(req: IncomingMessage, res: ServerResponse, restPath: string): Promise<void> {
  let targetBase: string;
  try {
    targetBase = resolveQdrantTarget(header(req, "x-qdrant-url"));
  } catch {
    sendJson(res, 400, { error: "missing x-qdrant-url header", name: "RequestError" });
    return;
  }
  let target: URL;
  try {
    target = new URL(restPath.startsWith("/") ? restPath : `/${restPath}`, `${targetBase}/`);
  } catch {
    sendJson(res, 400, { error: "invalid x-qdrant-url", name: "RequestError" });
    return;
  }
  if (req.url && req.url.includes("?")) {
    const q = req.url.slice(req.url.indexOf("?"));
    target.search = q.startsWith("?") ? q : `?${q}`;
  }

  const apiKey = resolveQdrantApiKey(header(req, "x-qdrant-api-key"));
  const outgoing: Record<string, string> = {
    Accept: "application/json",
  };
  const ct = header(req, "content-type");
  if (ct) outgoing["Content-Type"] = ct;
  if (apiKey) outgoing["api-key"] = apiKey;

  const method = req.method || "GET";
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const raw = await readBody(req);
    if (raw) body = Buffer.from(raw);
  }

  try {
    const upstream = await fetch(target.toString(), {
      method,
      headers: outgoing,
      body,
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (!HOP.has(key.toLowerCase())) res.setHeader(key, value);
    });
    res.setHeader("Cache-Control", "no-store");
    res.end(buf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 502, { error: `Qdrant proxy failed: ${msg}`, name: "ProxyError" });
  }
}

function resolvePgUrl(req: IncomingMessage, payload?: Record<string, unknown>): string {
  return resolvePgTarget(String(payload?.pgUrl ?? payload?.url ?? header(req, "x-pg-url") ?? ""));
}

async function handlePg(req: IncomingMessage, res: ServerResponse, restPath: string): Promise<void> {
  let url: string;
  try {
    url = resolvePgUrl(req);
  } catch {
    sendJson(res, 400, { error: "missing Postgres url", name: "RequestError" });
    return;
  }
  const query = pgQuery(url);
  const path = restPath.replace(/\/$/, "") || "/";
  try {
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      sendJson(res, 200, { ...await pgHealth(query), redactedUrl: redactDatabaseUrl(url) });
      return;
    }
    if (req.method === "GET" && path === "/tables") {
      sendJson(res, 200, { tables: await listTableStats(query) });
      return;
    }
    if (req.method === "GET" && path === "/indexes") {
      sendJson(res, 200, { indexes: await listPgIndexes(query) });
      return;
    }
    if (req.method === "GET" && path === "/examples") {
      sendJson(res, 200, { examples: exampleCatalog() });
      return;
    }
    if (req.method === "GET" && path === "/chunks") {
      const rawLimit = Number(new URL(req.url || "/", "http://studio.local").searchParams.get("limit") || 160);
      sendJson(res, 200, { points: await scrollChunks(query, rawLimit) });
      return;
    }
    let payload: Record<string, unknown> = {};
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        payload = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: "invalid JSON body", name: "RequestError" });
        return;
      }
    }
    if (req.method === "POST" && path === "/examples/run") {
      const id = String(payload.id ?? "");
      const vector = Array.isArray(payload.vector) ? (payload.vector as number[]) : undefined;
      sendJson(res, 200, await runPgExample(query, id, vector));
      return;
    }
    if (req.method === "POST" && path === "/chunks/upsert") {
      await upsertChunk(query, {
        id: String(payload.id ?? ""),
        payload: (payload.payload as Record<string, unknown>) || {},
        dense: (payload.dense as number[]) || [],
      });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && path === "/chunks/delete") {
      const deleted = await deleteChunk(query, String(payload.id ?? ""));
      sendJson(res, 200, { deleted });
      return;
    }
    sendJson(res, 404, { error: `unknown pg route ${path}`, name: "RequestError" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 502, { error: `Postgres demo API: ${msg}`, name: "PgError" });
  }
}

function mount(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const url = req.url || "";
  const pathOnly = url.split("?")[0] || "";
  if (pathOnly.startsWith("/api/pg")) {
    const rest = pathOnly.slice("/api/pg".length) || "/";
    void handlePg(req, res, rest).catch((err) => {
      sendJson(res, 500, rqlErrorPayload(err));
    });
    return;
  }
  if (pathOnly.startsWith("/api/rql/")) {
    const action = pathOnly.slice("/api/rql/".length).replace(/\/$/, "");
    void handleRql(req, res, action).catch((err) => {
      sendJson(res, 500, rqlErrorPayload(err));
    });
    return;
  }
  if (pathOnly === "/api/rql" || pathOnly === "/api/rql/") {
    sendJson(res, 404, { error: "use /api/rql/{parse,compile,explain,emit,execute}", name: "RequestError" });
    return;
  }
  if (pathOnly.startsWith("/api/qdrant")) {
    const rest = pathOnly.slice("/api/qdrant".length) || "/";
    void handleQdrantProxy(req, res, rest).catch((err) => {
      sendJson(res, 500, rqlErrorPayload(err));
    });
    return;
  }
  next();
}

export function studioApiPlugin(): Plugin {
  return {
    name: "rql-studio-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        mount(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        mount(req, res, next);
      });
    },
  };
}
