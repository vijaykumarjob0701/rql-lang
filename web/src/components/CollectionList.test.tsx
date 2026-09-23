import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CollectionList } from "./CollectionList";

describe("CollectionList", () => {
  it("renders every collection name passed in", () => {
    render(
      <CollectionList
        items={[
          { name: "studio_demo", pointsCount: 120, vectors: null, sparseVectors: null, status: "ok", payloadIndexes: [], raw: {} },
          { name: "docs_support", pointsCount: 40, vectors: null, sparseVectors: null, status: "ok", payloadIndexes: [], raw: {} },
          { name: "extra_col", pointsCount: 3, vectors: null, sparseVectors: null, status: "ok", payloadIndexes: [], raw: {} },
        ]}
        selected="studio_demo"
        onSelect={() => {}}
        emptyHint="none"
        updatedAt={Date.now()}
      />,
    );
    expect(screen.getByText("studio_demo")).toBeInTheDocument();
    expect(screen.getByText("docs_support")).toBeInTheDocument();
    expect(screen.getByText("extra_col")).toBeInTheDocument();
    expect(screen.getByTestId("collection-refresh").textContent).toMatch(/Updated/);
  });
});
