#!/usr/bin/env node
/**
 * Seed ≥5 Qdrant collections for the RQL Studio demo.
 *
 *   docker compose -f docker-compose.yml up -d
 *   npm run seed
 *
 * Or: npm run mock-qdrant  (other terminal) then npm run seed
 *
 * Collections ≈ "tables" in this product. Index PUT is soft-warned if the
 * mock has no /index route; real Qdrant (docker compose) creates payload indexes.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIM, NAME, collectionBody, queryVectors, seedBundles } from "./demo-data.mjs";

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

await waitReady(URL);

const queries = queryVectors({ dim });
const bundles = seedBundles({ dim });
const seeded = [];

for (const spec of bundles) {
  try {
    await qdrant("DELETE", `/collections/${encodeURIComponent(spec.name)}`);
  } catch {
    /* first run */
  }

  await qdrant("PUT", `/collections/${encodeURIComponent(spec.name)}`, collectionBody(dim));

  const batch = 40;
  for (let i = 0; i < spec.points.length; i += batch) {
    await qdrant("PUT", `/collections/${encodeURIComponent(spec.name)}/points?wait=true`, {
      points: spec.points.slice(i, i + batch),
    });
  }

  for (const [field, schema] of spec.indexes) {
    try {
      await qdrant("PUT", `/collections/${encodeURIComponent(spec.name)}/index?wait=true`, {
        field_name: field,
        field_schema: schema,
      });
    } catch (err) {
      console.warn(`index ${spec.name}.${field}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const info = await qdrant("GET", `/collections/${encodeURIComponent(spec.name)}`);
  const count = info.result?.points_count ?? spec.points.length;
  seeded.push({ name: spec.name, count });
  console.log(`Seeded ${spec.name}: ${count} points`);
}

const here = dirname(fileURLToPath(import.meta.url));
try {
  writeFileSync(
    join(here, "..", "src", "lib", "demo-query-vectors.json"),
    `${JSON.stringify({ dim, collection: NAME, collections: seeded.map((s) => s.name), ...queries }, null, 2)}\n`,
  );
} catch {
  console.warn("skip writing src/lib/demo-query-vectors.json (read-only image is fine)");
}

console.log("");
console.log(`Seeded ${seeded.length} collections at ${URL} (${dim}-d dense + bm25_sparse)`);
for (const s of seeded) console.log(`  - ${s.name} (${s.count} points)`);
console.log("");
console.log("Open RQL Studio → Connect → pick a collection in the sidebar.");
console.log("These collections are the demo \"tables\".");
console.log("Stored demo query vectors are labeled as such — not text embeddings.");
