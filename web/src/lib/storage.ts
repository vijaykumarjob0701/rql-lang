export type Backend = "qdrant" | "pgvector";

export type Connection = {
  backend: Backend;
  url: string;
  apiKey: string;
  pgUrl: string;
};

export const STORAGE_KEY = "rql-studio.connection";
export const DEFAULT_URL = "http://127.0.0.1:6333";
export const DEFAULT_PG_URL = "postgres://rql:rql@127.0.0.1:5432/rql_studio";

function asBackend(value: unknown): Backend {
  return value === "pgvector" ? "pgvector" : "qdrant";
}

export function loadConnection(): Connection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { backend: "qdrant", url: DEFAULT_URL, apiKey: "", pgUrl: DEFAULT_PG_URL };
    const parsed = JSON.parse(raw) as Partial<Connection>;
    return {
      backend: asBackend(parsed.backend),
      url: typeof parsed.url === "string" && parsed.url.trim() ? parsed.url.trim() : DEFAULT_URL,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      pgUrl: typeof parsed.pgUrl === "string" && parsed.pgUrl.trim() ? parsed.pgUrl.trim() : DEFAULT_PG_URL,
    };
  } catch {
    return { backend: "qdrant", url: DEFAULT_URL, apiKey: "", pgUrl: DEFAULT_PG_URL };
  }
}

export function saveConnection(conn: Connection): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      backend: asBackend(conn.backend),
      url: conn.url.trim() || DEFAULT_URL,
      apiKey: conn.apiKey,
      pgUrl: conn.pgUrl.trim() || DEFAULT_PG_URL,
    }),
  );
}

export function redactConnection(conn: Connection): {
  backend: Backend;
  url: string;
  pgUrl: string;
  hasApiKey: boolean;
} {
  return {
    backend: conn.backend,
    url: conn.url,
    pgUrl: redactPgUrl(conn.pgUrl),
    hasApiKey: Boolean(conn.apiKey),
  };
}

export function redactPgUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return url ? "postgres://***" : "";
  }
}
