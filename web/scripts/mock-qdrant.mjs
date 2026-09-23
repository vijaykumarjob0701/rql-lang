#!/usr/bin/env node
/**
 * In-memory Qdrant-shaped HTTP server for Studio demos when Docker is absent.
 * Not a Qdrant substitute. Implements collections, points CRUD, scroll, query
 * (dense + toy RRF), payload indexes, and health/cluster.
 */
import { createServer } from "node:http";
import { collectionBody, generateAllCollections } from "./demo-data.mjs";

const PORT = Number(process.env.QDRANT_PORT || 6333);
const store = new Map();

function seedDemoCollections() {
  const body = collectionBody();
  for (const bundle of generateAllCollections()) {
    store.set(bundle.name, {
      vectors: body.vectors,
      sparseVectors: body.sparse_vectors || {},
      points: bundle.points,
      indexes: Object.fromEntries(
        bundle.indexes.map(([field, schema]) => [field, { data_type: schema }]),
      ),
    });
  }
}

seedDemoCollections();

function send(res, status, body, contentType = "application/json") {
  if (typeof body === "string") {
    res.writeHead(status, { "Content-Type": contentType });
    res.end(body);
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
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

function sparseDot(a, b) {
  if (!a || !b) return 0;
  const map = new Map((a.indices || []).map((idx, i) => [idx, a.values[i] || 0]));
  let s = 0;
  for (let i = 0; i < (b.indices || []).length; i++) {
    const idx = b.indices[i];
    if (map.has(idx)) s += map.get(idx) * (b.values[i] || 0);
  }
  return s;
}

function getNamed(point, using) {
  const v = point.vector;
  if (!v) return null;
  if (using && v && typeof v === "object" && !Array.isArray(v)) return v[using] ?? null;
  if (Array.isArray(v)) return using && using !== "dense" ? null : v;
  if (v && typeof v === "object") {
    if (using && v[using]) return v[using];
    return Object.values(v).find((x) => Array.isArray(x)) || null;
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

function ensureCol(name) {
  return store.get(name);
}

function collectionInfo(name, col) {
  return {
    status: "green",
    points_count: col.points.length,
    config: { params: { vectors: col.vectors, sparse_vectors: col.sparseVectors || {} } },
    payload_schema: col.indexes,
  };
}

function rankDense(col, query, using, filter) {
  return col.points
    .filter((p) => matchFilter(p.payload || {}, filter))
    .map((p) => {
      const vec = getNamed(p, using || "dense");
      const score = Array.isArray(vec) && Array.isArray(query) ? cosine(query, vec) : 0;
      return { id: p.id, score, payload: p.payload || {} };
    })
    .sort((a, b) => b.score - a.score);
}

function rankSparse(col, query, using, filter) {
  return col.points
    .filter((p) => matchFilter(p.payload || {}, filter))
    .map((p) => {
      const vec = getNamed(p, using || "bm25_sparse");
      return { id: p.id, score: sparseDot(query, vec), payload: p.payload || {} };
    })
    .sort((a, b) => b.score - a.score);
}

function rrfMerge(lists, limit, k = 60) {
  const scores = new Map();
  const payloads = new Map();
  for (const list of lists) {
    list.forEach((row, i) => {
      scores.set(row.id, (scores.get(row.id) || 0) + 1 / (k + i + 1));
      payloads.set(row.id, row.payload);
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score, payload: payloads.get(id) || {} }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/") {
      send(res, 200, { title: "mock-qdrant (not real Qdrant)", version: "mock-0.1.0" });
      return;
    }
    if (req.method === "GET" && path === "/readyz") {
      send(res, 200, "all shards are ready", "text/plain");
      return;
    }
    if (req.method === "GET" && path === "/livez") {
      send(res, 200, "alive", "text/plain");
      return;
    }
    if (req.method === "GET" && path === "/cluster") {
      send(res, 200, {
        result: { status: "disabled", peer_id: 0, note: "mock-qdrant single process" },
        time: 0,
      });
      return;
    }
    if (req.method === "GET" && path === "/collections") {
      send(res, 200, {
        result: { collections: [...store.keys()].map((name) => ({ name })) },
        status: "ok",
        time: 0,
      });
      return;
    }

    const indexDel = /^\/collections\/([^/]+)\/index\/([^/]+)$/.exec(path);
    if (indexDel && req.method === "DELETE") {
      const col = ensureCol(decodeURIComponent(indexDel[1]));
      if (!col) {
        send(res, 404, { status: { error: "collection not found" } });
        return;
      }
      delete col.indexes[decodeURIComponent(indexDel[2])];
      send(res, 200, { result: true, status: "ok", time: 0 });
      return;
    }

    const indexPut = /^\/collections\/([^/]+)\/index$/.exec(path);
    if (indexPut && req.method === "PUT") {
      const col = ensureCol(decodeURIComponent(indexPut[1]));
      if (!col) {
        send(res, 404, { status: { error: "collection not found" } });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const field = body.field_name;
      if (!field) {
        send(res, 400, { status: { error: "field_name required" } });
        return;
      }
      col.indexes[field] = { data_type: body.field_schema || "keyword" };
      send(res, 200, { result: { field_name: field }, status: "ok", time: 0 });
      return;
    }

    const pointsDelete = /^\/collections\/([^/]+)\/points\/delete$/.exec(path);
    if (pointsDelete && req.method === "POST") {
      const col = ensureCol(decodeURIComponent(pointsDelete[1]));
      if (!col) {
        send(res, 404, { status: { error: "collection not found" } });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const ids = new Set((body.points || []).map(String));
      col.points = col.points.filter((p) => !ids.has(String(p.id)));
      send(res, 200, { result: { status: "ok" }, time: 0 });
      return;
    }

    const pointsGet = /^\/collections\/([^/]+)\/points$/.exec(path);
    if (pointsGet && req.method === "POST") {
      const col = ensureCol(decodeURIComponent(pointsGet[1]));
      if (!col) {
        send(res, 404, { status: { error: "collection not found" } });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const want = new Set((body.ids || []).map(String));
      const points = col.points.filter((p) => want.has(String(p.id)));
      send(res, 200, { result: points, time: 0 });
      return;
    }

    if (pointsGet && req.method === "PUT") {
      const name = decodeURIComponent(pointsGet[1]);
      const col = ensureCol(name);
      if (!col) {
        send(res, 404, { status: { error: `collection ${name} not found` } });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      for (const p of body.points || []) {
        const idx = col.points.findIndex((x) => String(x.id) === String(p.id));
        if (idx >= 0) col.points[idx] = { ...col.points[idx], ...p };
        else col.points.push(p);
      }
      send(res, 200, { result: { status: "ok" }, time: 0 });
      return;
    }

    const scrollMatch = /^\/collections\/([^/]+)\/points\/scroll$/.exec(path);
    if (scrollMatch && req.method === "POST") {
      const col = ensureCol(decodeURIComponent(scrollMatch[1]));
      if (!col) {
        send(res, 404, { status: { error: "collection not found" } });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const limit = Number(body.limit || 10);
      const offset = Number(body.offset || 0);
      const filtered = col.points.filter((p) => matchFilter(p.payload || {}, body.filter));
      const slice = filtered.slice(offset, offset + limit);
      send(res, 200, {
        result: {
          points: slice,
          next_page_offset: offset + limit < filtered.length ? offset + limit : null,
        },
        time: 0,
      });
      return;
    }

    const queryMatch = /^\/collections\/([^/]+)\/points\/query$/.exec(path);
    if (queryMatch && req.method === "POST") {
      const col = ensureCol(decodeURIComponent(queryMatch[1]));
      if (!col) {
        send(res, 404, { status: { error: "collection not found" } });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const limit = Number(body.limit || 10);
      if (Array.isArray(body.prefetch) && body.prefetch.length) {
        const lists = body.prefetch.map((pref) => {
          const q = pref.query;
          if (Array.isArray(q)) return rankDense(col, q, pref.using, pref.filter || body.filter);
          return rankSparse(col, q, pref.using, pref.filter || body.filter);
        });
        send(res, 200, { result: { points: rrfMerge(lists, limit) }, time: 0.001 });
        return;
      }
      const q = body.query;
      if (Array.isArray(q)) {
        send(res, 200, {
          result: { points: rankDense(col, q, body.using, body.filter).slice(0, limit) },
          time: 0.001,
        });
        return;
      }
      if (q && typeof q === "object" && q.fusion) {
        send(res, 400, { status: { error: "fusion without prefetch is not implemented on mock-qdrant" } });
        return;
      }
      send(res, 400, { status: { error: "mock-qdrant expects a dense array query or prefetch+RRF" } });
      return;
    }

    const collMatch = /^\/collections\/([^/]+)$/.exec(path);
    if (collMatch && req.method === "GET") {
      const name = decodeURIComponent(collMatch[1]);
      const col = ensureCol(name);
      if (!col) {
        send(res, 404, { status: { error: `collection ${name} not found` } });
        return;
      }
      send(res, 200, { result: collectionInfo(name, col), time: 0 });
      return;
    }
    if (collMatch && req.method === "PUT") {
      const name = decodeURIComponent(collMatch[1]);
      const body = JSON.parse((await readBody(req)) || "{}");
      store.set(name, {
        vectors: body.vectors || { size: 128, distance: "Cosine" },
        sparseVectors: body.sparse_vectors || {},
        points: [],
        indexes: {},
      });
      send(res, 200, { result: true, status: "ok", time: 0 });
      return;
    }
    if (collMatch && req.method === "DELETE") {
      store.delete(decodeURIComponent(collMatch[1]));
      send(res, 200, { result: true, status: "ok", time: 0 });
      return;
    }

    send(res, 404, { status: { error: `mock-qdrant: no route ${req.method} ${path}` } });
  } catch (err) {
    send(res, 500, { status: { error: String(err) } });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-qdrant listening on http://127.0.0.1:${PORT} (in-memory, not real Qdrant)`);
  console.log(`  seeded ${store.size} collections: ${[...store.keys()].join(", ")}`);
});
