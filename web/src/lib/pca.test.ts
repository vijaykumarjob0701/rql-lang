import { describe, expect, it } from "vitest";
import { extractDenseVector, projectPca } from "./pca";

describe("projectPca", () => {
  it("separates two 1-d clusters along x after lift to 4-d", () => {
    const a = Array.from({ length: 12 }, () => [2 + Math.random() * 0.1, 0, 0, 0]);
    const b = Array.from({ length: 12 }, () => [-2 + Math.random() * 0.1, 0, 0, 0]);
    const pts = projectPca([...a, ...b]);
    expect(pts).toBeTruthy();
    const xs = pts!.map((p) => p.x);
    const left = xs.slice(0, 12);
    const right = xs.slice(12);
    const mean = (arr: number[]) => arr.reduce((s, n) => s + n, 0) / arr.length;
    expect(Math.abs(mean(left) - mean(right))).toBeGreaterThan(1);
  });

  it("returns empty for empty input and null for ragged rows", () => {
    expect(projectPca([])).toEqual([]);
    expect(projectPca([[1, 2], [1]])).toBeNull();
  });

  it("extracts named dense vectors", () => {
    expect(extractDenseVector({ dense: [1, 2, 3] })).toEqual([1, 2, 3]);
    expect(extractDenseVector([4, 5])).toEqual([4, 5]);
  });
});
