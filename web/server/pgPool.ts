import pg from "pg";

const pools = new Map<string, pg.Pool>();

export function poolFor(url: string): pg.Pool {
  let pool = pools.get(url);
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    pools.set(url, pool);
  }
  return pool;
}

export async function withPg<T>(url: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await poolFor(url).connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function pgQuery(url: string) {
  return async (sql: string, params?: unknown[]) => {
    const result = await poolFor(url).query(sql, params);
    return { rows: result.rows as Record<string, unknown>[] };
  };
}
