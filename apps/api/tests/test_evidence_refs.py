from __future__ import annotations

import pytest

from services.evidence_refs import validate_evidence_refs


def test_file_prefix_valid_invalid(tmp_path) -> None:
    evidence = tmp_path / "evidence.txt"
    evidence.write_text("ok", encoding="utf-8")

    result = validate_evidence_refs(
        ["file:evidence.txt", "file:missing.txt"],
        str(tmp_path),
        {},
    )

    assert result == [
        {"ref": "file:evidence.txt", "type": "file", "valid": True, "reason": None},
        {
            "ref": "file:missing.txt",
            "type": "file",
            "valid": False,
            "reason": "arquivo nao encontrado",
        },
    ]


def test_commit_prefix_invalid_alias(tmp_path) -> None:
    result = validate_evidence_refs(["commit:missing:abc123"], str(tmp_path), {})

    assert result == [
        {
            "ref": "commit:missing:abc123",
            "type": "commit",
            "valid": False,
            "reason": "repo_alias desconhecido",
        }
    ]


def test_unknown_prefix_raises(tmp_path) -> None:
    with pytest.raises(ValueError, match="evidence_ref sem prefixo"):
        validate_evidence_refs(["unknown:value"], str(tmp_path), {})
