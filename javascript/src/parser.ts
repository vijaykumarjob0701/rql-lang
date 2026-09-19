/** RQL text → LogicalPlan (v0.1 subset). */

export const SCHEMA_VERSION = "0.1.0-draft";

const CHANNEL_OPS: Record<string, [string, string]> = {
  DENSE: ["Search_dense", "dense"],
  BM25: ["Search_bm25", "bm25"],
  LATE: ["Search_late", "late"],
  COLBERT: ["Search_late", "late"],
};
const METRICS = new Set(["cosine", "l2", "ip", "dot", "unknown"]);
const UNSUPPORTED = new Set([
  "EMBED", "WITH", "RERANK", "DIVERSIFY", "EXPAND", "REWRITE", "TRAVERSE",
  "VSIM", "FILTER_MODE", "OPTION", "UNION", "EXPLAIN", "ORDER", "OFFSET",
]);

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export type LogicalPlan = {
  schemaVersion: string;
  kind: "LogicalPlan";
  meta?: { label?: string; notes?: string; [k: string]: unknown };
  root: Record<string, unknown>;
  [k: string]: unknown;
};

type Token = { kind: string; value: string; pos: number };

type SearchArm = {
  channel: string;
  field?: string;
  metric?: string;
  k?: number;
  queryText?: string;
  vectorRef?: string;
};

type RetrieveAst = {
  collection: string;
  arms: SearchArm[];
  where?: string;
  aclHard: boolean;
  fuse?: string;
  fuseK?: number;
  fuseWeights?: number[];
  limit?: number;
};

function stripComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let inS = false, inD = false;
      let out = "";
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'" && !inD) { inS = !inS; out += ch; continue; }
        if (ch === '"' && !inS) { inD = !inD; out += ch; continue; }
        if (!inS && !inD && ch === "-" && line[i + 1] === "-") break;
        out += ch;
      }
      return out;
    })
    .join("\n");
}

function tokenize(text: string): Token[] {
  const s = stripComments(text);
  const tokens: Token[] = [];
  let i = 0;
  const n = s.length;
  const ident = /[A-Za-z_][A-Za-z0-9_]*/y;
  const number = /\d+(?:\.\d+)?/y;
  const param = /\$[A-Za-z_][A-Za-z0-9_]*/y;
  const sq = /'([^']*)'/y;
  const dq = /"([^"]*)"/y;
  while (i < n) {
    while (i < n && /\s/.test(s[i]!)) i++;
    if (i >= n) break;
    if (s[i] === ";") { tokens.push({ kind: "SEMI", value: ";", pos: i }); i++; continue; }
    if (s[i] === ",") { tokens.push({ kind: "COMMA", value: ",", pos: i }); i++; continue; }
    if (s[i] === "(") { tokens.push({ kind: "LPAREN", value: "(", pos: i }); i++; continue; }
    if (s[i] === ")") { tokens.push({ kind: "RPAREN", value: ")", pos: i }); i++; continue; }
    if (s.startsWith(">=", i) || s.startsWith("<=", i) || s.startsWith("!=", i) || s.startsWith("<>", i)) {
      tokens.push({ kind: "OP", value: s.slice(i, i + 2), pos: i }); i += 2; continue;
    }
    if ("=<>".includes(s[i]!)) { tokens.push({ kind: "OP", value: s[i]!, pos: i }); i++; continue; }
    param.lastIndex = i; let m = param.exec(s);
    if (m) { tokens.push({ kind: "PARAM", value: m[0], pos: i }); i = param.lastIndex; continue; }
    sq.lastIndex = i; m = sq.exec(s);
    if (m) { tokens.push({ kind: "STRING", value: m[1]!, pos: i }); i = sq.lastIndex; continue; }
    dq.lastIndex = i; m = dq.exec(s);
    if (m) { tokens.push({ kind: "STRING", value: m[1]!, pos: i }); i = dq.lastIndex; continue; }
    number.lastIndex = i; m = number.exec(s);
    if (m) { tokens.push({ kind: "NUMBER", value: m[0], pos: i }); i = number.lastIndex; continue; }
    ident.lastIndex = i; m = ident.exec(s);
    if (m) { tokens.push({ kind: "IDENT", value: m[0], pos: i }); i = ident.lastIndex; continue; }
    throw new ParseError(`Unexpected character ${JSON.stringify(s[i])} at position ${i}`);
  }
  tokens.push({ kind: "EOF", value: "", pos: i });
  return tokens;
}

