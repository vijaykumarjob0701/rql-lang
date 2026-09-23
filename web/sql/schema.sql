-- RQL Studio pgvector demo schema.
-- Embeddings are stored demo centroids (same PRNG as the Qdrant seed), not model output.
-- Idempotent: seed-pg.mjs applies this on every run.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'demo'
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  year INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents (id),
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  topic TEXT NOT NULL,
  clearance INT NOT NULL DEFAULT 1,
  content TEXT NOT NULL,
  embedding vector(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS query_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants (id),
  recipe_id TEXT,
  rql TEXT,
  hit_count INT,
  latency_ms DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embedding_jobs (
  id BIGSERIAL PRIMARY KEY,
  document_id TEXT REFERENCES documents (id),
  status TEXT NOT NULL DEFAULT 'seeded',
  model TEXT NOT NULL DEFAULT 'demo-centroid-v0',
  chunk_count INT NOT NULL DEFAULT 0,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects (tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents (project_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks (document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_id ON chunks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chunks_topic ON chunks (topic);
CREATE INDEX IF NOT EXISTS idx_query_logs_tenant_id ON query_logs (tenant_id);

-- ANN index used by ORDER BY embedding <=> $1
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);
