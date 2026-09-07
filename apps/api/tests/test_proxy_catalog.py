"""O catálogo do rail `codex` lido do binário do `claude-code-proxy`.

O que estes testes travam é o PARSE e a régua de corte, não o conteúdo: a lista
muda com o provedor, e é justamente por isso que ela não mora no código. A
amostra abaixo é a saída real de `claude-code-proxy models` medida em 06/09/2026.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import proxy_catalog


SAIDA_REAL = """codex: claude-fable-5, claude-haiku-4-5, claude-opus-5, fable, gpt-5.2, \
gpt-5.2-fast, gpt-5.3-codex, gpt-5.4, gpt-5.4-mini, gpt-5.5, gpt-5.6-luna, \
gpt-5.6-luna-fast, gpt-5.6-sol, gpt-5.6-sol-fast, gpt-5.6-terra, gpt-5.6-terra-fast, \
haiku, opus, sonnet
kimi: k2.6, k3, kimi-for-coding
grok: grok-4.5, grok-4.6
cursor: composer-2.5, cursor; 0 cursor model aliases run `claude-code-proxy models --full`
"""


#: Saída real do build do `main` (55bf0b5) medida em 07/09/2026.
SAIDA_COM_ASTRA = """codex: claude-fable-5, claude-haiku-4-5, claude-haiku-4-5-20251001, \
claude-opus-4-7, claude-opus-4-8, claude-opus-5, claude-sonnet-4-6, claude-sonnet-5, fable, \
gpt-5.2, gpt-5.2-fast, gpt-5.3-codex, gpt-5.3-codex-fast, gpt-5.3-codex-spark, \
gpt-5.3-codex-spark-fast, gpt-5.4, gpt-5.4-fast, gpt-5.4-mini, gpt-5.4-mini-fast, gpt-5.5, \
gpt-5.5-fast, gpt-5.6-luna, gpt-5.6-luna-fast, gpt-5.6-sol, gpt-5.6-sol-fast, gpt-5.6-terra, \
gpt-5.6-terra-fast, gpt-6-astra, gpt-6-astra-fast, haiku, opus, sonnet
kimi: k2.6, k3, kimi-for-coding
"""


def test_le_so_a_linha_do_rail_e_so_as_duas_geracoes_mais_novas() -> None:
    """Quatro gerações na saída, duas no menu — 18 linhas não se leem no celular."""
    ids = proxy_catalog._ids_do_rail(SAIDA_REAL)

    assert proxy_catalog.geracoes_recentes(ids) == (
        "gpt-5.5[1m]",
        "gpt-5.6-luna[1m]",
        "gpt-5.6-luna-fast[1m]",
        "gpt-5.6-sol[1m]",
        "gpt-5.6-sol-fast[1m]",
        "gpt-5.6-terra[1m]",
        "gpt-5.6-terra-fast[1m]",
    )


def test_geracao_sem_minor_entra_sem_derrubar_a_anterior() -> None:
    """`gpt-6-astra` estreou sem ponto e sozinho na geração.

    Se só a maior versão entrasse, o menu viraria Astra e mais nada — e Sol,
    Luna e Terra, que a Tara usa todo dia, sumiriam no dia do lançamento.
    """
    ids = proxy_catalog._ids_do_rail(SAIDA_COM_ASTRA)

    assert proxy_catalog.geracoes_recentes(ids) == (
        "gpt-5.6-luna[1m]",
        "gpt-5.6-luna-fast[1m]",
        "gpt-5.6-sol[1m]",
        "gpt-5.6-sol-fast[1m]",
        "gpt-5.6-terra[1m]",
        "gpt-5.6-terra-fast[1m]",
        "gpt-6-astra[1m]",
        "gpt-6-astra-fast[1m]",
    )


def test_alias_anthropic_do_mesmo_rail_fica_de_fora() -> None:
    """`opus` e `claude-opus-5` são aceitos pelo rail e mapeiam pro backend Codex.

    Deixar passar faria o cockpit rotular "Opus 5" um motor GPT — a tabela de
    nomes é a mesma do resto do painel e traduziria o nome errado.
    """
    assert all(i.startswith("gpt-") for i in proxy_catalog._ids_do_rail(SAIDA_REAL))


def test_linha_de_outro_provedor_nao_entra() -> None:
    """`kimi:` e `grok:` moram na mesma saída; o rail é um só."""
    ids = proxy_catalog._ids_do_rail(SAIDA_REAL)

    assert "k3" not in ids
    assert "grok-4.6" not in ids


def test_saida_sem_o_rail_devolve_vazio_em_vez_de_chutar() -> None:
    assert proxy_catalog._ids_do_rail("kimi: k3\n") == []
    assert proxy_catalog.geracoes_recentes([]) == ()


def test_geracao_compara_numero_e_nao_texto() -> None:
    """`5.10` > `5.9` > `5.8` só quando a comparação é numérica — string poria a 5.10 no fim."""
    assert proxy_catalog.geracoes_recentes(["gpt-5.8-sol", "gpt-5.9-sol", "gpt-5.10-sol"]) == (
        "gpt-5.9-sol[1m]",
        "gpt-5.10-sol[1m]",
    )


def test_e_do_rail_separa_id_vivo_do_residuo_do_cli() -> None:
    """A régua que o sync do `agents.yaml` usa sem abrir subprocess."""
    assert proxy_catalog.e_do_rail("gpt-5.6-sol[1m]") is True
    assert proxy_catalog.e_do_rail("codex-gpt-5-6-sol") is False
    assert proxy_catalog.e_do_rail(None) is False
