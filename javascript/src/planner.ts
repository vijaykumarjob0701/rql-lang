/** LogicalPlan → PhysicalPlan (deterministic capability rules). */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "./parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = join(__dirname, "profiles");

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export type PhysicalPlan = {
  schemaVersion: string;
  kind: "PhysicalPlan";
  meta: Record<string, unknown>;
  capabilitiesUsed: Record<string, unknown>;
  budgets?: Record<string, unknown>;
  root: Record<string, unknown>;
  [k: string]: unknown;
};

export type Profile = {
  id: string;
  capabilities: Record<string, unknown>;
  filterCaps?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  vendorHints?: string[];
  [k: string]: unknown;
};

export type CompileOptions = {
  profile: string | Profile;
  logicalRef?: string;
  lateRewrite?: string;
};

type Mode = string;

type Capabilities = { subgraph: boolean; specialized_labels: boolean; ann_iterator: boolean };
type Stats = {
  selectivity: number;
  specificity: number;
  correlation: string;
  predicate_kind: string;
  acl_hard: boolean;
};

function choose(stats: Stats, caps: Capabilities): Mode {
  if (stats.acl_hard && stats.predicate_kind === "acl") {
    if (caps.ann_iterator) return "ITERATIVE";
    if (caps.subgraph) return "SUBGRAPH";
    return "PRE";
  }
  if (stats.predicate_kind === "label_eq" && caps.specialized_labels && stats.specificity <= 0.25) return "SPECIALIZED";
  if (stats.selectivity <= 0.05 && caps.subgraph) return "SUBGRAPH";
  if (stats.selectivity <= 0.15 && caps.ann_iterator) return "ITERATIVE";
  if (stats.selectivity >= 0.5 && ["pos", "none", "unknown"].includes(stats.correlation)) return "POST";
  if (stats.selectivity >= 0.3) return "PRE";
  if (caps.ann_iterator) return "ITERATIVE";
  if (caps.subgraph) return "SUBGRAPH";
  if (caps.specialized_labels && stats.predicate_kind === "label_eq") return "SPECIALIZED";
  return "POST";
}

function capsFromProfile(profile: Profile): Capabilities {
  const fc = (profile.filterCaps || {}) as Record<string, unknown>;
  const capsTop = profile.capabilities || {};
  return {
    subgraph: !!fc.subgraph,
    specialized_labels: !!fc.specialized_labels,
    ann_iterator: !!(fc.ann_iterator ?? capsTop.annIterator),
  };
}

function inferStats(predicate: Record<string, unknown> | undefined): Stats {
  const pred = predicate || {};
  const expr = String(pred.expr || "");
  const aclHard = !!pred.aclHard;
  const low = expr.toLowerCase();
  if (aclHard || low.includes("tenant") || low.includes("clearance") || low.includes("acl")) {
    return { selectivity: 0.2, specificity: 1.0, correlation: "unknown", predicate_kind: "acl", acl_hard: true };
  }
  if (expr.includes("=") && !expr.includes("<") && !expr.includes(">") && !low.includes(" and ") && !low.includes(" or ")) {
    return { selectivity: 0.4, specificity: 0.2, correlation: "none", predicate_kind: "label_eq", acl_hard: false };
  }
  if (["<", ">", "<=", ">=", "BETWEEN", "between"].some((op) => expr.includes(op))) {
    return { selectivity: 0.35, specificity: 1.0, correlation: "none", predicate_kind: "range", acl_hard: false };
  }
  if (low.includes(" and ") || low.includes(" or ")) {
    return { selectivity: 0.25, specificity: 1.0, correlation: "unknown", predicate_kind: "complex", acl_hard: false };
  }
  return { selectivity: 0.5, specificity: 1.0, correlation: "unknown", predicate_kind: "complex", acl_hard: false };
}

function chooseFilterMode(predicate: Record<string, unknown> | undefined, profile: Profile): Mode {
  return choose(inferStats(predicate), capsFromProfile(profile));
}

