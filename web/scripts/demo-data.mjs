/**
 * Deterministic demo corpus + stored query vectors.
 * Used by seed.mjs. Studio recipes embed the same PRNG (see src/lib/demoVectors.ts).
 */
export const DIM = 128;
export const NAME = "studio_demo";
export const SEED = 20260923;
export const POINT_COUNT = 120;

/**
 * Qdrant collections in this demo. In this product a collection is the
 * "table": a named point set you list, index, upsert, delete, and query.
 */
export const COLLECTION_SPECS = [
  {
    name: "studio_demo",
    purpose: "General mixed corpus + ACL (tenant_id / clearance)",
    kind: "mixed",
    n: 120,
    colorField: "topic",
    denseTopic: "research",
    altTopic: "legal",
    filter: "tenant_id = 'acme' AND clearance >= 2",
    altFilter: "tenant_id = 'globex' AND clearance >= 1",
    altTitle: "Globex tenant filter",
    indexes: [
      ["tenant_id", "keyword"],
      ["topic", "keyword"],
      ["clearance", "integer"],
      ["lang", "keyword"],
      ["source", "keyword"],
    ],
  },
  {
    name: "docs_support",
    purpose: "Support tickets (queue / priority / status)",
    kind: "support",
    n: 40,
    colorField: "queue",
    denseTopic: "support",
    altTopic: "support",
    filter: "queue = 'billing' AND priority >= 2",
    altFilter: "status = 'open'",
    altTitle: "Open tickets",
    indexes: [
      ["queue", "keyword"],
      ["priority", "integer"],
      ["status", "keyword"],
    ],
  },
  {
    name: "docs_legal",
    purpose: "Legal memos (jurisdiction / privilege / matter)",
    kind: "legal",
    n: 32,
    colorField: "jurisdiction",
    denseTopic: "legal",
    altTopic: "legal",
    filter: "jurisdiction = 'US'",
    altFilter: "privilege = 'work_product'",
    altTitle: "Work-product only",
    indexes: [
      ["jurisdiction", "keyword"],
      ["privilege", "keyword"],
      ["matter", "keyword"],
    ],
  },
  {
    name: "docs_product",
    purpose: "Product specs (product_line / stage / sku)",
    kind: "product",
    n: 36,
    colorField: "product_line",
    denseTopic: "product",
    altTopic: "product",
    filter: "product_line = 'search'",
    altFilter: "stage = 'ga'",
    altTitle: "GA specs",
    indexes: [
      ["product_line", "keyword"],
      ["stage", "keyword"],
    ],
  },
  {
    name: "docs_research",
    purpose: "Research papers (venue / year / author)",
    kind: "research",
    n: 40,
    colorField: "venue",
    denseTopic: "research",
    altTopic: "research",
    filter: "venue = 'SIGIR' AND year >= 2023",
    altFilter: "venue = 'EMNLP'",
    altTitle: "EMNLP papers",
    indexes: [
      ["venue", "keyword"],
      ["year", "integer"],
    ],
  },
  {
    name: "logs_ops",
    purpose: "Ops event log (service / level / env)",
    kind: "ops",
    n: 48,
    colorField: "level",
    denseTopic: "ops",
    altTopic: "ops",
    filter: "service = 'ingest' AND level = 'error'",
    altFilter: "env = 'prod'",
    altTitle: "Prod only",
    indexes: [
      ["service", "keyword"],
      ["level", "keyword"],
      ["env", "keyword"],
    ],
  },
];

export const COLLECTION_NAMES = COLLECTION_SPECS.map((s) => s.name);

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

export function collectionSpec(name) {
  return COLLECTION_SPECS.find((s) => s.name === name) || COLLECTION_SPECS[0];
}

function pick(list, idx) {
  return list[idx % list.length];
}

export function generateSpecializedPoints(spec, { dim = DIM, seed = SEED } = {}) {
  const { randn } = makeRng(seed + spec.name.length * 31);
  const topic = spec.denseTopic;
  const cluster = Math.max(0, TOPICS.indexOf(topic));
  const centers = centroids(dim, seed);
  const center = centers[cluster];
  const n = spec.n;
  return Array.from({ length: n }, (_, idx) => {
    const noise = Array.from({ length: dim }, () => 0.08 * randn());
    const dense = normalize(center.map((x, j) => x + noise[j]));
    return {
      id: idx + 1,
      vector: { dense, bm25_sparse: sparseForTopic(topic) },
      payload: specializedPayload(spec.kind, idx),
    };
  });
}

export function specializedPayload(kind, idx) {
  if (kind === "support") {
    const queues = ["billing", "auth", "shipping"];
    const statuses = ["open", "pending", "closed"];
    return {
      queue: pick(queues, idx),
      priority: 1 + (idx % 5),
      status: pick(statuses, idx),
      customer: pick(TENANTS, idx),
      product: pick(["search", "chat", "billing"], idx),
      title: `ticket ${idx + 1}`,
    };
  }
  if (kind === "legal") {
    const jurisdictions = ["US", "EU", "UK"];
    const privileges = ["work_product", "public", "confidential"];
    const matters = ["alpha", "bravo", "charlie"];
    return {
      jurisdiction: pick(jurisdictions, idx),
      privilege: pick(privileges, idx),
      matter: pick(matters, idx),
      counsel: pick(["lee", "nguyen", "okonkwo"], idx),
      title: `memo ${idx + 1}`,
    };
  }
  if (kind === "product") {
    const lines = ["search", "chat", "billing"];
    const stages = ["ga", "beta", "preview"];
    return {
      product_line: pick(lines, idx),
      stage: pick(stages, idx),
      sku: `SKU-${1000 + idx}`,
      owner: pick(["dana", "ravi", "kim"], idx),
      title: `spec ${idx + 1}`,
    };
  }
  if (kind === "research") {
    const venues = ["SIGIR", "EMNLP", "NeurIPS"];
    return {
      venue: pick(venues, idx),
      year: 2022 + (idx % 4),
      author: pick(["chen", "alvarez", "berg"], idx),
      citation_count: (idx * 3) % 40,
      title: `paper ${idx + 1}`,
    };
  }
  if (kind === "ops") {
    const services = ["ingest", "query", "index"];
    const levels = ["error", "warn", "info"];
    const envs = ["prod", "stage", "dev"];
    return {
      service: pick(services, idx),
      level: pick(levels, idx),
      env: pick(envs, idx),
      request_id: `req-${idx + 1}`,
      title: `event ${idx + 1}`,
    };
  }
  return {
    topic: pick(TOPICS, idx),
    tenant_id: pick(TENANTS, idx),
    clearance: 1 + (idx % 5),
    title: `note ${idx + 1}`,
  };
}

export function generateAllCollections({ dim = DIM, seed = SEED } = {}) {
  return COLLECTION_SPECS.map((spec) => ({
    spec,
    name: spec.name,
    indexes: spec.indexes,
    points:
      spec.kind === "mixed"
        ? generatePoints({ dim, n: spec.n, seed })
        : generateSpecializedPoints(spec, { dim, seed }),
  }));
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
