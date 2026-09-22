export type Snippet = {
  id: string;
  title: string;
  blurb: string;
  rql: string;
};

export const SNIPPETS: Snippet[] = [
  {
    id: "filtered-dense",
    title: "Filtered dense + ACL",
    blurb: "AnnExec + PRE filter — the execute happy path on studio_demo.",
    rql: `RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 VECTOR_REF $q_dense
  WHERE tenant_id = 'acme' AND clearance >= 2
  ACL_HARD;
`,
  },
  {
    id: "dense-only",
    title: "Dense only",
    blurb: "Unfiltered nearest-neighbor sketch.",
    rql: `RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 12 VECTOR_REF $q_dense;
`,
  },
  {
    id: "hybrid-rrf",
    title: "Hybrid RRF",
    blurb: "Explain/emit work. Execute needs a sparse {indices,values} binding.",
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
    rql: `RETRIEVE studio_demo
  SEARCH LATE ON token_vectors CANDIDATES 10 VECTOR_REF $q_tok;
`,
  },
  {
    id: "linear",
    title: "Linear fusion (fail-closed)",
    blurb: "Planner emits FusionExec family=linear; Studio execute rejects it.",
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

export const DEFAULT_RQL = SNIPPETS[0]!.rql;
