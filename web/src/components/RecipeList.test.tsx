import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEMO_RECIPES } from "../lib/demoVectors";
import { RecipeList } from "./RecipeList";

describe("RecipeList", () => {
  it("renders recipe titles and reports a click", () => {
    const onSelect = vi.fn();
    render(<RecipeList recipes={DEMO_RECIPES} selectedId="filtered-dense" onSelect={onSelect} />);
    expect(screen.getByTestId("recipe-hybrid-rrf")).toBeInTheDocument();
    screen.getByTestId("recipe-hybrid-rrf").click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "hybrid-rrf" }));
  });
});
