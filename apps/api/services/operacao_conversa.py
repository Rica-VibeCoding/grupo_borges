"""Operação de conversa por agente: Nova conversa (F5) e Retomar (F6).

Uma operação por agente de cada vez. O estado mora em memória, de propósito:
ele só vale enquanto a operação corre, e um restart da API no meio já derruba
a operação junto — a tela lê `fase: null` e para de esperar.

**Relógio falso.** Toda espera passa por `relogio()` e `dormir()`, que os
testes trocam por um relógio que anda sozinho. Nenhum prazo daqui custa
tempo de verdade na bancada.
"""
from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

Fase = Literal["estacionando", "religando", "pronta", "erro"]
EM_CURSO: frozenset[str] = frozenset({"estacionando", "religando"})

#: Quanto o agente tem para chamar o `POST /estacionar` (contrato: 60 s).
PRAZO_ESTACIONAR_S = 60.0
#: Depois do `/estacionar`, o agente ainda fecha o turno ("ok"). Passou disso,
#: o cockpit interrompe: a nota já chegou, o resto do turno não vale nada.
PRAZO_OCIOSO_S = 15.0
#: Do `/clear` até o JSONL da conversa nova existir na pasta.
PRAZO_CONVERSA_NOVA_S = 10.0
#: Retomar: do boot disparado até a linha pronta (caixa de input vazia) na
#: conversa pedida. O `boot_agent` já espera até 40 s o processo aparecer.
PRAZO_LARGADA_S = 60.0
#: Quantas vezes o Retomar aperta Escape num diálogo de retomada que não sai.
ESCAPES_NO_DIALOGO = 3
PASSO_S = 0.5
#: Teto da resposta síncrona do `POST /nova`. A operação segue no servidor.
TETO_RESPOSTA_S = 90.0

TITULO_MAX = 80
_CONTROLE_RE = re.compile(r"[\x00-\x1f\x7f]")

relogio: Callable[[], float] = time.monotonic


async def dormir(segundos: float) -> None:
    await asyncio.sleep(segundos)


@dataclass
class Operacao:
    fase: Fase
    desde: int  # epoch ms
    detalhe: str | None = None
    #: Sessão que esperava o `/estacionar`; `None` fora da espera.
    aguardando: str | None = None
    estacionou: bool = False
    titulo: str | None = None


_operacoes: dict[str, Operacao] = {}


class OperacaoEmCurso(RuntimeError):
    """Já há uma operação correndo neste agente."""


def _agora_ms() -> int:
    return int(time.time() * 1000)


def estado(slug: str) -> Operacao | None:
    return _operacoes.get(slug)


def comecar(slug: str) -> Operacao:
    """Abre a operação na fase `estacionando`. Sem `await` no meio: é atômico."""
    atual = _operacoes.get(slug)
    if atual is not None and atual.fase in EM_CURSO:
        raise OperacaoEmCurso(atual.fase)
    op = Operacao(fase="estacionando", desde=_agora_ms())
    _operacoes[slug] = op
    return op


def avancar(op: Operacao, fase: Fase, detalhe: str | None = None) -> None:
    op.fase = fase
    op.desde = _agora_ms()
    op.detalhe = detalhe


def avisar_estacionou(slug: str, session_id: str, titulo: str) -> bool:
    """O agente chamou o `/estacionar`. Devolve `True` se havia quem esperasse."""
    op = _operacoes.get(slug)
    if op is None or op.aguardando is None or op.aguardando != session_id:
        return False
    op.estacionou = True
    op.titulo = titulo
    return True


@dataclass(frozen=True)
class Troca:
    """A última troca de conversa que o cockpit fez nesta linha."""

    saiu: str | None
    entrou: str


#: Por que existe: o `latest_jsonl_session_id` vem do watcher, que só vê a
#: conversa nova quando ela ganha mensagem. Logo depois de um Retomar (ou de
#: uma Nova), o banco ainda diz que a atual é a que saiu — e a que saiu, escrita
#: há segundos, cairia na regra dos 2 min do 🔒. Sem isto, A → B → A dava 409.
_trocas: dict[str, Troca] = {}


def registrar_troca(slug: str, saiu: str | None, entrou: str) -> None:
    _trocas[slug] = Troca(saiu=saiu, entrou=entrou)


def corrigir_atual(slug: str, atual_do_banco: str | None) -> str | None:
    """A atual da linha: a do banco, salvo se ele ainda aponta a que saiu."""
    troca = _trocas.get(slug)
    if troca is not None and atual_do_banco in (None, troca.saiu):
        return troca.entrou
    return atual_do_banco


def deixada(slug: str) -> str | None:
    """A conversa que esta linha acabou de deixar: escrita recente dela é nossa."""
    troca = _trocas.get(slug)
    return troca.saiu if troca is not None else None


def esquecer(slug: str) -> None:
    """Só para os testes."""
    _operacoes.pop(slug, None)
    _trocas.pop(slug, None)


async def esperar(condicao: Callable[[], Awaitable[bool]], prazo_s: float) -> bool:
    """Confere `condicao` a cada `PASSO_S` até ela valer ou o prazo acabar."""
    fim = relogio() + prazo_s
    while True:
        if await condicao():
            return True
        if relogio() >= fim:
            return False
        await dormir(PASSO_S)


def linha_unica(texto: str, limite: int = TITULO_MAX) -> str:
    """Título que cabe numa linha de comando do CC.

    Quebra de linha num `/clear` colado vira DOIS envios: o `/clear` sairia com
    meio título e o resto viraria mensagem para a conversa nova. Por isso todo
    caractere de controle vira espaço. Aspas e acento passam crus — o CC lê o
    argumento do `/clear` como texto, sem shell no meio.
    """
    limpo = " ".join(_CONTROLE_RE.sub(" ", texto).split())
    if len(limpo) <= limite:
        return limpo
    return limpo[: limite - 1].rstrip() + "…"


DEPOIS_DE_ESTACIONAR = {
    "nova": "abrir uma nova",
    "retomar": "retomar uma conversa antiga nesta linha",
}


def mensagem_de_estacionar(url_base: str, slug: str, para: str = "nova") -> str:
    """O pedido que vai para o agente: uma linha só, com o `curl` pronto.

    Linha única porque é o que o `send_message` prova com mais folga. O header
    do Tailscale é o mesmo que o middleware cobra de qualquer chamada: o agente
    roda na própria VPS e chama a API por dentro.
    """
    rota = f"{url_base.rstrip('/')}/api/agents/{slug}/conversas/estacionar"
    return (
        f"[cockpit] Vou fechar esta conversa e {DEPOIS_DE_ESTACIONAR[para]}. "
        "Antes, estacione esta: "
        "um título de até 6 palavras e uma nota de até 200 caracteres com onde você parou "
        "e qual é o próximo passo. Grave com este comando, trocando só os dois textos "
        "(o corpo precisa ser JSON válido; se o texto tiver apóstrofo, mande o JSON por "
        f"heredoc): curl -sS -X POST {rota} -H 'Content-Type: application/json' "
        f"-H 'Tailscale-User-Login: agente-{slug}' "
        """-d '{"titulo": "TÍTULO", "nota": "NOTA"}' """
        "— depois responda só ok e não faça mais nada."
    )
