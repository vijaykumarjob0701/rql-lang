#!/usr/bin/env node
/**
 * Seed ≥5 Qdrant collections for RQL Studio.
 *
 *   docker compose -f docker-compose.yml up -d
 *   npm run seed
 *
 * Or: npm run mock-qdrant  (other terminal) then npm run seed
 *
 * In this product a collection is the "table": list / index / upsert / delete / query.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLLECTION_NAMES,
  DIM,
  collectionBody,
  generateAllCollections,
  queryVectors,
} from "./demo-data.mjs";

const URL = (process.env.QDRANT_URL || "http://127.0.0.1:6333").replace(/\/$/, "");
const KEY = process.env.QDRANT_API_KEY || "";
const dim = Number(process.env.STUDIO_DIM || DIM);

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

async function seedCollection(name, points, indexes) {
  try {
    await qdrant("DELETE", `/collections/${encodeURIComponent(name)}`);
  } catch {
    /* first run */
  }
  await qdrant("PUT", `/collections/${encodeURIComponent(name)}`, collectionBody(dim));
  const batch = 40;
  for (let i = 0; i < points.length; i += batch) {
    await qdrant("PUT", `/collections/${encodeURIComponent(name)}/points?wait=true`, {
      points: points.slice(i, i + batch),
    });
  }
  for (const [field, schema] of indexes) {
    try {
      await qdrant("PUT", `/collections/${encodeURIComponent(name)}/index?wait=true`, {
        field_name: field,
        field_schema: schema,
      });
    } catch (err) {
      console.warn(`index ${name}.${field}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const info = await qdrant("GET", `/collections/${encodeURIComponent(name)}`);
  return info.result?.points_count ?? points.length;
}

await waitReady(URL);

const bundles = generateAllCollections({ dim });
const queries = queryVectors({ dim });
const counts = {};
for (const bundle of bundles) {
  counts[bundle.name] = await seedCollection(bundle.name, bundle.points, bundle.indexes);
}

const here = dirname(fileURLToPath(import.meta.url));
try {
  writeFileSync(
    join(here, "..", "src", "lib", "demo-query-vectors.json"),
    `${JSON.stringify({ dim, collections: COLLECTION_NAMES, ...queries }, null, 2)}\n`,
  );
} catch {
  console.warn("skip writing src/lib/demo-query-vectors.json (read-only image is fine)");
}

console.log(`Seeded ${bundles.length} Qdrant collections at ${URL}`);
for (const bundle of bundles) {
  console.log(
    `  ${bundle.name}: ${counts[bundle.name]} points · ${bundle.spec.purpose}`,
  );
}
console.log(`  ${dim}-d cosine named vector "dense" · sparse "bm25_sparse"`);
console.log("");
console.log("Open RQL Studio and pick a collection (these are the demo \"tables\"):");
console.log("  Docker UI:  http://127.0.0.1:8080  (connect form: http://127.0.0.1:6333)");
console.log("  Host Vite:  cd web && npm run dev → http://127.0.0.1:5173");
console.log("Stored demo query vectors are labeled as such — not text embeddings.");
