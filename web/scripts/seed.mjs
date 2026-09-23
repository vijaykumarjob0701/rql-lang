#!/usr/bin/env node
/**
 * Seed the RQL Studio demo collection.
 *
 *   docker compose -f docker-compose.yml up -d
 *   npm run seed
 *
 * Or: npm run mock-qdrant  (other terminal) then npm run seed
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIM,
  NAME,
  POINT_COUNT,
  collectionBody,
  generatePoints,
  queryVectors,
} from "./demo-data.mjs";

const URL = (process.env.QDRANT_URL || "http://127.0.0.1:6333").replace(/\/$/, "");
const KEY = process.env.QDRANT_API_KEY || "";
const COLLECTION = process.env.STUDIO_COLLECTION || NAME;
const dim = Number(process.env.STUDIO_DIM || DIM);
const n = Number(process.env.STUDIO_POINTS || POINT_COUNT);

async function waitReady(base, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${base}/readyz`);
      if (res.ok) return;
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Qdrant not ready at ${base} after ${attempts} attempts`);
}

function headers() {
  const h = { "Content-Type": "application/json" };
  if (KEY) h["api-key"] = KEY;
  return h;
}

async function qdrant(method, path, body) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: headers(),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Qdrant ${method} ${path} → ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

await waitReady(URL);

const points = generatePoints({ dim, n });
const queries = queryVectors({ dim });

try {
  await qdrant("DELETE", `/collections/${encodeURIComponent(COLLECTION)}`);
} catch {
  /* first run */
}

await qdrant("PUT", `/collections/${encodeURIComponent(COLLECTION)}`, collectionBody(dim));

const batch = 40;
for (let i = 0; i < points.length; i += batch) {
  await qdrant("PUT", `/collections/${encodeURIComponent(COLLECTION)}/points?wait=true`, {
    points: points.slice(i, i + batch),
  });
}

for (const [field, schema] of [
  ["tenant_id", "keyword"],
  ["topic", "keyword"],
  ["clearance", "integer"],
  ["lang", "keyword"],
  ["source", "keyword"],
]) {
  try {
    await qdrant("PUT", `/collections/${encodeURIComponent(COLLECTION)}/index?wait=true`, {
      field_name: field,
      field_schema: schema,
    });
  } catch (err) {
    console.warn(`index ${field}: ${err instanceof Error ? err.message : err}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
try {
  writeFileSync(
    join(here, "..", "src", "lib", "demo-query-vectors.json"),
    `${JSON.stringify({ dim, collection: COLLECTION, ...queries }, null, 2)}\n`,
  );
} catch {
  console.warn("skip writing src/lib/demo-query-vectors.json (read-only image is fine)");
}

const info = await qdrant("GET", `/collections/${encodeURIComponent(COLLECTION)}`);
const count = info.result?.points_count ?? n;
console.log(`Seeded ${COLLECTION} at ${URL}`);
console.log(`  ${count} points · ${dim}-d cosine named vector "dense" · sparse "bm25_sparse"`);
console.log("  payload: topic, tenant_id, clearance, title, lang, source, year");
console.log("  payload indexes: tenant_id, topic, clearance, lang, source");
console.log("");
console.log("Open RQL Studio:");
console.log("  cd web && npm run dev");
console.log("  Docker UI:  http://127.0.0.1:8080  (connect form: http://127.0.0.1:6333)");
console.log("  Host Vite:  cd web && npm run dev → http://127.0.0.1:5173");
console.log("Stored demo query vectors are labeled as such — not text embeddings.");
