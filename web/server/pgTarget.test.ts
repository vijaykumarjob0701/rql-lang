import { afterEach, describe, expect, it } from "vitest";
import { redactDatabaseUrl, resolvePgTarget } from "./pgTarget";

describe("resolvePgTarget", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it("uses the client URL when DATABASE_URL is unset", () => {
    expect(resolvePgTarget("postgres://rql:rql@127.0.0.1:5432/rql_studio")).toBe(
      "postgres://rql:rql@127.0.0.1:5432/rql_studio",
    );
  });

  it("remaps loopback to the compose service URL", () => {
    process.env.DATABASE_URL = "postgres://rql:rql@postgres:5432/rql_studio";
    expect(resolvePgTarget("postgres://rql:rql@localhost:5432/rql_studio")).toBe(
      "postgres://rql:rql@postgres:5432/rql_studio",
    );
    expect(resolvePgTarget("postgres://rql:rql@127.0.0.1:5432/rql_studio")).toBe(
      "postgres://rql:rql@postgres:5432/rql_studio",
    );
  });

  it("leaves remote hosts alone", () => {
    process.env.DATABASE_URL = "postgres://rql:rql@postgres:5432/rql_studio";
    expect(resolvePgTarget("postgres://rql:rql@db.example:5432/rql_studio")).toBe(
      "postgres://rql:rql@db.example:5432/rql_studio",
    );
  });

  it("redacts the password", () => {
    expect(redactDatabaseUrl("postgres://rql:secret@127.0.0.1:5432/rql_studio")).toContain("***");
    expect(redactDatabaseUrl("postgres://rql:secret@127.0.0.1:5432/rql_studio")).not.toContain("secret");
  });
});
