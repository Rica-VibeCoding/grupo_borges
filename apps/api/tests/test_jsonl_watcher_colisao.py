"""Colisão de `workspace_path` no `agents.yaml` não pode passar calada.

Em 04/08 o Daniel foi embutido em `grupo_borges`, ganhou o mesmo
`workspace_path` do canário, e o dict comprehension que montava o mapa deixou o
último do arquivo vencer sem log nenhum. Todo evento do Daniel chegou carimbado
como `canario` por um dia — o envio continuou certo, porque usa `tmux_session`,
então a tela mostrava mensagem indo pra um agente e resposta nascendo em outro.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orchestrator.jsonl_watcher import _mapear_por_encoded


def _agente(slug: str, workspace: str) -> dict:
    return {"slug": slug, "workspace_path": workspace}


def test_sem_colisao_cada_um_fica_com_a_sua_chave():
    mapa = _mapear_por_encoded(
        [
            _agente("daniel", "/home/clawd/repos/grupo_borges"),
            _agente("canario", "/home/clawd/repos/grupo_borges/fixtures/x"),
        ]
    )
    assert sorted(mapa.values()) == ["canario", "daniel"]


def test_colisao_nao_da_a_chave_a_ninguem():
    """Não atribuir custa um card parado; atribuir errado faz duvidar do sistema."""
    mapa = _mapear_por_encoded(
        [
            _agente("daniel", "/home/clawd/repos/grupo_borges"),
            _agente("canario", "/home/clawd/repos/grupo_borges"),
        ]
    )
    assert mapa == {}


def test_colisao_grita_no_log_com_os_dois_slugs(caplog):
    """`error`, não `warning`: config que se contradiz não pode subir muda.

    E os DOIS slugs no texto — saber que houve colisão sem saber entre quem
    obrigaria a reconstruir o incidente na mão.
    """
    with caplog.at_level(logging.ERROR):
        _mapear_por_encoded(
            [
                _agente("daniel", "/home/clawd/repos/grupo_borges"),
                _agente("canario", "/home/clawd/repos/grupo_borges"),
            ]
        )
    registros = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(registros) == 1
    texto = registros[0].getMessage()
    assert "daniel" in texto and "canario" in texto


def test_colisao_de_um_par_nao_derruba_os_outros():
    """O agente que não colidiu continua atendido — a recusa é da chave, não do mapa."""
    mapa = _mapear_por_encoded(
        [
            _agente("daniel", "/home/clawd/repos/grupo_borges"),
            _agente("canario", "/home/clawd/repos/grupo_borges"),
            _agente("pavan", "/home/clawd/repos/ze_claude/pavan"),
        ]
    )
    assert mapa == {_encoded("/home/clawd/repos/ze_claude/pavan"): "pavan"}


def _encoded(caminho: str) -> str:
    from orchestrator.jsonl_watcher import encoded_cwd

    return encoded_cwd(caminho)
