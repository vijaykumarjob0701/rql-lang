import { describe, expect, it } from "vitest";
import { COLLECTION_NAMES, COLLECTION_SPECS, generateAllCollections } from "../../scripts/demo-data.mjs";
import {
  QDRANT_COLLECTION_NAMES,
  collectionMeta,
  preferCollection,
  retargetRetrieve,
  sortCollectionNames,
} from "./collections";
import { diagnoseRql } from "./rqlParse";
import { buildQdrantRecipes, recipesForBackend } from "./demoVectors";
import { examplesByKind, qdrantExamples } from "./qdrantExamples";

describe("Qdrant demo collections (the product “tables”)", () => {
  it("seeds at least 5 named collections with distinct purposes", () => {
    expect(COLLECTION_SPECS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(COLLECTION_NAMES).size).toBe(COLLECTION_NAMES.length);
    expect(COLLECTION_NAMES).toEqual(QDRANT_COLLECTION_NAMES);
    expect(COLLECTION_NAMES).toContain("studio_demo");
    expect(COLLECTION_NAMES).toContain("docs_support");
    expect(COLLECTION_NAMES).toContain("docs_legal");
    expect(COLLECTION_NAMES).toContain("docs_product");
    expect(COLLECTION_NAMES).toContain("docs_research");
  });

  it("generates enough points and indexes per collection", () => {
    const bundles = generateAllCollections();
    expect(bundles.length).toBeGreaterThanOrEqual(5);
    for (const bundle of bundles) {
      expect(bundle.points.length, bundle.name).toBeGreaterThanOrEqual(24);
      expect(bundle.indexes.length, bundle.name).toBeGreaterThan(0);
      expect(bundle.points[0]?.vector?.dense?.length).toBe(128);
    }
  });

  it("keeps catalog filters aligned with seed specs", () => {
    for (const spec of COLLECTION_SPECS) {
      const meta = collectionMeta(spec.name);
      expect(meta.filter).toBe(spec.filter);
      expect(meta.altFilter).toBe(spec.altFilter);
    }
  });

  it("retargets RETRIEVE to the selected collection", () => {
    const next = retargetRetrieve(
      "RETRIEVE studio_demo\n  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 8 VECTOR_REF $q_dense;",
      "docs_legal",
    );
    expect(next).toMatch(/^RETRIEVE docs_legal\n/);
  });

  it("builds parseable recipes for every collection", () => {
    for (const name of QDRANT_COLLECTION_NAMES) {
      for (const recipe of buildQdrantRecipes(name)) {
        const d = diagnoseRql(recipe.rql);
        expect(d.ok, `${name}:${recipe.id} ${d.ok ? "" : d.message}`).toBe(true);
        expect(recipe.rql).toContain(`RETRIEVE ${name}`);
      }
    }
    expect(recipesForBackend("qdrant", "docs_support")[0]!.rql).toMatch(/RETRIEVE docs_support/);
    expect(recipesForBackend("qdrant", "docs_support")[0]!.rql).toMatch(/tenant_id = 'acme'/);
  });

  it("keeps the current collection unless it disappeared", () => {
    expect(preferCollection(["studio_demo", "docs_legal"], "docs_legal")).toBe("docs_legal");
    expect(preferCollection(["studio_demo", "docs_legal"], "gone")).toBe("studio_demo");
    expect(preferCollection(["docs_support"], null)).toBe("docs_support");
    expect(preferCollection([], "studio_demo")).toBeNull();
  });

  it("sorts seeded names before unknowns", () => {
    expect(sortCollectionNames(["zzz", "docs_legal", "studio_demo"])).toEqual([
      "studio_demo",
      "docs_legal",
      "zzz",
    ]);
  });

  it("ships Qdrant HTTP examples for update / index / delete / query", () => {
    expect(examplesByKind("update", "docs_support")[0]!.http).toMatch(/PUT \/collections\/docs_support\/points/);
    expect(examplesByKind("index")[0]!.http).toMatch(/\/index/);
    expect(examplesByKind("delete")[0]!.http).toMatch(/\/points\/delete/);
    expect(examplesByKind("query")[0]!.http).toMatch(/\/points\/query/);
    expect(qdrantExamples("logs_ops").every((ex) => ex.http.includes("logs_ops"))).toBe(true);
  });
});
