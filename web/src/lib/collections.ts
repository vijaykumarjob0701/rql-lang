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
    purpose: "Support-topic slice",
    denseTopic: "support",
    altTopic: "support",
    filter: "tenant_id = 'acme' AND clearance >= 2",
    altFilter: "lang = 'en'",
    altTitle: "English only",
    colorField: "tenant_id",
  },
  {
    name: "docs_legal",
    purpose: "Legal-topic slice",
    denseTopic: "legal",
    altTopic: "legal",
    filter: "tenant_id = 'acme' AND clearance >= 2",
    altFilter: "source = 'memo'",
    altTitle: "Memos only",
    colorField: "tenant_id",
  },
  {
    name: "docs_product",
    purpose: "Product-topic slice",
    denseTopic: "product",
    altTopic: "product",
    filter: "tenant_id = 'acme' AND clearance >= 2",
    altFilter: "source = 'rfc'",
    altTitle: "RFC sources",
    colorField: "tenant_id",
  },
  {
    name: "docs_research",
    purpose: "Research-topic slice",
    denseTopic: "research",
    altTopic: "research",
    filter: "tenant_id = 'acme' AND clearance >= 2",
    altFilter: "year >= 2023",
    altTitle: "Recent years",
    colorField: "year",
  },
  {
    name: "logs_ops",
    purpose: "Ops-topic slice",
    denseTopic: "ops",
    altTopic: "ops",
    filter: "tenant_id = 'acme' AND clearance >= 2",
    altFilter: "source = 'ticket'",
    altTitle: "Ticket sources",
    colorField: "source",
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

/** Keep current selection if it still exists; else prefer studio_demo, else first. */
export function preferCollection(
  names: string[],
  current: string | null | undefined,
  fallback = "studio_demo",
): string | null {
  if (current && names.includes(current)) return current;
  if (names.includes(fallback)) return fallback;
  return names[0] ?? null;
}

export const COLLECTION_POLL_MS = 5000;
