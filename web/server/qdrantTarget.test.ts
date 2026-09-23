import { afterEach, describe, expect, it } from "vitest";
import { resolveQdrantApiKey, resolveQdrantTarget } from "./qdrantTarget";

describe("resolveQdrantTarget", () => {
  afterEach(() => {
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
  });

  it("uses the client URL when QDRANT_URL is unset", () => {
    expect(resolveQdrantTarget("http://127.0.0.1:6333")).toBe("http://127.0.0.1:6333");
  });

  it("remaps loopback to the compose service URL", () => {
    process.env.QDRANT_URL = "http://qdrant:6333";
    expect(resolveQdrantTarget("http://localhost:6333")).toBe("http://qdrant:6333");
    expect(resolveQdrantTarget("http://127.0.0.1:6333/")).toBe("http://qdrant:6333");
  });

  it("leaves cloud URLs alone", () => {
    process.env.QDRANT_URL = "http://qdrant:6333";
    expect(resolveQdrantTarget("https://abc.cloud.qdrant.io")).toBe("https://abc.cloud.qdrant.io");
  });

  it("falls back to QDRANT_URL when the client omits a url", () => {
    process.env.QDRANT_URL = "http://qdrant:6333";
    expect(resolveQdrantTarget("")).toBe("http://qdrant:6333");
  });

  it("prefers a client API key over the env key", () => {
    process.env.QDRANT_API_KEY = "env-secret";
    expect(resolveQdrantApiKey("from-ui")).toBe("from-ui");
    expect(resolveQdrantApiKey("")).toBe("env-secret");
  });
});
