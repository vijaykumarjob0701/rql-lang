import type { DemoRecipe } from "../lib/demoVectors";

export function RecipeList({
  recipes,
  selectedId,
  onSelect,
}: {
  recipes: DemoRecipe[];
  selectedId: string | null;
  onSelect: (recipe: DemoRecipe) => void;
}) {
  return (
    <section style={{ flex: 0, minHeight: 0 }}>
      <div className="pane-head">
        Recipes
        <span className="faint">stored demo vectors</span>
      </div>
      <div className="pane-body" style={{ maxHeight: 280 }}>
        {recipes.map((r) => (
          <button
            key={r.id}
            type="button"
            data-testid={`recipe-${r.id}`}
            className={`collection ${selectedId === r.id ? "active" : ""}`}
            onClick={() => onSelect(r)}
          >
            <div className="name">
              {r.title}
              <span className={`recipe-kind ${r.kind}`}>{r.kind}</span>
            </div>
            <div className="meta">{r.blurb}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
