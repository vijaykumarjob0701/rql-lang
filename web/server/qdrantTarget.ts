const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"]);

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/** Env the Studio container uses to reach Qdrant on the compose network. */
export function internalQdrantUrl(): string {
  return stripSlash((process.env.QDRANT_URL || "").trim());
}

/**
 * Browser still sends http://localhost:6333 (host-mapped).
 * Inside Docker that host is the container itself — remap loopback to QDRANT_URL.
 * Non-loopback URLs (Qdrant Cloud) pass through unchanged.
 */
export function resolveQdrantTarget(clientUrl: string | undefined): string {
  const internal = internalQdrantUrl();
  const raw = stripSlash((clientUrl || "").trim());
  if (!raw) {
    if (internal) return internal;
    throw new Error("missing Qdrant url");
  }
  if (!internal) return raw;
  try {
    const parsed = new URL(raw);
    if (LOOPBACK.has(parsed.hostname.toLowerCase())) return internal;
  } catch {
    return raw;
  }
  return raw;
}

export function resolveQdrantApiKey(clientKey: string | undefined): string | undefined {
  const fromClient = (clientKey || "").trim();
  if (fromClient) return fromClient;
  const fromEnv = (process.env.QDRANT_API_KEY || "").trim();
  return fromEnv || undefined;
}
