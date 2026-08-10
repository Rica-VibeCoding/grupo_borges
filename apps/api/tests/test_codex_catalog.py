"""Catálogo de modelos do harness da Tara.

O teste que importa aqui é o de ida-e-volta do slug: ele é a única prova de que
o `-m` injetado no `codex exec` bate com o nome que o CLI publica. Errar essa
tradução não dá erro visível — o Codex recusa o modelo e a Tara roda o default,
que é exatamente o sintoma "troquei e não mudou nada".
"""

from __future__ import annotations

import json
import subprocess

import pytest

from services import codex_catalog


CATALOGO_REAL = {
    "models": [
        {
            "slug": "gpt-5.6-sol",
            "display_name": "GPT-5.6-Sol",
            "default_reasoning_level": "low",
            "supported_reasoning_levels": [
                {"effort": "low"},
                {"effort": "medium"},
                {"effort": "high"},
                {"effort": "xhigh"},
                {"effort": "max"},
                {"effort": "ultra"},
            ],
            "visibility": "list",
            "priority": 1,
        },
        {
            "slug": "gpt-5.6-sol-wm",
            "display_name": "GPT-5.6-Sol-wm",
            "supported_reasoning_levels": [{"effort": "low"}],
            "visibility": "hide",
            "priority": 1,
        },
        {
            "slug": "gpt-5.5",
            "display_name": "GPT-5.5",
            "default_reasoning_level": "medium",
            "supported_reasoning_levels": [
                {"effort": "low"},
                {"effort": "medium"},
                {"effort": "high"},
                {"effort": "xhigh"},
            ],
            "visibility": "list",
            "priority": 7,
        },
        {
            "slug": "gpt-5.3-codex-spark",
            "display_name": "GPT-5.3-Codex-Spark",
            "default_reasoning_level": "high",
            "supported_reasoning_levels": [{"effort": "low"}, {"effort": "xhigh"}],
            "visibility": "list",
            "priority": 26,
        },
    ]
}


@pytest.fixture(autouse=True)
def _cache_limpo():
    codex_catalog.limpar_cache()
    yield
    codex_catalog.limpar_cache()


def _fake_run(saida: str, returncode: int = 0):
    def run(*_args, **_kwargs):
        return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=saida, stderr="")

    return run


def test_le_catalogo_e_ordena_por_prioridade(monkeypatch):
    monkeypatch.setattr(subprocess, "run", _fake_run(json.dumps(CATALOGO_REAL)))

    modelos = codex_catalog.listar_modelos()

    assert [m.slug for m in modelos] == [
        "codex-gpt-5-6-sol",
        "codex-gpt-5-5",
        "codex-gpt-5-3-codex-spark",
    ]


def test_modelo_oculto_nao_entra(monkeypatch):
    """`gpt-5.6-sol-wm` é interno do harness — oferecê-lo seria oferecer o que
    o próprio CLI marcou como fora de escolha."""
    monkeypatch.setattr(subprocess, "run", _fake_run(json.dumps(CATALOGO_REAL)))

    assert "codex-gpt-5-6-sol-wm" not in codex_catalog.slugs_permitidos()


def test_visibilidade_ausente_nao_e_permissao(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        _fake_run(json.dumps({"models": [{"slug": "gpt-9.9", "priority": 1}]})),
    )

    assert codex_catalog.listar_modelos() == ()


def test_escala_de_esforco_e_por_modelo(monkeypatch):
    """O motivo de o catálogo existir: `max` vale no sol e não vale no 5.5."""
    monkeypatch.setattr(subprocess, "run", _fake_run(json.dumps(CATALOGO_REAL)))

    assert "ultra" in codex_catalog.efforts_do_modelo("codex-gpt-5-6-sol")
    assert "max" not in codex_catalog.efforts_do_modelo("codex-gpt-5-5")
    assert codex_catalog.efforts_do_modelo("codex-nao-existe") == ()
    assert codex_catalog.efforts_do_modelo(None) == ()


def test_ida_e_volta_do_slug(monkeypatch):
    """Todo modelo do catálogo tem que voltar ao nome cru que o `-m` aceita."""
    monkeypatch.setattr(subprocess, "run", _fake_run(json.dumps(CATALOGO_REAL)))

    for modelo in codex_catalog.listar_modelos():
        assert codex_catalog.canonical_slug(modelo.raw) == modelo.slug
        assert codex_catalog.raw_slug(modelo.slug) == modelo.raw


def test_volta_do_slug_sem_catalogo():
    """Sem catálogo lido, a regra derivada segura o sufixo composto.

    O fallback antigo (`replace('-', '.')`) devolvia `gpt.5.3.codex.spark`.
    """
    assert codex_catalog.raw_slug("codex-gpt-5-3-codex-spark") == "gpt-5.3-codex-spark"
    assert codex_catalog.raw_slug("codex-gpt-5-4-mini") == "gpt-5.4-mini"
    assert codex_catalog.raw_slug("codex-gpt-5-5") == "gpt-5.5"


def test_cli_quebrado_nao_derruba_e_nao_inventa(monkeypatch):
    monkeypatch.setattr(subprocess, "run", _fake_run("", returncode=1))
    assert codex_catalog.listar_modelos() == ()

    monkeypatch.setattr(subprocess, "run", _fake_run("isto não é json"))
    codex_catalog.limpar_cache()
    assert codex_catalog.listar_modelos() == ()


def test_cli_ausente_nao_propaga_excecao(monkeypatch):
    def explode(*_args, **_kwargs):
        raise FileNotFoundError("codex")

    monkeypatch.setattr(subprocess, "run", explode)
    assert codex_catalog.listar_modelos() == ()


def test_falha_depois_de_sucesso_preserva_o_ultimo_catalogo(monkeypatch):
    """Uma falha momentânea do CLI não pode esvaziar o seletor do Rica."""
    monkeypatch.setattr(subprocess, "run", _fake_run(json.dumps(CATALOGO_REAL)))
    assert len(codex_catalog.listar_modelos()) == 3

    monkeypatch.setattr(subprocess, "run", _fake_run("", returncode=1))
    assert len(codex_catalog.listar_modelos(forcar=True)) == 3


def test_cache_evita_subprocess_repetido(monkeypatch):
    chamadas = {"n": 0}

    def contando(*_args, **_kwargs):
        chamadas["n"] += 1
        return subprocess.CompletedProcess(
            args=[], returncode=0, stdout=json.dumps(CATALOGO_REAL), stderr=""
        )

    monkeypatch.setattr(subprocess, "run", contando)
    codex_catalog.listar_modelos()
    codex_catalog.listar_modelos()
    codex_catalog.listar_modelos()

    assert chamadas["n"] == 1
