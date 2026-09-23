import { afterEach, describe, expect, it } from "vitest";
import { loadConnection, redactConnection, saveConnection, STORAGE_KEY } from "./storage";

describe("connection storage", () => {
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it("round-trips url + api key without exposing the secret in redact", () => {
    saveConnection({
      backend: "qdrant",
      url: "http://localhost:6333",
      apiKey: "super-secret",
      pgUrl: "postgres://rql:hunter2@127.0.0.1:5432/rql_studio",
    });
    const loaded = loadConnection();
    expect(loaded.apiKey).toBe("super-secret");
    expect(loaded.backend).toBe("qdrant");
    expect(redactConnection(loaded)).toEqual({
      backend: "qdrant",
      url: "http://localhost:6333",
      pgUrl: "postgres://rql:***@127.0.0.1:5432/rql_studio",
      hasApiKey: true,
    });
  });

  it("defaults backend to qdrant and a local Postgres URL", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: "http://localhost:6333" }));
    const loaded = loadConnection();
    expect(loaded.backend).toBe("qdrant");
    expect(loaded.pgUrl).toMatch(/^postgres:\/\//);
  });

  it("falls back to the local default on corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    expect(loadConnection().url).toBe("http://127.0.0.1:6333");
  });
});
