export type Connection = {
  url: string;
  apiKey: string;
};

export const STORAGE_KEY = "rql-studio.connection";
export const DEFAULT_URL = "http://127.0.0.1:6333";

export function loadConnection(): Connection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { url: DEFAULT_URL, apiKey: "" };
    const parsed = JSON.parse(raw) as Partial<Connection>;
    return {
      url: typeof parsed.url === "string" && parsed.url.trim() ? parsed.url.trim() : DEFAULT_URL,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return { url: DEFAULT_URL, apiKey: "" };
  }
}

export function saveConnection(conn: Connection): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      url: conn.url.trim() || DEFAULT_URL,
      apiKey: conn.apiKey,
    }),
  );
}

export function redactConnection(conn: Connection): { url: string; hasApiKey: boolean } {
  return { url: conn.url, hasApiKey: Boolean(conn.apiKey) };
}
