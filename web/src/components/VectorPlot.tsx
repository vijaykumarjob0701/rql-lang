import { useEffect, useMemo, useRef, useState } from "react";
import type { ScrollPoint } from "../lib/api";
import { extractDenseVector, projectPca } from "../lib/pca";
import { colorForValue, payloadFields } from "../lib/schema";

const PALETTE = ["#3ee0b5", "#7eb6ff", "#f0b429", "#ff8b6b", "#c9a0ff", "#9be8d1", "#f6d27a", "#ffb3bb"];

type Props = {
  points: ScrollPoint[];
  loading: boolean;
  error: string | null;
};

export function VectorPlot({ points, loading, error }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [colorBy, setColorBy] = useState<string>("");
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    id: unknown;
    payload: Record<string, unknown>;
  } | null>(null);

  const fields = useMemo(() => payloadFields(points.map((p) => p.payload)), [points]);
  const prepared = useMemo(() => {
    const rows = points
      .map((p) => ({ point: p, vec: extractDenseVector(p.vector) }))
      .filter((r): r is { point: ScrollPoint; vec: number[] } => r.vec != null);
    const projected = projectPca(rows.map((r) => r.vec));
    if (!projected) return [];
    return rows.map((r, i) => ({
      id: r.point.id,
      payload: r.point.payload,
      x: projected[i]!.x,
      y: projected[i]!.y,
    }));
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 640;
    const cssH = canvas.clientHeight || 360;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#0b1018";
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.strokeStyle = "#1c2634";
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo((cssW / 6) * i, 0);
      ctx.lineTo((cssW / 6) * i, cssH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (cssH / 6) * i);
      ctx.lineTo(cssW, (cssH / 6) * i);
      ctx.stroke();
    }

    if (!prepared.length) return;
    const xs = prepared.map((p) => p.x);
    const ys = prepared.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 28;
    const sx = maxX === minX ? 1 : (cssW - pad * 2) / (maxX - minX);
    const sy = maxY === minY ? 1 : (cssH - pad * 2) / (maxY - minY);

    for (const p of prepared) {
      const x = pad + (p.x - minX) * sx;
      const y = cssH - pad - (p.y - minY) * sy;
      ctx.beginPath();
      ctx.fillStyle = colorBy ? colorForValue(p.payload[colorBy], PALETTE) : "#3ee0b5";
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [prepared, colorBy]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !prepared.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cssW = rect.width;
    const cssH = rect.height;
    const xs = prepared.map((p) => p.x);
    const ys = prepared.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 28;
    const sx = maxX === minX ? 1 : (cssW - pad * 2) / (maxX - minX);
    const sy = maxY === minY ? 1 : (cssH - pad * 2) / (maxY - minY);
    let best = Infinity;
    let hit: (typeof prepared)[number] | null = null;
    for (const p of prepared) {
      const x = pad + (p.x - minX) * sx;
      const y = cssH - pad - (p.y - minY) * sy;
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < best) {
        best = d;
        hit = p;
      }
    }
    if (hit && best < 14 * 14) setHover({ x: mx + 12, y: my + 12, id: hit.id, payload: hit.payload });
    else setHover(null);
  }

  const skipped = points.length - prepared.length;
  const values = colorBy ? Array.from(new Set(prepared.map((p) => String(p.payload[colorBy] ?? "∅")))) : [];

  return (
    <div>
      {error ? <div className="banner err">{error}</div> : null}
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="field" style={{ margin: 0, minWidth: 180 }}>
          <label htmlFor="color-by">Color by payload</label>
          <select id="color-by" value={colorBy} onChange={(e) => setColorBy(e.target.value)}>
            <option value="">(none)</option>
            {fields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <p className="hint" style={{ alignSelf: "end" }}>
          {loading
            ? "Loading sample…"
            : `${prepared.length} projected · PCA (in-browser)${skipped ? ` · ${skipped} without dense vectors` : ""}`}
        </p>
      </div>
      {prepared.length === 0 && !loading ? (
        <div className="empty">
          <h3>Nothing to project</h3>
          <p>
            Scroll returned no dense vectors. Seed <code>studio_demo</code> or pick a collection that
            stores vectors.
          </p>
        </div>
      ) : (
        <div className="plot-wrap">
          <canvas
            ref={canvasRef}
            data-testid="vector-plot"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
          {hover ? (
            <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
              <strong>id {String(hover.id)}</strong>
              <div className="muted">
                {Object.entries(hover.payload)
                  .slice(0, 6)
                  .map(([k, v]) => (
                    <div key={k}>
                      {k}: {String(v)}
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
      {colorBy && values.length ? (
        <div className="legend">
          {values.slice(0, 12).map((v) => (
            <span key={v}>
              <i style={{ background: colorForValue(v, PALETTE) }} />
              {v}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
