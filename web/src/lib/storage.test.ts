import { afterEach, describe, expect, it } from "vitest";
import { loadConnection, redactConnection, saveConnection, STORAGE_KEY } from "./storage";

describe("connection storage", () => {
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it("round-trips url + api key without exposing the secret in redact", () => {
    saveConnection({ url: "http://localhost:6333", apiKey: "super-secret" });
    const loaded = loadConnection();
    expect(loaded.apiKey).toBe("super-secret");
    expect(redactConnection(loaded)).toEqual({ url: "http://localhost:6333", hasApiKey: true });
  });

  it("falls back to the local default on corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    expect(loadConnection().url).toBe("http://127.0.0.1:6333");
  });
});
