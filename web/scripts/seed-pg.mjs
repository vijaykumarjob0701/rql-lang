#!/usr/bin/env node
/**
 * Apply the pgvector demo schema and seed ≥5 tables.
 *
 *   DATABASE_URL=postgres://rql:rql@127.0.0.1:5432/rql_studio npm run seed:pg
 *
 * Embeddings reuse the Qdrant seed centroids — stored demo vectors, not a model.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { generatePoints, queryVectors, TENANTS, TOPICS } from "./demo-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://rql:rql@127.0.0.1:5432/rql_studio";
const n = Number(process.env.STUDIO_POINTS || 120);

function vecLiteral(values) {
  return `[${values.join(",")}]`;
}

async function waitConnect(attempts = 40) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    try {
      await client.connect();
      return client;
    } catch (err) {
      last = err;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres not ready at ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")} (${last})`);
}

async function main() {
  const client = await waitConnect();
  try {
    const schema = readFileSync(join(__dirname, "../sql/schema.sql"), "utf8");
    await client.query(schema);

    await client.query("BEGIN");
    await client.query(
      "TRUNCATE embedding_jobs, query_logs, chunks, documents, projects, tenants RESTART IDENTITY CASCADE",
    );

    const tenantRows = [
      ["acme", "Acme Corp", "demo"],
      ["globex", "Globex", "demo"],
      ["initech", "Initech", "demo"],
    ];
    for (const [id, name, plan] of tenantRows) {
      await client.query("INSERT INTO tenants (id, name, plan) VALUES ($1, $2, $3)", [id, name, plan]);
    }

    const projects = TOPICS.map((topic, i) => {
      const tenant = TENANTS[i % TENANTS.length];
      return {
        id: `proj-${topic}`,
        tenant_id: tenant,
        name: `${topic} corpus`,
        description: `Demo project grouping ${topic} documents`,
      };
    });
    for (const p of projects) {
      await client.query(
        "INSERT INTO projects (id, tenant_id, name, description) VALUES ($1, $2, $3, $4)",
        [p.id, p.tenant_id, p.name, p.description],
      );
    }

    const points = generatePoints({ n });
    const docsByKey = new Map();
    for (const point of points) {
      const topic = point.payload.topic;
      const tenant = point.payload.tenant_id;
      const bucket = Math.floor((point.id - 1) / 5);
      const docId = `doc-${topic}-${bucket}`;
      if (!docsByKey.has(docId)) {
        docsByKey.set(docId, {
          id: docId,
          project_id: `proj-${topic}`,
          tenant_id: tenant,
          title: point.payload.title,
          source: point.payload.source,
          lang: point.payload.lang,
          year: point.payload.year,
        });
      }
    }
    for (const doc of docsByKey.values()) {
      await client.query(
        `INSERT INTO documents (id, project_id, tenant_id, title, source, lang, year)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [doc.id, doc.project_id, doc.tenant_id, doc.title, doc.source, doc.lang, doc.year],
      );
    }

    for (const point of points) {
      const topic = point.payload.topic;
      const bucket = Math.floor((point.id - 1) / 5);
      const docId = `doc-${topic}-${bucket}`;
      await client.query(
        `INSERT INTO chunks (id, document_id, tenant_id, topic, clearance, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
        [
          `chunk-${point.id}`,
          docId,
          point.payload.tenant_id,
          topic,
          point.payload.clearance,
          `${point.payload.title}: portable retrieval IR for RAG (${topic}).`,
          vecLiteral(point.vector.dense),
        ],
      );
    }

    const qv = queryVectors();
    const extraDoc = [...docsByKey.values()][0];
    await client.query(
      `INSERT INTO chunks (id, document_id, tenant_id, topic, clearance, content, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
      [
        "chunk-demo-editable",
        extraDoc.id,
        extraDoc.tenant_id,
        "research",
        2,
        "Editable demo chunk for the UPDATE example.",
        vecLiteral(qv.dense.research),
      ],
    );
    await client.query(
      `INSERT INTO chunks (id, document_id, tenant_id, topic, clearance, content, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
      [
        "chunk-demo-deletable",
        extraDoc.id,
        extraDoc.tenant_id,
        "ops",
        1,
        "Deletable demo chunk (optional). Prefer DELETE FROM query_logs in the gallery.",
        vecLiteral(qv.dense.ops),
      ],
    );

    for (const topic of TOPICS) {
      await client.query(
        `INSERT INTO query_logs (tenant_id, recipe_id, rql, hit_count, latency_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          TENANTS[TOPICS.indexOf(topic) % TENANTS.length],
          `seed-${topic}`,
          `RETRIEVE chunks SEARCH DENSE ON embedding METRIC cosine CANDIDATES 8 VECTOR_REF $q_dense WHERE topic = '${topic}';`,
          8,
          1.5 + TOPICS.indexOf(topic),
        ],
      );
    }

    for (const doc of docsByKey.values()) {
      const chunkCount = points.filter((p) => {
        const topic = p.payload.topic;
        const bucket = Math.floor((p.id - 1) / 5);
        return `doc-${topic}-${bucket}` === doc.id;
      }).length;
      await client.query(
        `INSERT INTO embedding_jobs (document_id, status, model, chunk_count, finished_at)
         VALUES ($1, 'seeded', 'demo-centroid-v0', $2, now())`,
        [doc.id, chunkCount],
      );
    }

    await client.query("COMMIT");

    const counts = {};
    for (const table of [
      "tenants",
      "projects",
      "documents",
      "chunks",
      "query_logs",
      "embedding_jobs",
    ]) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
      counts[table] = rows[0].n;
    }
    console.log("pgvector seed ok", counts);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
