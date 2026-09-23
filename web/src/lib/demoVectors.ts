import stored from "./demo-query-vectors.json";

export type SparseVector = { indices: number[]; values: number[] };

export type DemoRecipe = {
  id: string;
  title: string;
  blurb: string;
  rql: string;
  kind: "dense" | "hybrid" | "fail-closed";
  /** Topic centroid used for the stored dense query vector, if any. */
  denseTopic?: keyof typeof stored.dense;
  usesSparse?: boolean;
};

export const DEMO_VECTOR_LABEL = stored.label;

export function storedDense(topic: keyof typeof stored.dense = "research"): number[] {
  return stored.dense[topic];
}

export function storedSparse(): SparseVector {
  return stored.sparse.portable_retrieval;
}

export const DEMO_RECIPES: DemoRecipe[] = [
  {
    id: "filtered-dense",
    title: "Filtered dense + ACL",
    blurb: "AnnExec + PRE filter. First-click Execute uses a stored research centroid.",
    kind: "dense",
    denseTopic: "research",
    rql: `RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 VECTOR_REF $q_dense
  WHERE tenant_id = 'acme' AND clearance >= 2
  ACL_HARD;
`,
  },
  {
    id: "dense-only",
    title: "Dense only",
    blurb: "Unfiltered nearest neighbors against the support centroid.",
    kind: "dense",
    denseTopic: "support",
    rql: `RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 12 VECTOR_REF $q_dense;
`,
  },
  {
    id: "tenant-globex",
    title: "Globex tenant filter",
    blurb: "Same ANN, different ACL-style tenant.",
    kind: "dense",
    denseTopic: "legal",
    rql: `RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 15 VECTOR_REF $q_dense
  WHERE tenant_id = 'globex' AND clearance >= 1
  ACL_HARD;
`,
  },
  {
    id: "topic-product",
    title: "Product topic",
    blurb: "Filter on payload topic=product with the product centroid.",
    kind: "dense",
    denseTopic: "product",
    rql: `RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 16 VECTOR_REF $q_dense
  WHERE topic = 'product';
`,
  },
  {
    id: "hybrid-rrf",
    title: "Hybrid RRF",
    blurb: "Dense + sparse prefetch. Execute binds a stored sparse {indices,values}.",
    kind: "hybrid",
    denseTopic: "research",
    usesSparse: true,
    rql: `RETRIEVE studio_demo
  SEARCH
    DENSE ON embedding METRIC cosine CANDIDATES 50 VECTOR_REF $q_dense
    AND BM25 ON content CANDIDATES 50 QUERY 'portable retrieval IR for RAG'
  FUSE RRF K 60;
`,
  },
  {
    id: "late",
    title: "Late / ColBERT (fail-closed)",
    blurb: "Compiles; execute refuses — no silent dense substitute.",
    kind: "fail-closed",
    denseTopic: "research",
    rql: `RETRIEVE studio_demo
  SEARCH LATE ON token_vectors CANDIDATES 10 VECTOR_REF $q_tok;
`,
  },
  {
    id: "linear",
    title: "Linear fusion (fail-closed)",
    blurb: "FusionExec family=linear is not representable on Studio execute.",
    kind: "fail-closed",
    denseTopic: "ops",
    rql: `RETRIEVE studio_demo
  SEARCH
    DENSE ON embedding METRIC cosine CANDIDATES 30 VECTOR_REF $q_dense
    AND BM25 ON description CANDIDATES 30 QUERY 'electronics deals'
  WHERE tenant_id = 'acme'
  FUSE LINEAR WEIGHTS (0.5, 0.5)
  LIMIT 12;
`,
  },
];

export const DEFAULT_RECIPE = DEMO_RECIPES[0]!;

export function recipeBindings(recipe: DemoRecipe): {
  dense: number[] | null;
  sparse: SparseVector | null;
} {
  const dense = recipe.denseTopic ? storedDense(recipe.denseTopic) : null;
  const sparse = recipe.usesSparse ? storedSparse() : null;
  return { dense, sparse };
}