class Parser {
  toks: Token[];
  i = 0;
  constructor(tokens: Token[]) { this.toks = tokens; }
  cur(): Token { return this.toks[this.i]!; }
  peekKw(): string {
    const t = this.cur();
    return t.kind === "IDENT" ? t.value.toUpperCase() : t.kind;
  }
  acceptKw(...words: string[]): Token | null {
    const set = new Set(words.map((w) => w.toUpperCase()));
    if (set.has(this.peekKw())) { const t = this.cur(); this.i++; return t; }
    return null;
  }
  expectKw(...words: string[]): Token {
    const t = this.acceptKw(...words);
    if (!t) throw new ParseError(`Expected keyword ${words.join("/")}, got ${JSON.stringify(this.cur().value)} at pos ${this.cur().pos}`);
    return t;
  }
  expect(kind: string): Token {
    const t = this.cur();
    if (t.kind !== kind) throw new ParseError(`Expected ${kind}, got ${t.kind}(${JSON.stringify(t.value)}) at pos ${t.pos}`);
    this.i++;
    return t;
  }
  rejectUnsupported(): void {
    const kw = this.peekKw();
    if (UNSUPPORTED.has(kw)) throw new ParseError(`Parser does not support ${kw} (v0.1 subset).`);
  }
  parse(): RetrieveAst {
    this.rejectUnsupported();
    this.expectKw("RETRIEVE");
    const coll = this.expect("IDENT");
    const ast: RetrieveAst = { collection: coll.value, arms: [], aclHard: false };
    this.rejectUnsupported();
    this.expectKw("SEARCH");
    ast.arms.push(this.parseArm());
    while (this.acceptKw("AND")) ast.arms.push(this.parseArm());
    if (this.acceptKw("WHERE")) ast.where = this.parsePredicate();
    if (this.acceptKw("ACL_HARD")) {
      ast.aclHard = true;
      if (ast.where === undefined) throw new ParseError("ACL_HARD requires a preceding WHERE clause");
    }
    if (this.acceptKw("FUSE")) this.parseFuse(ast);
    if (this.acceptKw("LIMIT")) {
      const n = this.expect("NUMBER");
      if (n.value.includes(".")) throw new ParseError("LIMIT must be an integer");
      ast.limit = parseInt(n.value, 10);
    }
    this.rejectUnsupported();
    if (this.cur().kind === "SEMI") this.i++;
    if (this.cur().kind !== "EOF") {
      this.rejectUnsupported();
      throw new ParseError(`Unexpected token ${JSON.stringify(this.cur().value)} at pos ${this.cur().pos}`);
    }
    return ast;
  }
  parseArm(): SearchArm {
    this.rejectUnsupported();
    const ch = this.peekKw();
    if (!(ch in CHANNEL_OPS)) throw new ParseError(`Expected SEARCH channel DENSE|BM25|LATE|COLBERT, got ${JSON.stringify(this.cur().value)}`);
    this.i++;
    const arm: SearchArm = { channel: ch };
    if (this.acceptKw("ON")) arm.field = this.expect("IDENT").value;
    if (this.acceptKw("METRIC")) {
      const mtok = this.expect("IDENT");
      const m = mtok.value.toLowerCase();
      if (!METRICS.has(m)) throw new ParseError(`Unknown metric ${JSON.stringify(mtok.value)}`);
      arm.metric = m === "dot" ? "ip" : m;
    }
    if (this.acceptKw("K", "CANDIDATES")) {
      const n = this.expect("NUMBER");
      if (n.value.includes(".") || parseInt(n.value, 10) < 1) throw new ParseError("K/CANDIDATES must be a positive integer");
      arm.k = parseInt(n.value, 10);
    }
    if (this.acceptKw("QUERY")) {
      const t = this.cur();
      if (t.kind === "STRING" || t.kind === "PARAM") { arm.queryText = t.value; this.i++; }
      else throw new ParseError("QUERY expects a string or $param");
    }
    if (this.acceptKw("VECTOR_REF")) {
      const t = this.cur();
      if (t.kind === "PARAM" || t.kind === "IDENT") { arm.vectorRef = t.value; this.i++; }
      else throw new ParseError("VECTOR_REF expects $param or ident");
    }
    return arm;
  }
  parsePredicate(): string {
    const stop = new Set(["ACL_HARD", "FUSE", "LIMIT", "SEMI", "EOF"]);
    const parts: string[] = [];
    while (true) {
      const t = this.cur();
      if (t.kind === "EOF" || t.kind === "SEMI") break;
      if (t.kind === "IDENT" && stop.has(t.value.toUpperCase())) break;
      if (t.kind === "IDENT" && UNSUPPORTED.has(t.value.toUpperCase())) {
        throw new ParseError(`Parser does not support ${t.value.toUpperCase()} inside/after WHERE`);
      }
      if (t.kind === "STRING") parts.push(`'${t.value}'`);
      else if (["PARAM", "NUMBER", "IDENT", "OP"].includes(t.kind)) parts.push(t.value);
      else if (t.kind === "COMMA") parts.push(",");
      else if (t.kind === "LPAREN") parts.push("(");
      else if (t.kind === "RPAREN") parts.push(")");
      else parts.push(t.value);
      this.i++;
    }
    if (!parts.length) throw new ParseError("Empty WHERE predicate");
    let expr = parts.join(" ");
    expr = expr.replace(/\s+,/g, ",").replace(/,\s*/g, ", ");
    expr = expr.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")");
    expr = expr.replace(/\s*(>=|<=|!=|<>|=|<|>)\s*/g, " $1 ");
    expr = expr.replace(/ {2,}/g, " ");
    return expr.trim();
  }
  parseFuse(ast: RetrieveAst): void {
    if (this.acceptKw("RRF")) {
      ast.fuse = "RRF";
      if (this.acceptKw("K")) {
        const n = this.expect("NUMBER");
        if (n.value.includes(".") || parseInt(n.value, 10) < 1) throw new ParseError("FUSE RRF K must be a positive integer");
        ast.fuseK = parseInt(n.value, 10);
      }
      return;
    }
    if (this.acceptKw("LINEAR")) {
      this.expectKw("WEIGHTS");
      this.expect("LPAREN");
      const weights = [parseFloat(this.expect("NUMBER").value)];
      while (this.cur().kind === "COMMA") { this.i++; weights.push(parseFloat(this.expect("NUMBER").value)); }
      this.expect("RPAREN");
      if (weights.length < 2) throw new ParseError("FUSE LINEAR WEIGHTS needs at least two numbers");
      ast.fuse = "LINEAR";
      ast.fuseWeights = weights;
      return;
    }
    throw new ParseError("FUSE expects RRF or LINEAR");
  }
}

