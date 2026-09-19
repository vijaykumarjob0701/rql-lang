/** Human-readable / structured explanation of a PhysicalPlan. */

export type ExplainFormat = "text" | "object";

export type ExplainObject = {
  kind: "PhysicalPlanExplain";
  schemaVersion?: unknown;
  profileId?: unknown;
  label?: unknown;
  notes?: unknown;
  capabilitiesUsed: Record<string, unknown>;
  budgets: Record<string, unknown>;
  ops: { id: unknown; op: unknown; depth: number; detail: string }[];
  tree: string;
  notExecuted: true;
};

export function explain(
  physical: Record<string, unknown>,
  options: { format?: ExplainFormat } = {},
): string | ExplainObject {
  if (physical.kind !== "PhysicalPlan") {
    throw new Error(`expected kind=PhysicalPlan, got ${JSON.stringify(physical.kind)}`);
  }
  const format = options.format ?? "text";
  const meta = (physical.meta || {}) as Record<string, unknown>;
  const caps = (physical.capabilitiesUsed || {}) as Record<string, unknown>;
  const budgets = (physical.budgets || {}) as Record<string, unknown>;
  const root = (physical.root || {}) as Record<string, unknown>;
  const lines: string[] = [];
  const ops: ExplainObject["ops"] = [];

  const walk = (node: Record<string, unknown>, depth = 0): void => {
    const op = String(node.op ?? "?");
    const nid = node.id ?? "";
    const detailParts: string[] = [];
    if (op === "AnnExec") detailParts.push(`k=${node.k} index=${node.index} metric=${node.metric}`);
    else if (op === "Bm25Exec") detailParts.push(`k=${node.k}`);
    else if (op === "LateInteractExec") detailParts.push(`variant=${node.variant} k=${node.k}`);
    else if (op === "FilterExec") {
      detailParts.push(`mode=${node.mode} pruning=${node.pruningStrategy}`);
      const pred = (node.predicate || {}) as Record<string, unknown>;
      if (pred.aclHard) detailParts.push("aclHard");
    } else if (op === "FusionExec") detailParts.push(`family=${node.family} native=${node.native}`);
    else if (op === "ShimCast") detailParts.push(`shim=${node.shim} expensive=${node.expensive}`);
    const detail = detailParts.join(" ");
    lines.push(`${"  ".repeat(depth)}${op}(${nid})${detail ? " " + detail : ""}`);
    ops.push({ id: nid, op, depth, detail });
    if (node.input && typeof node.input === "object") walk(node.input as Record<string, unknown>, depth + 1);
    for (const child of (node.inputs as Record<string, unknown>[] | undefined) || []) {
      if (child && typeof child === "object") walk(child, depth + 1);
    }
  };
  walk(root);

  const obj: ExplainObject = {
    kind: "PhysicalPlanExplain",
    schemaVersion: physical.schemaVersion,
    profileId: meta.profileId,
    label: meta.label,
    notes: meta.notes,
    capabilitiesUsed: caps,
    budgets,
    ops,
    tree: lines.join("\n"),
    notExecuted: true,
  };
  if (format === "object") return obj;

  const out = [
    `PhysicalPlan explain (profile=${meta.profileId ?? "?"})`,
    `schemaVersion=${physical.schemaVersion} label=${meta.label}`,
  ];
  if (meta.notes) out.push(`notes: ${meta.notes}`);
  if (Object.keys(budgets).length) out.push(`budgets: ${JSON.stringify(budgets)}`);
  out.push("tree:");
  out.push(...lines);
  out.push("(sketch / notExecuted — emit is docs-shaped until live adapters)");
  return out.join("\n") + "\n";
}
