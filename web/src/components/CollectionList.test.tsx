import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CollectionList } from "./CollectionList";
import type { CollectionInfo } from "../lib/api";

function item(name: string, pointsCount = 10): CollectionInfo {
  return {
    name,
    pointsCount,
    vectors: null,
    sparseVectors: null,
    status: "ok",
    payloadIndexes: [],
    raw: {},
  };
}

describe("CollectionList", () => {
  it("renders every collection name and filtered/total counts", () => {
    render(
      <CollectionList
        items={[item("studio_demo", 120), item("docs_support", 40), item("extra_col", 3)]}
        selected="studio_demo"
        onSelect={() => {}}
        emptyHint="none"
        updatedAt={Date.now()}
      />,
    );
    expect(screen.getByText("studio_demo")).toBeInTheDocument();
    expect(screen.getByText("docs_support")).toBeInTheDocument();
    expect(screen.getByText("extra_col")).toBeInTheDocument();
    expect(screen.getByTestId("collection-refresh").textContent).toMatch(/3 \/ 3/);
    expect(screen.getByTestId("collection-refresh").textContent).toMatch(/Updated/);
  });

  it("filters case-insensitively and clears on Esc / Clear", () => {
    render(
      <CollectionList
        items={[item("studio_demo"), item("docs_support"), item("docs_legal")]}
        selected="studio_demo"
        onSelect={() => {}}
        emptyHint="none"
      />,
    );
    const input = screen.getByTestId("collection-filter");
    fireEvent.change(input, { target: { value: "DOCS" } });
    expect(screen.getByText("docs_support")).toBeInTheDocument();
    expect(screen.getByText("docs_legal")).toBeInTheDocument();
    expect(screen.queryByText("studio_demo")).not.toBeInTheDocument();
    expect(screen.getByTestId("collection-refresh").textContent).toMatch(/2 \/ 3/);
    expect(screen.getByTestId("selected-hidden")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("studio_demo")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("selects the focused filtered row on Enter", () => {
    const onSelect = vi.fn();
    render(
      <CollectionList
        items={[item("alpha"), item("beta"), item("gamma")]}
        selected="alpha"
        onSelect={onSelect}
        emptyHint="none"
      />,
    );
    const input = screen.getByTestId("collection-filter");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalled();
  });
});
