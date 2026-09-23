const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"]);

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/** Env the Studio container uses to reach Postgres on the compose network. */
export function internalDatabaseUrl(): string {
  return stripSlash((process.env.DATABASE_URL || "").trim());
}

export function redactDatabaseUrl(url: string): string {
  const raw = (url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "postgres://***";
  }
}

/**
 * Browser still sends postgres://…@127.0.0.1:5432/…
 * Inside Docker remap loopback to DATABASE_URL. Non-loopback URLs pass through.
 */
export function resolvePgTarget(clientUrl: string | undefined): string {
  const internal = internalDatabaseUrl();
  const raw = stripSlash((clientUrl || "").trim());
  if (!raw) {
    if (internal) return internal;
    throw new Error("missing Postgres url");
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
