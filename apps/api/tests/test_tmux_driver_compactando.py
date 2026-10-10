"""O pane diz se o agente está compactando — sinal que a tela não consegue inventar."""

from services.tmux_driver import parse_compactando_from_pane

PANE_COMPACTANDO = """\
❯ /compact

✻ Compacting conversation… (35s · ↓ 2.0k tokens)
  ⎿  Tip: Send messages to Claude while it works to steer Claude in real-time

────────────────────────────────────────────────── Caseiro ─
❯
────────────────────────────────────────────────────────────
  Opus 5.5 - 01:17:20 - [█░░░░░░░░░] 16%
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
"""

PANE_OCIOSO = """\
❯ /compact
  ⎿  Compacted (ctrl+o to see full summary)

────────────────────────────────────────────────── Caseiro ─
❯
────────────────────────────────────────────────────────────
  Opus 5.5 - 01:18:02 - [█░░░░░░░░░] 4%
"""


def test_spinner_do_compact_conta_como_compactando() -> None:
    assert parse_compactando_from_pane(PANE_COMPACTANDO) is True


def test_compact_concluido_nao_conta() -> None:
    assert parse_compactando_from_pane(PANE_OCIOSO) is False


def test_texto_citado_na_conversa_nao_conta() -> None:
    # A frase aparece numa resposta do agente, bem acima da statusline.
    citado = (
        "● O spinner mostra Compacting conversation… enquanto roda.\n"
        + "\n".join(f"linha {n}" for n in range(30))
        + "\n❯\n  Opus 5.5 - 01:18:02 - [█░░░░░░░░░] 4%\n"
    )
    assert parse_compactando_from_pane(citado) is False


def test_pane_ilegivel_nao_afirma_nada() -> None:
    assert parse_compactando_from_pane(None) is None
    assert parse_compactando_from_pane("") is None
