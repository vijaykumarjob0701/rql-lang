"""SQL-style CLI for RQL: one-shot, files, and an interactive REPL.

Reuses ``parse`` / ``compile`` / ``explain`` / ``emit`` / ``execute``.
Does not embed query text. Live execute requires caller-supplied vectors.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

from . import __version__
from .emit import AdapterError, emit, list_vendors
from .execute import execute
from .explain import explain
from .parser import ParseError, parse
from .planner import PlanError, compile, list_profiles
from .qdrant import ExecutionError

_EXPLAIN_PREFIX = re.compile(r"^\s*EXPLAIN\b\s*", re.IGNORECASE)
_META = re.compile(r"^\\")
PROFILES = ("qdrant", "elasticsearch", "pgvector")
MODES = ("explain", "emit", "execute")

HELP_TEXT = """\
RQL CLI — parse → compile → explain / emit / execute  (like psql / sqlite3)

Usage:
  rql                         interactive prompt (rql>)
  rql -c "RETRIEVE …;"        one-shot string
  rql file.rql                one-shot file
  rql --json -c "…"           LogicalPlan + PhysicalPlan (+ emit/execute)
  rql --execute --vector '{"dense":[0.1,0.2]}' file.rql

Meta-commands (REPL, or a -c that is only a meta-command):
  \\q / \\quit / \\exit     leave the REPL
  \\help / \\h / \\? / \\d   help (\\d also prints session status)
  \\profile NAME           qdrant | elasticsearch | pgvector
  \\backend NAME           emit/execute vendor (live execute: qdrant only)
  \\connect [URL]          Qdrant base URL (default $QDRANT_URL)
  \\emit                   mode = sketch emit (safe default for live-looking output)
  \\execute                mode = live Qdrant execute (needs vectors)
  \\explain [on|off]       on/off = also print explain; bare = mode=explain
  \\vectors JSON|PATH      bind query vectors (no fake embeddings)
  \\collection NAME        override RETRIEVE collection

