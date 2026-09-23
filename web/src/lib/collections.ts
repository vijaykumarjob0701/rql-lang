/**
 * Qdrant collections are the demo "tables": named point sets you list,
 * index, upsert, delete, and query. Keep names/filters aligned with
 * scripts/demo-data.mjs COLLECTION_SPECS.
 */
export type CollectionMeta = {
  name: string;
  purpose: string;
  denseTopic: "research" | "support" | "legal" | "product" | "ops";
  altTopic: "research" | "support" | "legal" | "product" | "ops";
  filter: string;
  altFilter: string;
  altTitle: string;
  colorField: string;
};

export const QDRANT_COLLECTIONS: CollectionMeta[] = [
  {
    name: "studio_demo",
    purpose: "General mixed corpus + ACL (tenant_id / clearance)",
    denseTopic: "research",
    altTopic: "legal",
    filter: "tenant_id = 'acme' AND clearance >= 2",
    altFilter: "tenant_id = 'globex' AND clearance >= 1",
    altTitle: "Globex tenant filter",
    colorField: "topic",
  },
  {
    name: "docs_support",
    purpose: "Support tickets (queue / priority / status)",
    denseTopic: "support",
    altTopic: "support",
    filter: "queue = 'billing' AND priority >= 2",
    altFilter: "status = 'open'",
    altTitle: "Open tickets",
    colorField: "queue",
  },
  {
    name: "docs_legal",
    purpose: "Legal memos (jurisdiction / privilege / matter)",
    denseTopic: "legal",
    altTopic: "legal",
    filter: "jurisdiction = 'US'",
    altFilter: "privilege = 'work_product'",
    altTitle: "Work-product only",
    colorField: "jurisdiction",
  },
  {
    name: "docs_product",
    purpose: "Product specs (product_line / stage / sku)",
    denseTopic: "product",
    altTopic: "product",
    filter: "product_line = 'search'",
    altFilter: "stage = 'ga'",
    altTitle: "GA specs",
    colorField: "product_line",
  },
  {
    name: "docs_research",
    purpose: "Research papers (venue / year / author)",
    denseTopic: "research",
    altTopic: "research",
    filter: "venue = 'SIGIR' AND year >= 2023",
    altFilter: "venue = 'EMNLP'",
    altTitle: "EMNLP papers",
    colorField: "venue",
  },
  {
    name: "logs_ops",
    purpose: "Ops event log (service / level / env)",
    denseTopic: "ops",
    altTopic: "ops",
    filter: "service = 'ingest' AND level = 'error'",
    altFilter: "env = 'prod'",
    altTitle: "Prod only",
    colorField: "level",
  },
];

export const QDRANT_COLLECTION_NAMES = QDRANT_COLLECTIONS.map((c) => c.name);

export function collectionMeta(name: string | null | undefined): CollectionMeta {
  return QDRANT_COLLECTIONS.find((c) => c.name === name) ?? QDRANT_COLLECTIONS[0]!;
}

export function sortCollectionNames(names: string[]): string[] {
  const rank = new Map(QDRANT_COLLECTION_NAMES.map((n, i) => [n, i]));
  return [...names].sort((a, b) => {
    const ra = rank.get(a);
    const rb = rank.get(b);
    if (ra == null && rb == null) return a.localeCompare(b);
    if (ra == null) return 1;
    if (rb == null) return -1;
    return ra - rb;
  });
}

export function retargetRetrieve(rql: string, collection: string): string {
  return rql.replace(/^(\s*RETRIEVE)\s+[A-Za-z_][A-Za-z0-9_]*/m, `$1 ${collection}`);
}
