import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diagnoseRql, parse, ParseError } from "./rqlParse";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "../../../examples");

describe("editor → parse path", () => {
  it("parses the filtered-dense example into a LogicalPlan", () => {
    const text = readFileSync(join(EXAMPLES, "02-filtered-dense.rql"), "utf8");
    const d = diagnoseRql(text);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.plan.kind).toBe("LogicalPlan");
      expect(d.plan.root.op).toBe("Filter");
    }
  });

  it("parses studio default snippet (same grammar as the editor)", () => {
    const rql = `RETRIEVE studio_demo
  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 20 VECTOR_REF $q_dense
  WHERE tenant_id = 'acme' AND clearance >= 2
  ACL_HARD;
`;
    const plan = parse(rql);
    expect(plan.root.op).toBe("Filter");
    expect((plan.root.input as { op: string }).op).toBe("Search_dense");
  });

  it("surfaces ParseError for unsupported EMBED (fail closed)", () => {
    const d = diagnoseRql("RETRIEVE c EMBED TEXT $q SEARCH DENSE CANDIDATES 5 QUERY 'x';");
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.name).toBe("ParseError");
      expect(d.message).toMatch(/EMBED/);
    }
    expect(() => parse("RETRIEVE c EMBED TEXT $q SEARCH DENSE CANDIDATES 5 QUERY 'x';")).toThrow(
      ParseError,
    );
  });
});
