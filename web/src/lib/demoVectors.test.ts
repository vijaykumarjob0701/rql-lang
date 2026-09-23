import { describe, expect, it } from "vitest";
import { diagnoseRql } from "./rqlParse";
import { DEFAULT_RECIPE, DEMO_RECIPES, recipeBindings } from "./demoVectors";

describe("demo recipes", () => {
  it("every recipe parses with the library", () => {
    for (const recipe of DEMO_RECIPES) {
      const d = diagnoseRql(recipe.rql);
      expect(d.ok, recipe.id).toBe(true);
    }
  });

  it("default recipe is first-click executable (stored dense vector bound)", () => {
    const bind = recipeBindings(DEFAULT_RECIPE);
    expect(DEFAULT_RECIPE.kind).toBe("dense");
    expect(bind.dense).toBeTruthy();
    expect(bind.dense!.length).toBeGreaterThan(8);
    expect(bind.dense!.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("hybrid recipe ships a stored sparse binding", () => {
    const hybrid = DEMO_RECIPES.find((r) => r.id === "hybrid-rrf")!;
    const bind = recipeBindings(hybrid);
    expect(bind.dense).toBeTruthy();
    expect(bind.sparse?.indices.length).toBeGreaterThan(0);
    expect(bind.sparse?.values.length).toBe(bind.sparse?.indices.length);
  });

  it("fail-closed recipes still parse and still bind a demo dense vector", () => {
    for (const recipe of DEMO_RECIPES.filter((r) => r.kind === "fail-closed")) {
      const bind = recipeBindings(recipe);
      expect(bind.dense, recipe.id).toBeTruthy();
    }
  });
});
