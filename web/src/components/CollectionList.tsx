import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CollectionInfo } from "../lib/api";
import {
  COLLECTION_VIRTUALIZE_AFTER,
  QDRANT_COLLECTION_NAMES,
  collectionMeta,
  filterCollections,
} from "../lib/collections";

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

function rowMeta(c: CollectionInfo, itemNoun: string): string {
  const count = c.pointsCount == null ? "?" : String(c.pointsCount);
  const extra = QDRANT_COLLECTION_NAMES.includes(c.name)
    ? collectionMeta(c.name).purpose
    : vectorSummary(c.vectors);
  return `${count} ${itemNoun} · ${extra}`;
}

const CollectionRow = memo(function CollectionRow({
  name,
  meta,
  active,
  focused,
  onSelect,
}: {
  name: string;
  meta: string;
  active: boolean;
  focused: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`collection-row-${name}`}
      className={`collection compact ${active ? "active" : ""} ${focused ? "focused" : ""}`}
      onClick={() => onSelect(name)}
    >
      <div className="name">{name}</div>
      <div className="meta">{meta}</div>
    </button>
  );
});

export function CollectionList({
  items,
  selected,
  onSelect,
  emptyHint,
  title = "Collections",
  itemNoun = "points",
  updatedAt = null,
}: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (updatedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [updatedAt]);

  const filtered = useMemo(() => filterCollections(items, query), [items, query]);
  const selectedHidden = Boolean(selected && query.trim() && !filtered.some((c) => c.name === selected));

  useEffect(() => {
    const idx = selected ? filtered.findIndex((c) => c.name === selected) : -1;
    setCursor(idx >= 0 ? idx : 0);
  }, [query, selected, filtered]);

  const virtualize = items.length > COLLECTION_VIRTUALIZE_AFTER;
  const virtualizer = useVirtualizer({
    count: virtualize ? filtered.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  const agoSec = updatedAt == null ? null : Math.max(0, Math.round((now - updatedAt) / 1000));
  const refreshHint =
    agoSec == null ? null : agoSec <= 1 ? "Updated just now" : `Updated ${agoSec}s ago`;

  function clearFilter() {
    setQuery("");
    filterRef.current?.focus();
  }

  function onFilterKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) clearFilter();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      const hit = filtered[cursor];
      if (hit) onSelect(hit.name);
    }
  }

  function renderRow(c: CollectionInfo, index: number) {
    return (
      <CollectionRow
        name={c.name}
        meta={rowMeta(c, itemNoun)}
        active={selected === c.name}
        focused={cursor === index}
        onSelect={onSelect}
      />
    );
  }

  return (
    <section className="collection-pane">
      <div className="pane-head">
        {title}
        <span className="faint" data-testid="collection-refresh">
          {items.length
            ? `${filtered.length} / ${items.length}${refreshHint ? ` · ${refreshHint}` : ""}`
            : items.length}
        </span>
      </div>
      {items.length > 0 ? (
        <div className="collection-search">
          <input
            ref={filterRef}
            id="collection-filter"
            data-testid="collection-filter"
            value={query}
            placeholder="Filter collections"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFilterKeyDown}
          />
          {query ? (
            <button className="btn ghost tiny" type="button" onClick={clearFilter}>
              Clear
            </button>
          ) : null}
          <p className="hint">Filter is local — Studio loads the full GET /collections list.</p>
        </div>
      ) : null}
      {selectedHidden ? (
        <button
          type="button"
          className="collection-hidden-chip"
          data-testid="selected-hidden"
          onClick={clearFilter}
        >
          Selected: {selected} · clear filter to see
        </button>
      ) : null}
      <div ref={scrollRef} className="collection-scroll" data-testid="collection-scroll">
        {items.length === 0 ? (
          <div className="empty">
            <h3>No {title.toLowerCase()}</h3>
            <p>{emptyHint}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <h3>No collections match “{query.trim()}”</h3>
            <p>Clear the filter to see all {items.length} collections.</p>
          </div>
        ) : virtualize ? (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((row) => {
              const c = filtered[row.index];
              if (!c) return null;
              return (
                <div
                  key={c.name}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  {renderRow(c, row.index)}
                </div>
              );
            })}
          </div>
        ) : (
          filtered.map((c, i) => <div key={c.name}>{renderRow(c, i)}</div>)
        )}
      </div>
    </section>
  );
}
