#!/usr/bin/env node
/**
 * In-memory Qdrant-shaped HTTP server for local Studio demos when Docker
 * is unavailable. Speaks a subset of GET/PUT /collections and
 * POST /points/scroll + /points/query. Not a Qdrant substitute.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.QDRANT_PORT || 6333);
const store = new Map();

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function getDense(point, using) {
  const v = point.vector;
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    if (using && Array.isArray(v[using])) return v[using];
    const first = Object.values(v).find((x) => Array.isArray(x));
    return first || null;
  }
  return null;
}

function matchFilter(payload, filter) {
  if (!filter) return true;
  const must = filter.must || [];
  const mustNot = filter.must_not || [];
  const ok = (clause) => {
    const key = clause.key;
    const val = payload[key];
    if (clause.match) return val === clause.match.value;
    if (clause.range) {
      const r = clause.range;
      if (r.gte != null && !(val >= r.gte)) return false;
      if (r.gt != null && !(val > r.gt)) return false;
      if (r.lte != null && !(val <= r.lte)) return false;
      if (r.lt != null && !(val < r.lt)) return false;
      return true;
    }
    return true;
  };
  return must.every(ok) && !mustNot.some(ok);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/collections") {
      send(res, 200, {
        result: { collections: [...store.keys()].map((name) => ({ name })) },
        status: "ok",
        time: 0,
      });
      return;
    }
    const collMatch = /^\/collections\/([^/]+)$/.exec(path);
    if (collMatch && req.method === "GET") {
      const name = decodeURIComponent(collMatch[1]);
      const col = store.get(name);
      if (!col) {
        send(res, 404, { status: { error: `collection ${name} not found` } });
        return;
      }
      send(res, 200, {
        result: {
          status: "green",
          points_count: col.points.length,
          config: { params: { vectors: col.vectors } },
        },
        time: 0,
      });
      return;
    }
    if (collMatch && req.method === "PUT") {
      const name = decodeURIComponent(collMatch[1]);
      const body = JSON.parse((await readBody(req)) || "{}");
      store.set(name, { vectors: body.vectors || { size: 128, distance: "Cosine" }, points: [] });
      send(res, 200, { result: true, status: "ok", time: 0 });
      return;
    }
    if (collMatch && req.method === "DELETE") {
      store.delete(decodeURIComponent(collMatch[1]));
      send(res, 200, { result: true, status: "ok", time: 0 });
      return;
    }
    const pointsMatch = /^\/collections\/([^/]+)\/points$/.exec(path);
    if (pointsMatch && req.method === "PUT") {
      const name = decodeURIComponent(pointsMatch[1]);
      const col = store.get(name);
      if (!col) {
        send(res, 404, { status: { error: `collection ${name} not found` } });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      for (const p of body.points || []) {
        const idx = col.points.findIndex((x) => String(x.id) === String(p.id));
        if (idx >= 0) col.points[idx] = p;
        else col.points.push(p);
      }
      send(res, 200, { result: { status: "ok" }, time: 0 });
      return;
    }
    const scrollMatch = /^\/collections\/([^/]+)\/points\/scroll$/.exec(path);
    if (scrollMatch && req.method === "POST") {
      const name = decodeURIComponent(scrollMatch[1]);
      const col = store.get(name);
      if (!col) {
        send(res, 404, { status: { error: `collection ${name} not found` } });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const limit = Number(body.limit || 10);
      send(res, 200, {
        result: { points: col.points.slice(0, limit), next_page_offset: null },
        time: 0,
      });
      return;
    }
    const queryMatch = /^\/collections\/([^/]+)\/points\/query$/.exec(path);
    if (queryMatch && req.method === "POST") {
      const name = decodeURIComponent(queryMatch[1]);
      const col = store.get(name);
      if (!col) {
        send(res, 404, { status: { error: `collection ${name} not found` } });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      if (body.prefetch || (body.query && typeof body.query === "object" && !Array.isArray(body.query))) {
        send(res, 400, {
          status: { error: "mock-qdrant only implements dense query arrays (no RRF/fusion)" },
        });
        return;
      }
      const q = body.query;
      if (!Array.isArray(q)) {
        send(res, 400, { status: { error: "mock-qdrant expects query to be a dense number array" } });
        return;
      }
      const using = body.using;
      const scored = col.points
        .filter((p) => matchFilter(p.payload || {}, body.filter))
        .map((p) => {
          const vec = getDense(p, using);
          return { id: p.id, score: vec ? cosine(q, vec) : 0, payload: p.payload || {} };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, Number(body.limit || 10));
      send(res, 200, { result: { points: scored }, time: 0.001 });
      return;
    }
    send(res, 404, { status: { error: `mock-qdrant: no route ${req.method} ${path}` } });
  } catch (err) {
    send(res, 500, { status: { error: String(err) } });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-qdrant listening on http://127.0.0.1:${PORT} (in-memory, not real Qdrant)`);
});
