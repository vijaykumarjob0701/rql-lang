import { collectionMeta, retargetRetrieve } from "./collections";
import stored from "./demo-query-vectors.json";

export type SparseVector = { indices: number[]; values: number[] };

export type DemoRecipe = {
  id: string;
  title: string;
  blurb: string;
  rql: string;
  kind: "dense" | "hybrid" | "fail-closed";
  backend?: "qdrant" | "pgvector";
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

function denseSearch(collection: string, k: number, where?: string, acl = false): string {
  const filter = where
    ? `\n  WHERE ${where}${acl ? "\n  ACL_HARD" : ""};`
    : ";";
  return `RETRIEVE ${collection}
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES ${k} VECTOR_REF $q_dense${filter}
`;
}

export function buildQdrantRecipes(collection = "studio_demo"): DemoRecipe[] {
  const meta = collectionMeta(collection);
  return [
    {
      id: "filtered-dense",
      title: "Filtered dense",
      blurb: `AnnExec + filter on ${meta.name}. First-click Execute uses a stored ${meta.denseTopic} centroid.`,
      kind: "dense",
      denseTopic: meta.denseTopic,
      rql: denseSearch(meta.name, 20, meta.filter, meta.name === "studio_demo"),
    },
    {
      id: "dense-only",
      title: "Dense only",
      blurb: `Unfiltered nearest neighbors in ${meta.name}.`,
      kind: "dense",
      denseTopic: meta.denseTopic,
      rql: denseSearch(meta.name, 12),
    },
    {
      id: "alt-filter",
      title: meta.altTitle,
      blurb: `Same ANN on ${meta.name} with a different payload predicate.`,
      kind: "dense",
      denseTopic: meta.altTopic,
      rql: denseSearch(meta.name, 15, meta.altFilter, meta.name === "studio_demo"),
    },
    {
      id: "hybrid-rrf",
      title: "Hybrid RRF",
      blurb: "Dense + sparse prefetch. Execute binds a stored sparse {indices,values}.",
      kind: "hybrid",
      denseTopic: meta.denseTopic,
      usesSparse: true,
      rql: `RETRIEVE ${meta.name}
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
      denseTopic: meta.denseTopic,
      rql: `RETRIEVE ${meta.name}
  SEARCH LATE ON token_vectors CANDIDATES 10 VECTOR_REF $q_tok;
`,
    },
    {
      id: "linear",
      title: "Linear fusion (fail-closed)",
      blurb: "FusionExec family=linear is not representable on Studio execute.",
      kind: "fail-closed",
      denseTopic: meta.altTopic,
      rql: `RETRIEVE ${meta.name}
  SEARCH
    DENSE ON embedding METRIC cosine CANDIDATES 30 VECTOR_REF $q_dense
    AND BM25 ON description CANDIDATES 30 QUERY 'electronics deals'
  WHERE ${meta.filter}
  FUSE LINEAR WEIGHTS (0.5, 0.5)
  LIMIT 12;
`,
    },
  ];
}

export const DEMO_RECIPES: DemoRecipe[] = buildQdrantRecipes("studio_demo");

export const PG_RECIPES: DemoRecipe[] = [
  {
    id: "pg-filtered-dense",
    title: "Filtered dense + ACL",
    blurb: "AnnExec + PRE filter on chunks. Execute runs parameterized <=> SQL.",
    kind: "dense",
    backend: "pgvector",
    denseTopic: "research",
    rql: `RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 VECTOR_REF $q_dense
  WHERE tenant_id = 'acme' AND clearance >= 2
  ACL_HARD;
`,
  },
  {
    id: "pg-dense-only",
    title: "Dense only",
    blurb: "Unfiltered nearest neighbors — emit is a pgvector SQL sketch.",
    kind: "dense",
    backend: "pgvector",
    denseTopic: "support",
    rql: `RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 12 VECTOR_REF $q_dense;
`,
  },
  {
    id: "pg-tenant-globex",
    title: "Globex tenant filter",
    blurb: "Same ANN, different tenant_id predicate pushed into WHERE.",
    kind: "dense",
    backend: "pgvector",
    denseTopic: "legal",
    rql: `RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 15 VECTOR_REF $q_dense
  WHERE tenant_id = 'globex' AND clearance >= 1
  ACL_HARD;
`,
  },
  {
    id: "pg-topic-product",
    title: "Product topic",
    blurb: "Filter topic = product with the product centroid.",
    kind: "dense",
    backend: "pgvector",
    denseTopic: "product",
    rql: `RETRIEVE chunks
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 16 VECTOR_REF $q_dense
  WHERE topic = 'product';
`,
  },
  {
    id: "pg-late",
    title: "Late / ColBERT (fail-closed)",
    blurb: "Emit sketches a placeholder. Execute refuses — no MaxSim in pgvector.",
    kind: "fail-closed",
    backend: "pgvector",
    denseTopic: "research",
    rql: `RETRIEVE chunks
  SEARCH LATE ON token_vectors CANDIDATES 10 VECTOR_REF $q_tok;
`,
  },
  {
    id: "pg-linear",
    title: "Linear fusion (fail-closed)",
    blurb: "emit(profile=pgvector) notes the client shim. Execute fail-closes.",
    kind: "fail-closed",
    backend: "pgvector",
    denseTopic: "ops",
    rql: `RETRIEVE chunks
  SEARCH
    DENSE ON embedding METRIC cosine CANDIDATES 30 VECTOR_REF $q_dense
    AND BM25 ON description CANDIDATES 30 QUERY 'electronics deals'
  WHERE tenant_id = 'acme'
  FUSE LINEAR WEIGHTS (0.5, 0.5)
  LIMIT 12;
`,
  },
];

export const ALL_RECIPES: DemoRecipe[] = [...DEMO_RECIPES, ...PG_RECIPES];

export const DEFAULT_RECIPE = DEMO_RECIPES[0]!;
export const DEFAULT_PG_RECIPE = PG_RECIPES[0]!;

export function recipesForBackend(
  backend: "qdrant" | "pgvector",
  collection = "studio_demo",
): DemoRecipe[] {
  if (backend === "pgvector") return PG_RECIPES;
  return buildQdrantRecipes(collection);
}

export function defaultRecipeFor(
  backend: "qdrant" | "pgvector",
  collection = "studio_demo",
): DemoRecipe {
  return recipesForBackend(backend, collection)[0]!;
}

export { retargetRetrieve };

export function recipeBindings(recipe: DemoRecipe): {
  dense: number[] | null;
  sparse: SparseVector | null;
} {
  const dense = recipe.denseTopic ? storedDense(recipe.denseTopic) : null;
  const sparse = recipe.usesSparse ? storedSparse() : null;
  return { dense, sparse };
}
