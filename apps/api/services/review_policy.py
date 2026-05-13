from __future__ import annotations

import json
from typing import Any

VETOED_TAGS = frozenset(
    {
        "deploy_prod",
        "db_migration",
        "customer_email",
        "customer_whatsapp",
        "financial_op",
        "send_external",
    }
)


def is_autonomous_allowed(task: dict[str, Any]) -> tuple[bool, str | None]:
    """Valida se uma task pode seguir sem revisao humana obrigatoria."""
    raw_tags = task.get("tags")
    if raw_tags is None:
        return True, None

    if isinstance(raw_tags, list):
        tags = raw_tags
    else:
        try:
            tags = json.loads(raw_tags)
        except (json.JSONDecodeError, TypeError):
            return False, "task.tags em formato invalido (JSON list esperada)"
        if not isinstance(tags, list):
            return False, "task.tags deve ser JSON list"

    vetoed = VETOED_TAGS.intersection(str(tag) for tag in tags)
    if vetoed:
        tag = sorted(vetoed)[0]
        return False, f"tag vetada: {tag}"

    return True, None


def assert_can_review(
    reviewer_slug: str,
    assignee_slug: str,
    agents_db: dict[str, dict[str, Any]],
) -> None:
    """Garante que reviewer_slug esta na whitelist can_review do assignee."""
    can_review = agents_db[assignee_slug].get("can_review", [])
    if reviewer_slug not in can_review:
        raise ValueError(f"{reviewer_slug} nao pode revisar {assignee_slug}")
