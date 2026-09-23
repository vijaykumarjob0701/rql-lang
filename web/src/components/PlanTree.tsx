type NodeRec = Record<string, unknown>;

function childrenOf(node: NodeRec): NodeRec[] {
  const out: NodeRec[] = [];
  if (node.input && typeof node.input === "object") out.push(node.input as NodeRec);
  for (const c of (node.inputs as NodeRec[] | undefined) || []) {
    if (c && typeof c === "object") out.push(c);
  }
  return out;
}

function detail(node: NodeRec): string {
  const parts: string[] = [];
  if (node.collection) parts.push(String(node.collection));
  if (node.k != null) parts.push(`k=${node.k}`);
  if (node.metric) parts.push(String(node.metric));
  if (node.mode) parts.push(`mode=${node.mode}`);
  if (node.family) parts.push(String(node.family));
  if (node.variant) parts.push(String(node.variant));
  if (node.native != null) parts.push(`native=${String(node.native)}`);
  if (node.shim) parts.push(`shim=${node.shim}`);
  const pred = node.predicate as { expr?: string } | undefined;
  if (pred?.expr) parts.push(pred.expr);
  return parts.join(" · ");
}

function Tree({ node, kind }: { node: NodeRec; kind: "logical" | "physical" }) {
  const op = String(node.op ?? node.kind ?? "?");
  return (
    <div className="plan-node">
      <span className={`plan-chip ${kind === "physical" ? "phys" : ""}`}>{op}</span>
      <span className="muted">{detail(node)}</span>
      {childrenOf(node).map((child, i) => (
        <Tree key={i} node={child} kind={kind} />
      ))}
    </div>
  );
}

export function PlanTree({
  logical,
  physical,
}: {
  logical: Record<string, unknown> | null;
  physical: Record<string, unknown> | null;
}) {
  if (!logical && !physical) {
    return (
      <div className="empty">
        <h3>No plan yet</h3>
        <p>Run Explain or Emit to walk LogicalPlan → PhysicalPlan.</p>
      </div>
    );
  }
  return (
    <div>
      {logical ? (
        <div className="card" style={{ marginBottom: 10 }}>
          <h4>LogicalPlan</h4>
          <Tree node={(logical.root as NodeRec) || logical} kind="logical" />
        </div>
      ) : null}
      {physical ? (
        <div className="card">
          <h4>PhysicalPlan</h4>
          <Tree node={(physical.root as NodeRec) || physical} kind="physical" />
        </div>
      ) : null}
    </div>
  );
}