function armToOp(arm: SearchArm, collection: string, defaultK: number | undefined, idx: number): Record<string, unknown> {
  const [opName, channel] = CHANNEL_OPS[arm.channel]!;
  const k = arm.k ?? defaultK;
  if (k === undefined || k < 1) throw new ParseError(`Search arm ${idx} missing K/CANDIDATES (and no LIMIT to default k)`);
  const node: Record<string, unknown> = { id: `${channel}${idx}`, op: opName, k, collection };
  const q: Record<string, unknown> = { channel };
  if (arm.queryText !== undefined) q.text = arm.queryText;
  if (arm.vectorRef !== undefined) q.vectorRef = arm.vectorRef;
  node.query = q;
  if (opName === "Search_dense" && arm.metric) node.metric = arm.metric;
  return node;
}

function astToLogicalPlan(ast: RetrieveAst): LogicalPlan {
  if (!ast.arms.length) throw new ParseError("No SEARCH arms");
  const notes = ["Parsed by RQL v0.1 frontend (subset). Not a full SQL engine."];
  if (ast.limit !== undefined && ast.arms.every((a) => a.k !== undefined)) {
    notes.push(`LIMIT ${ast.limit} recorded in meta only (LogicalPlan has no Limit op; Search.k came from K/CANDIDATES).`);
  }
  const searchNodes = ast.arms.map((a, i) => armToOp(a, ast.collection, a.k !== undefined ? undefined : ast.limit, i));
  let root: Record<string, unknown>;
  if (searchNodes.length === 1) {
    if (ast.fuse) throw new ParseError("FUSE requires at least two SEARCH arms");
    root = searchNodes[0]!;
  } else {
    if (!ast.fuse) throw new ParseError("Multiple SEARCH arms require FUSE RRF or FUSE LINEAR");
    if (ast.fuse === "RRF") {
      root = { id: "fuse0", op: "Fuse_rrf", k_rrf: ast.fuseK ?? 60, inputs: searchNodes };
      notes.push("Fuse_rrf packaging; RRF formula Established (Cormack).");
    } else {
      if (!ast.fuseWeights || ast.fuseWeights.length !== searchNodes.length) {
        throw new ParseError(`LINEAR WEIGHTS length ${ast.fuseWeights?.length ?? 0} != number of SEARCH arms ${searchNodes.length}`);
      }
      root = { id: "fuse0", op: "Fuse_linear", alpha: ast.fuseWeights, inputs: searchNodes };
      notes.push("Fuse_linear packaging; convex-combo mechanism Established.");
    }
  }
  if (ast.where !== undefined) {
    root = {
      id: "filter0",
      op: "Filter",
      predicate: { expr: ast.where, aclHard: !!ast.aclHard },
      input: root,
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "LogicalPlan",
    meta: { label: "Hypothesis", notes: notes.join(" ") },
    root,
  };
}

/** Parse RQL source into a LogicalPlan. */
export function parse(text: string): LogicalPlan {
  return astToLogicalPlan(new Parser(tokenize(text)).parse());
}
