from __future__ import annotations

import pytest

from routers.hooks import _hook_lifecycle


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"tool_name": "Read", "tool_input": {"file_path": "PLANO.md"}}, ("reading", "Read")),
        (
            {"tool_name": "Edit", "tool_input": {"file_path": "apps/api/routers/hooks.py"}},
            ("writing", "apps/api/routers/hooks.py"),
        ),
        (
            {"tool_name": "Bash", "tool_input": {"command": "uv run pytest tests/test_hooks.py"}},
            ("executing", "uv run pytest tests/test_hooks.py"),
        ),
        (
            {
                "tool_name": "Bash",
                "tool_input": {"command": "tmux send-keys -t vinicius 'STATE:'"},
            },
            ("handoff", "vinicius"),
        ),
        (
            {"tool_name": "WebFetch", "tool_input": {"url": "https://example.com/docs"}},
            ("searching", "https://example.com/docs"),
        ),
    ],
)
def test_pre_tool_lifecycle_microstates(payload: dict, expected: tuple[str, str]) -> None:
    assert _hook_lifecycle("PreToolUse", payload) == expected


def test_pre_tool_lifecycle_tmux_handoff_with_hyphen_and_quotes() -> None:
    hyphen = _hook_lifecycle(
        "PreToolUse",
        {"tool_name": "Bash", "tool_input": {"command": "tmux send-keys -t miga-dani 'oi'"}},
    )
    quoted = _hook_lifecycle(
        "PreToolUse",
        {"tool_name": "Bash", "tool_input": {"command": "tmux send-keys -t \"vinicius\" hi"}},
    )
    assert hyphen == ("handoff", "miga-dani")
    assert quoted == ("handoff", "vinicius")


def test_pre_tool_lifecycle_tmux_handoff_regex_vs_generic_bash() -> None:
    handoff = _hook_lifecycle(
        "PreToolUse",
        {
            "tool_name": "Bash",
            "tool_input": {"command": "printf x && tmux send-keys -t vinicius 'segue'"},
        },
    )
    generic = _hook_lifecycle(
        "PreToolUse",
        {"tool_name": "Bash", "tool_input": {"command": "printf x && pytest -q"}},
    )

    assert handoff == ("handoff", "vinicius")
    assert generic == ("executing", "printf x && pytest -q")
