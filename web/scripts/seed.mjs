#!/usr/bin/env node
/**
 * Seed a demo collection for RQL Studio.
 *
 *   docker run --rm -p 6333:6333 qdrant/qdrant
 *   npm run seed
 *
 * Or against the in-memory mock:
 *
 *   npm run mock-qdrant   # other terminal
 *   npm run seed
 */
const URL = (process.env.QDRANT_URL || "http://127.0.0.1:6333").replace(/\/$/, "");
const KEY = process.env.QDRANT_API_KEY || "";
const NAME = process.env.STUDIO_COLLECTION || "studio_demo";
const DIM = Number(process.env.STUDIO_DIM || 128);
const N = Number(process.env.STUDIO_POINTS || 90);

const TOPICS = ["research", "support", "legal"];
const TENANTS = ["acme", "globex"];

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
  if (!res.ok) throw new Error(`Qdrant ${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function normalize(vec) {
  const n = Math.hypot(...vec);
  return vec.map((x) => x / (n || 1));
}

function centroid(i) {
  const v = Array.from({ length: DIM }, (_, j) => (j % 3 === i ? 1 : 0.02 * randn()));
  return normalize(v);
}

const centroids = TOPICS.map((_, i) => centroid(i));

const points = Array.from({ length: N }, (_, idx) => {
  const cluster = idx % TOPICS.length;
  const topic = TOPICS[cluster];
  const noise = Array.from({ length: DIM }, () => 0.08 * randn());
  const vec = normalize(centroids[cluster].map((x, j) => x + noise[j]));
  return {
    id: idx + 1,
    vector: { dense: vec },
    payload: {
      topic,
      tenant_id: TENANTS[idx % TENANTS.length],
      clearance: 1 + (idx % 5),
      title: `${topic} note ${idx + 1}`,
    },
  };
});

await qdrant("PUT", `/collections/${encodeURIComponent(NAME)}`, {
  vectors: { dense: { size: DIM, distance: "Cosine" } },
});

const batch = 30;
for (let i = 0; i < points.length; i += batch) {
  await qdrant("PUT", `/collections/${encodeURIComponent(NAME)}/points?wait=true`, {
    points: points.slice(i, i + batch),
  });
}

const info = await qdrant("GET", `/collections/${encodeURIComponent(NAME)}`);
const count = info.result?.points_count ?? N;
console.log(`Seeded ${NAME} at ${URL} — ${count} points, ${DIM}-d cosine named vector "dense".`);
console.log("Payload fields: topic, tenant_id, clearance, title.");
console.log("Connect RQL Studio to this URL and open the Visualize tab.");
