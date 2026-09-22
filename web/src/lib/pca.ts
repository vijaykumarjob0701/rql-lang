export type Point2 = { x: number; y: number };

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function matVec(matrix: number[][], v: number[]): number[] {
  return matrix.map((row) => dot(row, v));
}

function powerIteration(cov: number[][], dim: number, exclude?: number[]): number[] {
  let v = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  if (norm(v) === 0) v[0] = 1;
  for (let iter = 0; iter < 40; iter++) {
    let w = matVec(cov, v);
    if (exclude) {
      const proj = dot(w, exclude);
      w = w.map((x, i) => x - proj * exclude[i]!);
    }
    const n = norm(w);
    if (n === 0) break;
    v = w.map((x) => x / n);
  }
  return v;
}

/** Centered PCA → first two components. Returns null if the sample is degenerate. */
export function projectPca(vectors: number[][]): Point2[] | null {
  if (vectors.length === 0) return [];
  const dim = vectors[0]!.length;
  if (dim < 1) return null;
  if (!vectors.every((v) => v.length === dim && v.every((n) => Number.isFinite(n)))) return null;

  const mean = Array.from({ length: dim }, (_, j) => {
    let s = 0;
    for (const v of vectors) s += v[j]!;
    return s / vectors.length;
  });
  const centered = vectors.map((v) => v.map((x, j) => x - mean[j]!));

  if (dim === 1) {
    return centered.map((v) => ({ x: v[0]!, y: 0 }));
  }

  const cov: number[][] = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (const v of centered) {
    for (let i = 0; i < dim; i++) {
      for (let j = i; j < dim; j++) {
        const val = v[i]! * v[j]!;
        cov[i]![j] += val;
        if (i !== j) cov[j]![i] += val;
      }
    }
  }
  const scale = 1 / Math.max(1, vectors.length - 1);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) cov[i]![j] *= scale;
  }

  const pc1 = powerIteration(cov, dim);
  const pc2 = powerIteration(cov, dim, pc1);
  return centered.map((v) => ({ x: dot(v, pc1), y: dot(v, pc2) }));
}

export function extractDenseVector(raw: unknown, preferredName = "dense"): number[] | null {
  if (Array.isArray(raw) && raw.every((n) => typeof n === "number")) return raw as number[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const named = obj[preferredName];
    if (Array.isArray(named) && named.every((n) => typeof n === "number")) return named as number[];
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.every((n) => typeof n === "number")) return v as number[];
    }
  }
  return null;
}