export function listProfiles(profilesDir = PROFILES_DIR): string[] {
  return readdirSync(profilesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadProfile(nameOrPath: string, profilesDir = PROFILES_DIR): Profile {
  let path = nameOrPath;
  if (!path.endsWith(".json") && !path.includes("/") && !path.includes("\\")) {
    path = join(profilesDir, `${nameOrPath}.json`);
  }
  let data: Profile;
  try {
    data = JSON.parse(readFileSync(path, "utf8")) as Profile;
  } catch {
    throw new PlanError(`profile not found: ${path}`);
  }
  if (!data.id || !data.capabilities) throw new PlanError(`profile missing id/capabilities: ${path}`);
  return data;
}

function anyAclHard(node: Record<string, unknown>): boolean {
  if (node.op === "Filter") {
    const pred = (node.predicate || {}) as Record<string, unknown>;
    if (pred.aclHard) return true;
  }
  if (node.input && typeof node.input === "object") {
    if (anyAclHard(node.input as Record<string, unknown>)) return true;
  }
  for (const child of (node.inputs as Record<string, unknown>[] | undefined) || []) {
    if (child && typeof child === "object" && anyAclHard(child)) return true;
  }
  return false;
}

function chooseLateVariant(profile: Profile, lateRewrite: string | undefined, notes: string[]): string {
  const caps = profile.capabilities || {};
  const pref = (lateRewrite || "").toLowerCase().trim() || undefined;
  if (pref && !["colbert", "plaid", "muvera"].includes(pref)) {
    throw new PlanError(`late_rewrite must be colbert|plaid|muvera, got ${JSON.stringify(lateRewrite)}`);
  }
  if (pref === "plaid") {
    if (caps.latePlaid) return "plaid";
    notes.push("late_rewrite=plaid requested but latePlaid not advertised; falling through ladder.");
  }
  if (pref === "muvera") {
    if (caps.fdeMips) return "muvera";
    notes.push("late_rewrite=muvera requested but fdeMips not advertised; falling through ladder.");
  }
  if (pref === "colbert") return "colbert";
  if (caps.multiVectorLate) return "colbert";
  if (caps.latePlaid) { notes.push("Search_late: no multiVectorLate → LateInteractExec variant=plaid."); return "plaid"; }
  if (caps.fdeMips) { notes.push("Search_late: no multiVectorLate/latePlaid → variant=muvera."); return "muvera"; }
  notes.push("Search_late: no multiVectorLate/latePlaid/fdeMips advertised; emit LateInteractExec variant=colbert (adapter must fail closed).");
  return "colbert";
}

export function planLogical(
  logical: Record<string, unknown>,
  profile: Profile,
  opts: { logicalRef?: string; lateRewrite?: string } = {},
): PhysicalPlan {
  if (logical.kind !== "LogicalPlan") throw new PlanError(`expected kind=LogicalPlan, got ${JSON.stringify(logical.kind)}`);
  if (logical.schemaVersion !== SCHEMA_VERSION) {
    throw new PlanError(`unsupported schemaVersion ${JSON.stringify(logical.schemaVersion)}; want ${SCHEMA_VERSION}`);
  }
  if (!logical.root) throw new PlanError("LogicalPlan missing root");

  const caps = (profile.capabilities || {}) as Record<string, unknown>;
  const notes = ["RQL v0.1 planner: deterministic capability rules only; no fabricated latency/recall."];
  if (opts.lateRewrite) notes.push(`late_rewrite preference: ${opts.lateRewrite}`);
  const counter = { n: 0 };
  const nid = (prefix: string, logicalId?: string) => {
    if (logicalId) return `${prefix}_${logicalId}`;
    counter.n += 1;
    return `${prefix}${counter.n}`;
  };

  const planOp = (node: Record<string, unknown>): Record<string, unknown> => {
    const op = node.op;
    if (op === "Search_dense") {
      const defaults = (profile.defaults || {}) as Record<string, unknown>;
      const q = (node.query || {}) as Record<string, unknown>;
      const out: Record<string, unknown> = {
        id: nid("ann", node.id as string | undefined),
        op: "AnnExec",
        k: Number(node.k),
        index: defaults.annIndex ?? "hnsw",
        metric: node.metric || "unknown",
      };
      if (defaults.efSearch) out.efSearch = Number(defaults.efSearch);
      if (q.vectorRef) out.queryRef = q.vectorRef;
      if (node.collection) out.collection = node.collection;
      return out;
    }
    if (op === "Search_bm25") {
      const q = (node.query || {}) as Record<string, unknown>;
      const out: Record<string, unknown> = { id: nid("bm25", node.id as string | undefined), op: "Bm25Exec", k: Number(node.k) };
      if (q.text !== undefined) out.queryText = q.text;
      if (node.collection) out.collection = node.collection;
      return out;
    }
    if (op === "Search_late") {
      const q = (node.query || {}) as Record<string, unknown>;
      const variant = chooseLateVariant(profile, opts.lateRewrite, notes);
      const out: Record<string, unknown> = {
        id: nid("late", node.id as string | undefined),
        op: "LateInteractExec",
        variant,
        k: Number(node.k),
      };
      if (variant === "plaid" || variant === "muvera") out.candidateDepth = Math.max(1000, Number(node.k) * 100);
      if (q.vectorRef) out.queryRef = q.vectorRef;
      if (node.collection) out.collection = node.collection;
      return out;
    }
    if (op === "Filter") {
      const pred = (node.predicate || {}) as Record<string, unknown>;
      if (!("expr" in pred)) throw new PlanError("Filter missing predicate.expr");
      const mode = chooseFilterMode(pred, profile);
      let pruning = "unknown";
      if (mode === "PRE") pruning = "SSP";
      else if (mode === "POST") pruning = "VSP";
      else if (mode === "SUBGRAPH" || mode === "SPECIALIZED") pruning = "VJP";
      else if (mode === "ITERATIVE") pruning = "VSP";
      const predOut: Record<string, unknown> = { expr: pred.expr };
      if ("aclHard" in pred) predOut.aclHard = !!pred.aclHard;
      return {
        id: nid("fexec", node.id as string | undefined),
        op: "FilterExec",
        mode,
        pruningStrategy: pruning,
        predicate: predOut,
        input: planOp(node.input as Record<string, unknown>),
      };
    }
    if (op === "Fuse_rrf") {
      const native = !!caps.rrfNative;
      const inputs = ((node.inputs as Record<string, unknown>[]) || []).map(planOp);
      if (inputs.length < 2) throw new PlanError("Fuse_rrf requires ≥2 inputs");
      const fuse: Record<string, unknown> = {
        id: nid("fuse", node.id as string | undefined),
        op: "FusionExec",
        family: "rrf",
        native,
        inputs,
      };
      if ("k_rrf" in node) fuse.k_rrf = Number(node.k_rrf);
      if (native) { notes.push("Fuse_rrf → FusionExec native (profile.rrfNative)."); return fuse; }
      notes.push("Fuse_rrf → ShimCast client_rrf (rrfNative=false).");
      return {
        id: nid("shim_rrf", node.id as string | undefined),
        op: "ShimCast",
        shim: "client_rrf",
        expensive: true,
        aclUnsafe: false,
        input: fuse,
      };
    }
    if (op === "Fuse_linear") {
      const native = !!caps.weightedFusionNative;
      const inputs = ((node.inputs as Record<string, unknown>[]) || []).map(planOp);
      if (inputs.length < 2) throw new PlanError("Fuse_linear requires ≥2 inputs");
      const fuse: Record<string, unknown> = {
        id: nid("fuse", node.id as string | undefined),
        op: "FusionExec",
        family: "linear",
        native,
        inputs,
      };
      if ("alpha" in node) fuse.alpha = node.alpha;
      if (native) { notes.push("Fuse_linear → FusionExec native (weightedFusionNative)."); return fuse; }
      notes.push("Fuse_linear → ShimCast client_linear (weightedFusionNative=false).");
      return {
        id: nid("shim_lin", node.id as string | undefined),
        op: "ShimCast",
        shim: "client_linear",
        expensive: true,
        aclUnsafe: false,
        input: fuse,
      };
    }
    throw new PlanError(`unsupported logical op: ${JSON.stringify(op)}`);
  };

  const rootPhys = planOp(logical.root as Record<string, unknown>);
  const aclSafe = anyAclHard(logical.root as Record<string, unknown>);
  const capabilitiesUsed: Record<string, unknown> = {};
  for (const k of [
    "filterAnnComposition", "hybridBm25Dense", "rrfNative", "weightedFusionNative",
    "multiVectorLate", "latePlaid", "fdeMips", "explainNative", "annIterator",
  ]) {
    if (k in caps) capabilitiesUsed[k] = structuredClone(caps[k]);
  }
  const hints = (profile.vendorHints || caps.vendorHints || []) as unknown[];
  if (hints.length) capabilitiesUsed.vendorHints = hints;

  const meta: Record<string, unknown> = { label: "Hypothesis", notes: notes.join(" "), profileId: profile.id };
  if (opts.logicalRef) meta.logicalPlanRef = opts.logicalRef;

  const out: PhysicalPlan = {
    schemaVersion: SCHEMA_VERSION,
    kind: "PhysicalPlan",
    meta,
    capabilitiesUsed,
    root: rootPhys,
  };
  if (aclSafe) out.budgets = { aclSafe: true };
  return out;
}

/** Compile LogicalPlan → PhysicalPlan. */
export function compile(logical: Record<string, unknown>, options: CompileOptions): PhysicalPlan {
  const profile = typeof options.profile === "string" ? loadProfile(options.profile) : options.profile;
  return planLogical(logical, profile, {
    logicalRef: options.logicalRef,
    lateRewrite: options.lateRewrite,
  });
}
