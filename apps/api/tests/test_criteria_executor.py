from __future__ import annotations

import pytest

from services.criteria_executor import (
    Criterion,
    DEFAULT_TIMEOUT_S,
    parse_success_criteria,
)


def test_parse_empty_body_returns_empty():
    assert parse_success_criteria(None) == []
    assert parse_success_criteria("") == []
    assert parse_success_criteria("# mission\nfaz x") == []


def test_parse_single_default_expect_and_timeout():
    body = """\
## Success Criteria
- cmd: corepack pnpm type-check
"""
    crits = parse_success_criteria(body)
    assert len(crits) == 1
    assert crits[0].cmd == "corepack pnpm type-check"
    assert crits[0].expect_exit == 0
    assert crits[0].timeout_s == DEFAULT_TIMEOUT_S


def test_parse_multi_with_expect_and_timeout():
    body = """\
## Mission
foo

## Success Criteria
- cmd: pytest -q
  expect: exit=0
- cmd: pnpm build
  expect: exit=0
  timeout: 900

## Notas
ignora
"""
    crits = parse_success_criteria(body)
    assert [c.cmd for c in crits] == ["pytest -q", "pnpm build"]
    assert crits[1].timeout_s == 900


def test_parse_rejects_invalid_expect():
    body = """\
## Success Criteria
- cmd: ls
  expect: rc=0
"""
    with pytest.raises(ValueError, match="expect inválido"):
        parse_success_criteria(body)


def test_parse_rejects_empty_cmd():
    body = """\
## Success Criteria
- cmd:
"""
    with pytest.raises(ValueError, match="cmd vazio"):
        parse_success_criteria(body)


def test_parse_rejects_excessive_timeout():
    body = """\
## Success Criteria
- cmd: ls
  timeout: 99999
"""
    with pytest.raises(ValueError, match="timeout"):
        parse_success_criteria(body)


def test_parse_case_insensitive_heading():
    body = "## success criteria\n- cmd: true\n"
    crits = parse_success_criteria(body)
    assert len(crits) == 1
    assert crits[0].cmd == "true"
