import { useEffect, useState } from "react";
import type { CollectionInfo } from "../lib/api";
import { QDRANT_COLLECTION_NAMES, collectionMeta } from "../lib/collections";

type Props = {
  items: CollectionInfo[];
  selected: string | null;
  onSelect: (name: string) => void;
  emptyHint: string;
  title?: string;
  itemNoun?: string;
  updatedAt?: number | null;
};

function vectorSummary(vectors: unknown): string {
  if (!vectors) return "no vector config";
  if (typeof vectors === "object" && vectors && "size" in vectors) {
    const v = vectors as { size?: unknown; distance?: unknown };
    return `${v.size ?? "?"}d ${v.distance ?? ""}`.trim();
  }
  if (typeof vectors === "object" && vectors) {
    const names = Object.keys(vectors as object);
    if (!names.length) return "empty vectors map";
    const first = names[0]!;
    const cfg = (vectors as Record<string, { size?: unknown; distance?: unknown }>)[first];
    return `${names.length} named · ${first} ${cfg?.size ?? "?"}d`;
  }
  return "unknown config";
}

export function CollectionList({
  items,
  selected,
  onSelect,
  emptyHint,
  title = "Collections",
  itemNoun = "points",
  updatedAt = null,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (updatedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [updatedAt]);
  const agoSec = updatedAt == null ? null : Math.max(0, Math.round((now - updatedAt) / 1000));
  const refreshHint =
    agoSec == null ? null : agoSec <= 1 ? "Updated just now" : `Updated ${agoSec}s ago`;

  return (
    <section style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="pane-head">
        {title}
        <span className="faint" data-testid="collection-refresh">
          {refreshHint ? `${items.length} · ${refreshHint}` : items.length}
        </span>
      </div>
      <div className="pane-body">
        {items.length === 0 ? (
          <div className="empty">
            <h3>No {title.toLowerCase()}</h3>
            <p>{emptyHint}</p>
          </div>
        ) : (
          items.map((c) => (
            <button
              key={c.name}
              type="button"
              className={`collection ${selected === c.name ? "active" : ""}`}
              onClick={() => onSelect(c.name)}
            >
              <div className="name">{c.name}</div>
              <div className="meta">
                {c.pointsCount == null ? "count unknown" : `${c.pointsCount} ${itemNoun}`}
                {" · "}
                {QDRANT_COLLECTION_NAMES.includes(c.name)
                  ? collectionMeta(c.name).purpose
                  : vectorSummary(c.vectors)}
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