Default mode is explain (pretty text). emit is a notExecuted sketch.
--execute / \\execute never invents embeddings: pass --vector / --vectors-file.
"""


@dataclass
class Session:
    profile: str = "qdrant"
    backend: str = "qdrant"
    url: str | None = None
    api_key: str | None = None
    collection: str | None = None
    vectors: dict[str, Any] | None = None
    mode: str = "explain"
    explain_extra: bool = False
    json_mode: bool = False


def _err(msg: str, file: TextIO | None = None) -> None:
    print(f"rql: {msg}", file=file or sys.stderr)


def parse_vectors_json(raw: str) -> dict[str, Any]:
    data = json.loads(raw)
    if isinstance(data, list):
        return {"dense": data}
    if isinstance(data, dict):
        return data
    raise ValueError("vectors JSON must be an object or a dense float array")


def load_vectors(vector: str | None, vectors_file: str | None) -> dict[str, Any] | None:
    if vector and vectors_file:
        raise ValueError("use only one of --vector or --vectors-file")
    if vectors_file:
        text = Path(vectors_file).read_text(encoding="utf-8")
        return parse_vectors_json(text)
    if vector:
        return parse_vectors_json(vector)
    return None


def strip_explain_prefix(text: str) -> tuple[str, bool]:
    """CLI-only EXPLAIN prefix (parser treats EXPLAIN as unsupported)."""
    if _EXPLAIN_PREFIX.match(text):
        return _EXPLAIN_PREFIX.sub("", text, count=1).lstrip(), True
    return text, False


def format_emit(art: dict[str, Any]) -> str:
    banner = (
        f"-- VendorRequestSketch  notExecuted={art.get('notExecuted')}  "
        f"vendor={art.get('vendor')}  approximate={art.get('approximate')}"
    )
    body = art.get("body")
    body_txt = json.dumps(body, indent=2, ensure_ascii=False) if not isinstance(body, str) else body
    notes = art.get("notes") or []
    note_txt = "\n".join(f"  - {n}" for n in notes)
    return f"{banner}\n{body_txt}" + (f"\nnotes:\n{note_txt}" if note_txt else "")


def format_execute(art: dict[str, Any]) -> str:
    hits = art.get("hits") or []
    lines = [
        f"ExecuteResult  executed={art.get('executed')}  collection={art.get('collection')}  "
        f"timingMs={art.get('timingMs')}"
    ]
    if not hits:
        lines.append("  (no hits)")
    for i, hit in enumerate(hits, 1):
        lines.append(
            f"  {i}. id={hit.get('id')}  score={hit.get('score')}  payload={hit.get('payload')}"
        )
    return "\n".join(lines)


def session_status(session: Session) -> str:
    vec = "set" if session.vectors else "unset (needed for --execute)"
    return (
        f"profile={session.profile}  backend={session.backend}  mode={session.mode}  "
        f"explain_extra={session.explain_extra}\n"
        f"url={session.url or os.environ.get('QDRANT_URL') or 'http://localhost:6333'}  "
        f"collection={session.collection or '(from RETRIEVE)'}  vectors={vec}"
    )


def apply_meta(line: str, session: Session) -> str:
    """Apply a \\command. Returns 'quit', 'ok', or raises ValueError."""
    rest = line[1:].strip()
    if not rest:
        raise ValueError("empty meta-command; try \\help")
    parts = rest.split(None, 1)
    cmd = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""

    if cmd in {"q", "quit", "exit"}:
        return "quit"
    if cmd in {"help", "h", "?"}:
        return "help"
    if cmd == "d":
        return "describe"
    if cmd == "profile":
        if not arg:
            return f"profile={session.profile}"
        name = arg.split()[0].lower()
        if name not in list_profiles() and name not in PROFILES:
            raise ValueError(f"unknown profile {name!r}; expected one of {', '.join(PROFILES)}")
        session.profile = name
        return f"profile={session.profile}"
    if cmd == "backend":
        if not arg:
            return f"backend={session.backend}"
        name = arg.split()[0].lower()
        if name not in list_vendors():
            raise ValueError(f"unknown backend {name!r}; expected one of {', '.join(list_vendors())}")
        session.backend = name
        return f"backend={session.backend}"
    if cmd in {"connect", "c"}:
        if not arg:
            return f"url={session.url or os.environ.get('QDRANT_URL') or 'http://localhost:6333'}"
        session.url = arg.split()[0]
        return f"url={session.url}"
    if cmd == "emit":
        session.mode = "emit"
        return "mode=emit (sketch, notExecuted)"
    if cmd == "execute":
        session.mode = "execute"
        return "mode=execute (live Qdrant; needs vectors)"
    if cmd == "explain":
        low = arg.lower()
        if low in {"on", "1", "true"}:
            session.explain_extra = True
            return "explain_extra=on"
        if low in {"off", "0", "false"}:
            session.explain_extra = False
            return "explain_extra=off"
        session.mode = "explain"
        return "mode=explain"
    if cmd == "collection":
        if not arg:
            return f"collection={session.collection or '(from RETRIEVE)'}"
        session.collection = arg.split()[0]
        return f"collection={session.collection}"
    if cmd == "vectors":
        if not arg:
            return "vectors=" + ("set" if session.vectors else "unset")
        path = Path(arg)
        if path.is_file():
            session.vectors = parse_vectors_json(path.read_text(encoding="utf-8"))
        else:
            session.vectors = parse_vectors_json(arg)
        return "vectors=set"
    if cmd == "json":
        low = arg.lower() or "on"
        session.json_mode = low not in {"off", "0", "false"}
        return f"json={str(session.json_mode).lower()}"
    raise ValueError(f"unknown meta-command \\{cmd}; try \\help")


def run_pipeline(
    text: str,
    session: Session,
    *,
    stdout: TextIO,
    stderr: TextIO,
) -> int:
    raw = text.strip()
    if not raw:
        return 0
    if raw.startswith("\\"):
        try:
            result = apply_meta(raw, session)
        except ValueError as exc:
            _err(str(exc), stderr)
            return 1
        if result == "quit":
            return 0
        if result == "help":
            print(HELP_TEXT, file=stdout, end="")
            return 0
        if result == "describe":
            print(session_status(session), file=stdout)
            print(file=stdout)
            print(HELP_TEXT, file=stdout, end="")
            return 0
        print(result, file=stdout)
        return 0

    src, force_explain = strip_explain_prefix(raw)
    if not src.strip():
        _err("EXPLAIN requires a statement", stderr)
        return 1

    try:
        logical = parse(src)
        physical = compile(logical, profile=session.profile)
    except (ParseError, PlanError) as exc:
        _err(str(exc), stderr)
        return 1

    mode = "explain" if force_explain else session.mode
    payload: dict[str, Any] = {
        "logical": logical,
        "physical": physical,
        "explain": explain(physical, format="object"),
    }

    if mode in {"explain", "emit"} or session.explain_extra or force_explain:
        if not session.json_mode and (mode == "explain" or session.explain_extra or force_explain):
            print(explain(physical), file=stdout)

    if mode == "emit" and not force_explain:
        try:
            art = emit(physical, backend=session.backend)
        except AdapterError as exc:
            _err(str(exc), stderr)
            return 1
        payload["emit"] = art
        if not session.json_mode:
            print(format_emit(art), file=stdout)

    if mode == "execute" and not force_explain:
        if not session.vectors:
            _err(
                "execute requires query vectors; pass --vector '{\"dense\":[...]}' "
                "or --vectors-file FILE (no embeddings are generated)",
                stderr,
            )
            return 1
        try:
            art = execute(
                physical,
                backend=session.backend,
                url=session.url,
                api_key=session.api_key,
                vectors=session.vectors,
                collection=session.collection,
            )
        except (AdapterError, ExecutionError) as exc:
            _err(str(exc), stderr)
            return 1
        payload["execute"] = art
        if not session.json_mode:
            if session.explain_extra:
                pass
            print(format_execute(art), file=stdout)

    if session.json_mode:
        print(json.dumps(payload, indent=2, default=str), file=stdout)
    return 0


def _setup_readline() -> None:
    try:
        import readline
    except ImportError:
        return
    hist = Path.home() / ".rql_history"
    try:
        if hist.is_file():
            readline.read_history_file(hist)
        readline.set_history_length(1000)
    except OSError:
        hist = None

    def _save() -> None:
        if hist is None:
            return
        try:
            readline.write_history_file(hist)
        except OSError:
            pass

    import atexit

    atexit.register(_save)


def repl(session: Session, *, stdin: TextIO, stdout: TextIO, stderr: TextIO) -> int:
    _setup_readline()
    interactive = stdin.isatty()
    if interactive:
        print(f"rql {__version__}  (\\help for commands, \\q to quit)", file=stdout)
        print(session_status(session), file=stdout)
    buf: list[str] = []
    while True:
        prompt = "rql> " if not buf else "   -> "
        try:
            line = stdin.readline()
        except KeyboardInterrupt:
            print(file=stdout)
            buf.clear()
            continue
        if line == "":
            if buf:
                code = run_pipeline("\n".join(buf), session, stdout=stdout, stderr=stderr)
                if code and not interactive:
                    return code
            if interactive:
                print(file=stdout)
            return 0
        line = line.rstrip("\n")
        stripped = line.strip()
        if not buf and stripped.startswith("\\"):
            result_code = run_pipeline(stripped, session, stdout=stdout, stderr=stderr)
            if stripped.split()[0].lower() in {"\\q", "\\quit", "\\exit"}:
                return 0
            if result_code and not interactive:
                return result_code
            continue
        if not stripped and not buf:
            continue
        if not stripped and buf:
            code = run_pipeline("\n".join(buf), session, stdout=stdout, stderr=stderr)
            buf.clear()
            if code and not interactive:
                return code
            continue
        buf.append(line)
        joined = "\n".join(buf).rstrip()
        if joined.endswith(";"):
            code = run_pipeline(joined, session, stdout=stdout, stderr=stderr)
            buf.clear()
            if code and not interactive:
                return code


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="rql",
        description="RQL command line (psql-style): explain / emit sketches / opt-in Qdrant execute.",
        epilog="Default is explain (pretty text). emit is a sketch. --execute needs real vectors.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("file", nargs="?", help="RQL source file (one-shot)")
    p.add_argument("-c", "--command", help="RQL string or meta-command (one-shot)")
    p.add_argument("--profile", default="qdrant", help="capability profile (default: qdrant)")
    p.add_argument("--backend", default=None, help="emit/execute vendor (default: --profile)")
    p.add_argument("--json", action="store_true", help="machine-readable pipeline JSON")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--explain", action="store_true", help="explain mode (default)")
    g.add_argument("--emit", action="store_true", help="print VendorRequestSketch (notExecuted)")
    g.add_argument("--execute", action="store_true", help="live Qdrant execute (opt-in)")
    p.add_argument("--vector", help='JSON object or dense array, e.g. \'{"dense":[0.1,0.2]}\'')
    p.add_argument("--vectors-file", help="JSON file with vector bindings")
    p.add_argument("--url", help="Qdrant base URL (else QDRANT_URL)")
    p.add_argument("--api-key", dest="api_key", help="Qdrant API key (else QDRANT_API_KEY)")
    p.add_argument("--collection", help="override collection name")
    p.add_argument("--version", action="version", version=f"rql {__version__}")
    return p


def session_from_args(args: argparse.Namespace) -> Session:
    mode = "explain"
    if args.execute:
        mode = "execute"
    elif args.emit:
        mode = "emit"
    try:
        vectors = load_vectors(args.vector, args.vectors_file)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit(f"rql: vectors: {exc}") from exc
    return Session(
        profile=args.profile,
        backend=(args.backend or args.profile or "qdrant"),
        url=args.url,
        api_key=args.api_key,
        collection=args.collection,
        vectors=vectors,
        mode=mode,
        json_mode=bool(args.json),
    )


def main(argv: list[str] | None = None, *, stdin: TextIO | None = None, stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    parser = build_parser()
    try:
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            args = parser.parse_args(argv)
    except SystemExit as exc:
        code = exc.code
        return 0 if code is None else int(code)

    if args.file and args.command:
        _err("pass a file or -c, not both", stderr)
        return 2

    try:
        session = session_from_args(args)
    except SystemExit as exc:
        msg = exc.args[0] if exc.args else str(exc)
        if msg:
            print(msg, file=stderr)
        return 2

    if args.command is not None:
        return run_pipeline(args.command, session, stdout=stdout, stderr=stderr)
    if args.file:
        path = Path(args.file)
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            _err(str(exc), stderr)
            return 2
        return run_pipeline(text, session, stdout=stdout, stderr=stderr)
    return repl(session, stdin=stdin, stdout=stdout, stderr=stderr)


if __name__ == "__main__":
    raise SystemExit(main())
