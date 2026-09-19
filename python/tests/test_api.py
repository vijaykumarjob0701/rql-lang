"""Minimal API tests for rql v0.1."""
from __future__ import annotations

from pathlib import Path

import pytest

from rql import (
    ParseError,
    compile,
    emit,
    explain,
    list_profiles,
    list_vendors,
    parse,
    parse_file,
)

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


def test_parse_hybrid_rrf():
    text = (EXAMPLES / "01-hybrid-rrf.rql").read_text(encoding="utf-8")
    plan = parse(text)
    assert plan["kind"] == "LogicalPlan"
    assert plan["schemaVersion"] == "0.1.0-draft"
    assert plan["root"]["op"] == "Fuse_rrf"
    assert len(plan["root"]["inputs"]) == 2


def test_parse_filtered_dense_acl():
    plan = parse_file(EXAMPLES / "02-filtered-dense.rql")
    assert plan["root"]["op"] == "Filter"
    assert plan["root"]["predicate"]["aclHard"] is True
    assert plan["root"]["input"]["op"] == "Search_dense"


def test_parse_rejects_embed():
    with pytest.raises(ParseError):
        parse("RETRIEVE c EMBED TEXT $q SEARCH DENSE CANDIDATES 5 QUERY 'x';")


def test_compile_qdrant_native_rrf():
    logical = parse_file(EXAMPLES / "01-hybrid-rrf.rql")
    physical = compile(logical, profile="qdrant")
    assert physical["kind"] == "PhysicalPlan"
    assert physical["root"]["op"] == "FusionExec"
    assert physical["root"]["native"] is True
    assert physical["meta"]["profileId"] == "qdrant"


def test_compile_pgvector_shim_rrf():
    logical = parse_file(EXAMPLES / "01-hybrid-rrf.rql")
    physical = compile(logical, profile="pgvector")
    assert physical["root"]["op"] == "ShimCast"
    assert physical["root"]["shim"] == "client_rrf"


def test_compile_filter_modes():
    logical = parse_file(EXAMPLES / "02-filtered-dense.rql")
    pq = compile(logical, profile="qdrant")
    pp = compile(logical, profile="pgvector")
    assert pq["root"]["op"] == "FilterExec"
    assert pq["root"]["mode"] == "PRE"
    assert pp["root"]["mode"] == "ITERATIVE"


def test_explain_text_and_object():
    logical = parse_file(EXAMPLES / "03-late.rql")
    physical = compile(logical, profile="qdrant")
    text = explain(physical)
    assert isinstance(text, str)
    assert "LateInteractExec" in text
    obj = explain(physical, format="object")
    assert obj["kind"] == "PhysicalPlanExplain"
    assert obj["notExecuted"] is True
    assert any(o["op"] == "LateInteractExec" for o in obj["ops"])


def test_emit_sketches_not_executed():
    logical = parse_file(EXAMPLES / "02-filtered-dense.rql")
    physical = compile(logical, profile="elasticsearch")
    art = emit(physical, backend="elasticsearch")
    assert art["notExecuted"] is True
    assert art["approximate"] is True
    assert art["vendor"] == "elasticsearch"
    assert "knn" in art["body"]
    assert "filter" in art["body"]["knn"]


def test_emit_qdrant_rrf_prefetch():
    logical = parse_file(EXAMPLES / "01-hybrid-rrf.rql")
    physical = compile(logical, profile="qdrant")
    art = emit(physical, backend="qdrant")
    assert art["body"].get("query", {}).get("fusion") == "rrf"
    assert art["body"].get("prefetch")


def test_emit_pgvector_sql_sketch():
    logical = parse_file(EXAMPLES / "02-filtered-dense.rql")
    physical = compile(logical, profile="pgvector")
    art = emit(physical, backend="pgvector")
    sql = art["body"]["sql"]
    assert "<=>" in sql
    assert "ITERATIVE" in sql or "iterative" in sql


def test_profiles_and_vendors():
    assert set(list_profiles()) >= {"qdrant", "elasticsearch", "pgvector"}
    assert set(list_vendors()) >= {"qdrant", "elasticsearch", "pgvector"}


def test_linear_fusion():
    logical = parse_file(EXAMPLES / "04-hybrid-linear.rql")
    assert logical["root"]["op"] == "Filter"
    physical = compile(logical, profile="qdrant")
    # Filter over native linear fuse
    assert physical["root"]["op"] == "FilterExec"
