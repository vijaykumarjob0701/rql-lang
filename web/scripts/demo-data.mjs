/**
 * Deterministic demo corpus + stored query vectors.
 * Used by seed.mjs. Studio recipes embed the same PRNG (see src/lib/demoVectors.ts).
 */
export const DIM = 128;
export const NAME = "studio_demo";
export const SEED = 20260923;
export const POINT_COUNT = 120;

export const TOPICS = ["research", "support", "legal", "product", "ops"];
export const TENANTS = ["acme", "globex", "initech"];
export const LANGS = ["en", "de"];
export const SOURCES = ["handbook", "ticket", "memo", "rfc"];

/** Sparse "token" ids used as a toy BM25 stand-in — not a real analyzer. */
export const TOKEN_IDS = {
  portable: 1,
  retrieval: 2,
  rag: 3,
  research: 10,
  support: 11,
  legal: 12,
  product: 13,
  ops: 14,
  acl: 20,
  tenant: 21,
};

export function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalize(vec) {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1;
  return vec.map((x) => x / n);
}

export function makeRng(seed = SEED) {
  const rand = mulberry32(seed);
  const randn = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { rand, randn };
}

export function centroids(dim = DIM, seed = SEED) {
  const { randn } = makeRng(seed);
  return TOPICS.map((_, i) => {
    const v = Array.from({ length: dim }, (__, j) => (j % TOPICS.length === i ? 1 : 0.02 * randn()));
    return normalize(v);
  });
}

export function sparseForTopic(topic) {
  const topicId = TOKEN_IDS[topic] ?? 10;
  return {
    indices: [topicId, TOKEN_IDS.retrieval, TOKEN_IDS.rag],
    values: [1.2, 0.35, 0.2],
  };
}

export function generatePoints({ dim = DIM, n = POINT_COUNT, seed = SEED } = {}) {
  const { randn } = makeRng(seed + 17);
  const centers = centroids(dim, seed);
  return Array.from({ length: n }, (_, idx) => {
    const cluster = idx % TOPICS.length;
    const topic = TOPICS[cluster];
    const noise = Array.from({ length: dim }, () => 0.08 * randn());
    const dense = normalize(centers[cluster].map((x, j) => x + noise[j]));
    return {
      id: idx + 1,
      vector: {
        dense,
        bm25_sparse: sparseForTopic(topic),
      },
      payload: {
        topic,
        tenant_id: TENANTS[idx % TENANTS.length],
        clearance: 1 + (idx % 5),
        title: `${topic} note ${idx + 1}`,
        lang: LANGS[idx % LANGS.length],
        source: SOURCES[idx % SOURCES.length],
        year: 2022 + (idx % 4),
      },
    };
  });
}

export function queryVectors({ dim = DIM, seed = SEED } = {}) {
  const centers = centroids(dim, seed);
  const byTopic = Object.fromEntries(TOPICS.map((t, i) => [t, centers[i]]));
  return {
    dense: {
      research: byTopic.research,
      support: byTopic.support,
      legal: byTopic.legal,
      product: byTopic.product,
      ops: byTopic.ops,
    },
    sparse: {
      portable_retrieval: {
        indices: [TOKEN_IDS.portable, TOKEN_IDS.retrieval, TOKEN_IDS.rag, TOKEN_IDS.research],
        values: [0.9, 1.1, 0.7, 0.4],
      },
    },
    label: "Stored demo query vector shipped with the seed — not an embedding of the QUERY text.",
  };
}

export function collectionBody(dim = DIM) {
  return {
    vectors: { dense: { size: dim, distance: "Cosine" } },
    sparse_vectors: { bm25_sparse: {} },
  };
}
