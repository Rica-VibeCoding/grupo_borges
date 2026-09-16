"""Cerca da bancada: nenhum teste escreve no estado REAL da frota.

Nasceu de um vazamento medido em 16/09. O endpoint `/desligar` passou a carimbar
quem o Rica desliga de propósito, num arquivo do home (`~/.claude/channels/`) —
e a suíte inteira, que já chamava `/desligar` com o driver de tmux dublado mas
sem dublar o carimbo, gravou `canarinho` no arquivo de produção. Um slug que não
existe fica inofensivo; o mesmo descuido sobre um slug de verdade some com o
agente do radar do vigia.

É a mesma armadilha já registrada no MURAL ("teste de API sem mock injeta
payload de verdade no pane tmux real"): fixture com slug de mentira, efeito no
lugar de verdade. Por isso a cerca é `autouse` e vale pra suíte toda — proteção
que cada teste precisa lembrar de pedir é proteção que o próximo teste esquece.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import desligamento_deliberado


@pytest.fixture(autouse=True)
def carimbo_fora_do_home(monkeypatch, tmp_path):
    alvo = tmp_path / "carimbo" / ".desligados-de-proposito.json"
    monkeypatch.setattr(desligamento_deliberado, "CAMINHO", alvo)
    monkeypatch.setattr(desligamento_deliberado, "TRAVA", alvo.with_suffix(".lock"))
    return alvo
