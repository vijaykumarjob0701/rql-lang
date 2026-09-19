"""RQL text → LogicalPlan (v0.1 subset).

Ported from rql-repro toy frontend. Not a full SQL engine.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Optional, Sequence

SCHEMA_VERSION = "0.1.0-draft"
CHANNEL_OPS = {
    "DENSE": ("Search_dense", "dense"),
    "BM25": ("Search_bm25", "bm25"),
    "LATE": ("Search_late", "late"),
    "COLBERT": ("Search_late", "late"),
}
METRICS = {"cosine", "l2", "ip", "dot", "unknown"}
UNSUPPORTED = {
    "EMBED",
    "WITH",
    "RERANK",
    "DIVERSIFY",
    "EXPAND",
    "REWRITE",
    "TRAVERSE",
    "VSIM",
    "FILTER_MODE",
    "OPTION",
    "UNION",
    "EXPLAIN",
    "ORDER",
    "OFFSET",
}


class ParseError(ValueError):
    """Raised when RQL text cannot be parsed into a LogicalPlan."""


@dataclass
class Token:
    kind: str
    value: str
    pos: int


_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_PARAM = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*")
_STRING_SQ = re.compile(r"'([^']*)'")
_STRING_DQ = re.compile(r'"([^"]*)"')


def _strip_comments(text: str) -> str:
    lines: List[str] = []
    for line in text.splitlines():
        in_s = False
        in_d = False
        out: List[str] = []
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == "'" and not in_d:
                in_s = not in_s
                out.append(ch)
                i += 1
                continue
            if ch == '"' and not in_s:
                in_d = not in_d
                out.append(ch)
                i += 1
                continue
            if (
                not in_s
                and not in_d
                and ch == "-"
                and i + 1 < len(line)
                and line[i + 1] == "-"
            ):
                break
            out.append(ch)
            i += 1
        lines.append("".join(out))
    return "\n".join(lines)


def tokenize(text: str) -> List[Token]:
    s = _strip_comments(text)
    tokens: List[Token] = []
    i = 0
    n = len(s)
    while i < n:
        while i < n and s[i].isspace():
            i += 1
        if i >= n:
            break
        if s[i] == ";":
            tokens.append(Token("SEMI", ";", i))
            i += 1
            continue
        if s[i] == ",":
            tokens.append(Token("COMMA", ",", i))
            i += 1
            continue
        if s[i] == "(":
            tokens.append(Token("LPAREN", "(", i))
            i += 1
            continue
        if s[i] == ")":
            tokens.append(Token("RPAREN", ")", i))
            i += 1
            continue
        if s.startswith(">=", i) or s.startswith("<=", i) or s.startswith("!=", i) or s.startswith("<>", i):
            tokens.append(Token("OP", s[i : i + 2], i))
            i += 2
            continue
        if s[i] in "=<>":
            tokens.append(Token("OP", s[i], i))
            i += 1
            continue
        m = _PARAM.match(s, i)
        if m:
            tokens.append(Token("PARAM", m.group(0), i))
            i = m.end()
            continue
        m = _STRING_SQ.match(s, i)
        if m:
            tokens.append(Token("STRING", m.group(1), i))
            i = m.end()
            continue
        m = _STRING_DQ.match(s, i)
        if m:
            tokens.append(Token("STRING", m.group(1), i))
            i = m.end()
            continue
        m = _NUMBER.match(s, i)
        if m:
            tokens.append(Token("NUMBER", m.group(0), i))
            i = m.end()
            continue
        m = _IDENT.match(s, i)
        if m:
            tokens.append(Token("IDENT", m.group(0), i))
            i = m.end()
            continue
        raise ParseError(f"Unexpected character {s[i]!r} at position {i}")
    tokens.append(Token("EOF", "", i))
    return tokens


@dataclass
class SearchArm:
    channel: str
    field: Optional[str] = None
    metric: Optional[str] = None
    k: Optional[int] = None
    query_text: Optional[str] = None
    vector_ref: Optional[str] = None


@dataclass
class RetrieveAst:
    collection: str
    arms: List[SearchArm] = field(default_factory=list)
    where: Optional[str] = None
    acl_hard: bool = False
    fuse: Optional[str] = None
    fuse_k: Optional[int] = None
    fuse_weights: Optional[List[float]] = None
    limit: Optional[int] = None


class _Parser:
    def __init__(self, tokens: Sequence[Token]):
        self.toks = list(tokens)
        self.i = 0

    def _cur(self) -> Token:
        return self.toks[self.i]

    def _peek_kw(self) -> str:
        t = self._cur()
        if t.kind == "IDENT":
            return t.value.upper()
        return t.kind

    def _accept_kw(self, *words: str) -> Optional[Token]:
        if self._peek_kw() in {w.upper() for w in words}:
            t = self._cur()
            self.i += 1
            return t
        return None

    def _expect_kw(self, *words: str) -> Token:
        t = self._accept_kw(*words)
        if t is None:
            raise ParseError(
                f"Expected keyword {'/'.join(words)}, got {self._cur().value!r} "
                f"at pos {self._cur().pos}"
            )
        return t

    def _expect(self, kind: str) -> Token:
        t = self._cur()
        if t.kind != kind:
            raise ParseError(
                f"Expected {kind}, got {t.kind}({t.value!r}) at pos {t.pos}"
            )
        self.i += 1
        return t

    def _reject_unsupported(self) -> None:
        kw = self._peek_kw()
        if kw in UNSUPPORTED:
            raise ParseError(
                f"Parser does not support {kw} (v0.1 subset). "
                "See docs/API.md and examples/"
            )

    def parse(self) -> RetrieveAst:
        self._reject_unsupported()
        self._expect_kw("RETRIEVE")
        coll_tok = self._expect("IDENT")
        ast = RetrieveAst(collection=coll_tok.value)

        self._reject_unsupported()
        self._expect_kw("SEARCH")
        ast.arms.append(self._parse_arm())
        while self._accept_kw("AND"):
            ast.arms.append(self._parse_arm())

        if self._accept_kw("WHERE"):
            ast.where = self._parse_predicate()
        if self._accept_kw("ACL_HARD"):
            ast.acl_hard = True
            if ast.where is None:
                raise ParseError("ACL_HARD requires a preceding WHERE clause")

        if self._accept_kw("FUSE"):
            self._parse_fuse(ast)

        if self._accept_kw("LIMIT"):
            n = self._expect("NUMBER")
            if "." in n.value:
                raise ParseError("LIMIT must be an integer")
            ast.limit = int(n.value)

        self._reject_unsupported()
        if self._cur().kind == "SEMI":
            self.i += 1
        if self._cur().kind != "EOF":
            self._reject_unsupported()
            raise ParseError(
                f"Unexpected token {self._cur().value!r} at pos {self._cur().pos} "
                "(grammar ended)"
            )
        return ast

    def _parse_arm(self) -> SearchArm:
        self._reject_unsupported()
        ch = self._peek_kw()
        if ch not in CHANNEL_OPS:
            raise ParseError(
                "Expected SEARCH channel DENSE|BM25|LATE|COLBERT, "
                f"got {self._cur().value!r}"
            )
        self.i += 1
        arm = SearchArm(channel=ch)
        if self._accept_kw("ON"):
            arm.field = self._expect("IDENT").value
        if self._accept_kw("METRIC"):
            mtok = self._expect("IDENT")
            m = mtok.value.lower()
            if m not in METRICS:
                raise ParseError(f"Unknown metric {mtok.value!r}")
            arm.metric = "ip" if m == "dot" else m
        if self._accept_kw("K", "CANDIDATES"):
            n = self._expect("NUMBER")
            if "." in n.value or int(n.value) < 1:
                raise ParseError("K/CANDIDATES must be a positive integer")
            arm.k = int(n.value)
        if self._accept_kw("QUERY"):
            t = self._cur()
            if t.kind in ("STRING", "PARAM"):
                arm.query_text = t.value
                self.i += 1
            else:
                raise ParseError("QUERY expects a string or $param")
        if self._accept_kw("VECTOR_REF"):
            t = self._cur()
            if t.kind in ("PARAM", "IDENT"):
                arm.vector_ref = t.value
                self.i += 1
            else:
                raise ParseError("VECTOR_REF expects $param or ident")
        return arm

    def _parse_predicate(self) -> str:
        stop = {"ACL_HARD", "FUSE", "LIMIT", "SEMI", "EOF"}
        parts: List[str] = []
        while True:
            t = self._cur()
            if t.kind in ("EOF", "SEMI"):
                break
            if t.kind == "IDENT" and t.value.upper() in stop:
                break
            if t.kind == "IDENT" and t.value.upper() in UNSUPPORTED:
                raise ParseError(
                    f"Parser does not support {t.value.upper()} inside/after WHERE"
                )
            if t.kind == "STRING":
                parts.append(f"'{t.value}'")
            elif t.kind in ("PARAM", "NUMBER", "IDENT", "OP"):
                parts.append(t.value)
            elif t.kind == "COMMA":
                parts.append(",")
            elif t.kind == "LPAREN":
                parts.append("(")
            elif t.kind == "RPAREN":
                parts.append(")")
            else:
                parts.append(t.value)
            self.i += 1
        if not parts:
            raise ParseError("Empty WHERE predicate")
        expr = " ".join(parts)
        expr = re.sub(r"\s+,", ",", expr)
        expr = re.sub(r",\s*", ", ", expr)
        expr = re.sub(r"\s*\(\s*", "(", expr)
        expr = re.sub(r"\s*\)\s*", ")", expr)
        expr = re.sub(r"\s*(>=|<=|!=|<>|=|<|>)\s*", r" \1 ", expr)
        expr = re.sub(r" {2,}", " ", expr)
        return expr.strip()

    def _parse_fuse(self, ast: RetrieveAst) -> None:
        if self._accept_kw("RRF"):
            ast.fuse = "RRF"
            if self._accept_kw("K"):
                n = self._expect("NUMBER")
                if "." in n.value or int(n.value) < 1:
                    raise ParseError("FUSE RRF K must be a positive integer")
                ast.fuse_k = int(n.value)
            return
        if self._accept_kw("LINEAR"):
            self._expect_kw("WEIGHTS")
            self._expect("LPAREN")
            weights: List[float] = [float(self._expect("NUMBER").value)]
            while self._cur().kind == "COMMA":
                self.i += 1
                weights.append(float(self._expect("NUMBER").value))
            self._expect("RPAREN")
            if len(weights) < 2:
                raise ParseError("FUSE LINEAR WEIGHTS needs at least two numbers")
            ast.fuse = "LINEAR"
            ast.fuse_weights = weights
            return
        raise ParseError("FUSE expects RRF or LINEAR")


def _arm_to_op(arm: SearchArm, collection: str, default_k: Optional[int], idx: int) -> dict:
    op_name, channel = CHANNEL_OPS[arm.channel]
    k = arm.k if arm.k is not None else default_k
    if k is None or k < 1:
        raise ParseError(
            f"Search arm {idx} missing K/CANDIDATES (and no LIMIT to default k)"
        )
    node: dict[str, Any] = {
        "id": f"{channel}{idx}",
        "op": op_name,
        "k": k,
        "collection": collection,
    }
    q: dict[str, Any] = {"channel": channel}
    if arm.query_text is not None:
        q["text"] = arm.query_text
    if arm.vector_ref is not None:
        q["vectorRef"] = arm.vector_ref
    node["query"] = q
    if op_name == "Search_dense" and arm.metric:
        node["metric"] = arm.metric
    return node


def ast_to_logical_plan(ast: RetrieveAst) -> dict:
    if not ast.arms:
        raise ParseError("No SEARCH arms")

    notes = [
        "Parsed by RQL v0.1 frontend (subset). Not a full SQL engine.",
    ]
    if ast.limit is not None and all(a.k is not None for a in ast.arms):
        notes.append(
            f"LIMIT {ast.limit} recorded in meta only (LogicalPlan has no Limit op; "
            "Search.k came from K/CANDIDATES)."
        )

    search_nodes = []
    for i, a in enumerate(ast.arms):
        use_default = None if a.k is not None else ast.limit
        search_nodes.append(_arm_to_op(a, ast.collection, use_default, i))

    if len(search_nodes) == 1:
        if ast.fuse:
            raise ParseError("FUSE requires at least two SEARCH arms")
        root: Any = search_nodes[0]
    else:
        if not ast.fuse:
            raise ParseError(
                "Multiple SEARCH arms require FUSE RRF or FUSE LINEAR "
                "(no implicit Union in v0.1)"
            )
        if ast.fuse == "RRF":
            root = {
                "id": "fuse0",
                "op": "Fuse_rrf",
                "k_rrf": ast.fuse_k if ast.fuse_k is not None else 60,
                "inputs": search_nodes,
            }
            notes.append("Fuse_rrf packaging; RRF formula Established (Cormack).")
        else:
            if ast.fuse_weights is None or len(ast.fuse_weights) != len(search_nodes):
                raise ParseError(
                    f"LINEAR WEIGHTS length {len(ast.fuse_weights or [])} "
                    f"!= number of SEARCH arms {len(search_nodes)}"
                )
            root = {
                "id": "fuse0",
                "op": "Fuse_linear",
                "alpha": ast.fuse_weights,
                "inputs": search_nodes,
            }
            notes.append("Fuse_linear packaging; convex-combo mechanism Established.")

    if ast.where is not None:
        root = {
            "id": "filter0",
            "op": "Filter",
            "predicate": {
                "expr": ast.where,
                "aclHard": bool(ast.acl_hard),
            },
            "input": root,
        }

    plan: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "LogicalPlan",
        "meta": {
            "label": "Hypothesis",
            "notes": " ".join(notes),
        },
        "root": root,
    }
    return plan


def parse(text: str) -> dict:
    """Parse RQL source into a LogicalPlan dict."""
    tokens = tokenize(text)
    ast = _Parser(tokens).parse()
    return ast_to_logical_plan(ast)


def parse_file(path: str | Path) -> dict:
    p = Path(path)
    return parse(p.read_text(encoding="utf-8"))
