"""CLI tests: one-shot, files, REPL meta-commands (no live Qdrant)."""
from __future__ import annotations

import json
import subprocess
import sys
from io import StringIO
from pathlib import Path

from rql.cli import main

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"
SRC = Path(__file__).resolve().parents[1] / "src"
FILTERED = EXAMPLES / "02-filtered-dense.rql"
ONESHOT = (
    "RETRIEVE chunks SEARCH DENSE ON embedding METRIC cosine "
    "CANDIDATES 5 VECTOR_REF $q_dense WHERE tenant_id = 'acme';"
)


def run_cli(argv, stdin_text=""):
    out, err = StringIO(), StringIO()
    code = main(argv, stdin=StringIO(stdin_text), stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def test_help_exit_zero():
    code, out, _err = run_cli(["--help"])
    assert code == 0
    assert "usage:" in out.lower() or "Usage" in out or "-c" in out
    assert "--execute" in out


def test_oneshot_command_explains():
    code, out, err = run_cli(["-c", ONESHOT])
    assert code == 0, err
    assert "FilterExec" in out or "AnnExec" in out
    assert "PhysicalPlan explain" in out


def test_oneshot_file():
    code, out, err = run_cli([str(FILTERED)])
    assert code == 0, err
    assert "FilterExec" in out
    assert "aclHard" in out


def test_json_pipeline_kinds():
    code, out, err = run_cli(["--json", "-c", ONESHOT])
    assert code == 0, err
    data = json.loads(out)
    assert data["logical"]["kind"] == "LogicalPlan"
    assert data["physical"]["kind"] == "PhysicalPlan"
    assert data["explain"]["kind"] == "PhysicalPlanExplain"


def test_emit_is_sketch():
    code, out, err = run_cli(["--emit", "-c", ONESHOT])
    assert code == 0, err
    assert "notExecuted=True" in out or "notExecuted=true" in out
    assert "VendorRequestSketch" in out


def test_execute_without_vectors_is_clear():
    code, out, err = run_cli(["--execute", "-c", ONESHOT])
    assert code == 1
    assert "vector" in err.lower()
    assert "embed" in err.lower()


def test_explain_prefix_does_not_execute():
    code, out, err = run_cli(["--execute", "-c", "EXPLAIN " + ONESHOT])
    assert code == 0, err
    assert "PhysicalPlan explain" in out
    assert "ExecuteResult" not in out


def test_parse_error_nonzero():
    code, _out, err = run_cli(["-c", "RETRIEVE c EMBED TEXT $q SEARCH DENSE CANDIDATES 5 QUERY 'x';"])
    assert code == 1
    assert err


def test_file_and_command_rejected():
    code, _out, err = run_cli(["-c", ONESHOT, str(FILTERED)])
    assert code == 2
    assert "not both" in err


def test_repl_help_and_quit():
    code, out, err = run_cli([], stdin_text="\\help\n\\q\n")
    assert code == 0, err
    assert "\\profile" in out
    assert "\\execute" in out


def test_repl_profile_and_query():
    stdin = "\\profile elasticsearch\n\\d\n" + ONESHOT + "\n\\q\n"
    code, out, err = run_cli([], stdin_text=stdin)
    assert code == 0, err
    assert "profile=elasticsearch" in out


def test_repl_multiline_until_semicolon():
    stdin = (
        "RETRIEVE chunks\n"
        "  SEARCH DENSE ON embedding METRIC cosine CANDIDATES 5 VECTOR_REF $q_dense;\n"
        "\\q\n"
    )
    code, out, err = run_cli([], stdin_text=stdin)
    assert code == 0, err
    assert "AnnExec" in out


def test_module_help_subprocess():
    env = {**dict(**{k: v for k, v in __import__("os").environ.items()}), "PYTHONPATH": str(SRC)}
    proc = subprocess.run(
        [sys.executable, "-m", "rql", "--help"],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(SRC.parent),
    )
    assert proc.returncode == 0
    assert "--execute" in proc.stdout
    assert "-c" in proc.stdout
