from __future__ import annotations

import json

import pytest

from services.review_policy import assert_can_review, is_autonomous_allowed


def test_vetoed_tag_blocks_autonomous() -> None:
    allowed, reason = is_autonomous_allowed({"tags": json.dumps(["feature", "deploy_prod"])})

    assert allowed is False
    assert reason == "tag vetada: deploy_prod"


def test_clean_tags_allow_autonomous() -> None:
    allowed, reason = is_autonomous_allowed({"tags": json.dumps(["feature", "docs"])})

    assert allowed is True
    assert reason is None


def test_can_review_whitelist() -> None:
    agents_db = {"daniel": {"can_review": ["tara"]}}

    assert_can_review("tara", "daniel", agents_db)
    with pytest.raises(ValueError):
        assert_can_review("barsi", "daniel", agents_db)
