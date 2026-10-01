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

#: Quanto tempo uma conversa deixada pela linha fica isenta da regra dos 2 min.
#: Folga sobre os 120 s do 🔒: o fim do turno de estacionar ainda escreve nela.
MEMORIA_DEIXADA_S = 600.0

#: `slug → {session_id: quando saiu}`. Só a última troca não basta: em
#: A → B → C, a A ainda tem escrita de menos de 2 min quando a C entra (F11).
_deixadas: dict[str, dict[str, float]] = {}


def registrar_troca(slug: str, saiu: str | None, entrou: str) -> None:
    _trocas[slug] = Troca(saiu=saiu, entrou=entrou)
    agora = time.time()
    deixadas = {
        sid: quando
        for sid, quando in _deixadas.get(slug, {}).items()
        if agora - quando < MEMORIA_DEIXADA_S and sid != entrou
    }
    if saiu is not None and saiu != entrou:
        deixadas[saiu] = agora
    _deixadas[slug] = deixadas


def corrigir_atual(slug: str, atual_do_banco: str | None) -> str | None:
    """A atual da linha: a do banco, salvo se ele ainda aponta a que saiu."""
    troca = _trocas.get(slug)
    if troca is not None and atual_do_banco in (None, troca.saiu):
        return troca.entrou
    return atual_do_banco


def deixadas(slug: str) -> frozenset[str]:
    """As conversas que esta linha deixou há pouco: escrita recente delas é nossa."""
    agora = time.time()
    return frozenset(
        sid
        for sid, quando in _deixadas.get(slug, {}).items()
        if agora - quando < MEMORIA_DEIXADA_S
    )


def esquecer(slug: str) -> None:
    """Só para os testes."""
    _operacoes.pop(slug, None)
    _trocas.pop(slug, None)
    _deixadas.pop(slug, None)
    _trocas_publicadas.pop(slug, None)
    _briefings.pop(slug, None)


# ---------- F13: o chat acompanha a troca ----------

#: Canal da troca para o stream do chat: `slug → [{seq, session_id, de, …}]`.
#: Cada stream aberto guarda o `seq` que já viu, como o `session_reset`.
_trocas_publicadas: dict[str, list[dict]] = {}
_seq_troca = 0
#: Trocas guardadas por agente: o stream só lê as posteriores à abertura.
TROCAS_GUARDADAS = 10


def publicar_troca(slug: str, payload: dict) -> None:
    global _seq_troca
    _seq_troca += 1
    lista = _trocas_publicadas.setdefault(slug, [])
    lista.append({"seq": _seq_troca, **payload})
    del lista[:-TROCAS_GUARDADAS]


def seq_da_troca() -> int:
    return _seq_troca


def trocas_desde(slug: str, depois_de: int) -> tuple[list[dict], int]:
    """As trocas publicadas depois de `depois_de`, sem o `seq`, e o cursor novo."""
    novas = [t for t in _trocas_publicadas.get(slug, []) if t["seq"] > depois_de]
    cursor = max((t["seq"] for t in novas), default=depois_de)
    return [{k: v for k, v in t.items() if k != "seq"} for t in novas], cursor


#: `slug → {session_id: texto}` do briefing que o gancho levou na largada.
#: Vazio = o gancho perguntou e não havia o que dizer.
_briefings: dict[str, dict[str, str]] = {}
#: Quanto o Retomar espera o gancho, depois da linha pronta, para pôr o
#: briefing na troca. O gancho costuma chegar antes da caixa de input (F13).
PRAZO_BRIEFING_S = 3.0


def guardar_briefing(slug: str, session_id: str, texto: str) -> None:
    _briefings.setdefault(slug, {})[session_id] = texto


def briefing_entregue(slug: str, session_id: str) -> bool:
    return session_id in _briefings.get(slug, {})


def tirar_briefing(slug: str, session_id: str) -> str | None:
    """O briefing entregue nesta largada, uma vez só; `None` se não houve."""
    return _briefings.get(slug, {}).pop(session_id, None) or None


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
    """Título (ou nota) numa linha só, como a lista desenha.

    Todo caractere de controle vira espaço e o excesso vira reticências.
    """
    limpo = " ".join(_CONTROLE_RE.sub(" ", texto).split())
    if len(limpo) <= limite:
        return limpo
    return limpo[: limite - 1].rstrip() + "…"


DEPOIS_DE_ESTACIONAR = {
    "nova": "abrir uma nova",
    "retomar": "retomar uma conversa antiga nesta linha",
}


#: Começo do pedido de estacionar. O feed reconhece por ele as mensagens do
#: cockpit (`origem: "cockpit"`, F13): mudar o texto aqui muda lá junto.
PREFIXO_DO_PEDIDO = "[cockpit] Vou fechar esta conversa"


def mensagem_de_estacionar(url_base: str, slug: str, para: str = "nova") -> str:
    """O pedido que vai para o agente: uma linha só, com o `curl` pronto.

    Linha única porque é o que o `send_message` prova com mais folga. O header
    do Tailscale é o mesmo que o middleware cobra de qualquer chamada: o agente
    roda na própria VPS e chama a API por dentro.
    """
    rota = f"{url_base.rstrip('/')}/api/agents/{slug}/conversas/estacionar"
    return (
        f"{PREFIXO_DO_PEDIDO} e {DEPOIS_DE_ESTACIONAR[para]}. "
        "Antes, estacione esta: "
        "um título de até 6 palavras e uma nota de até 200 caracteres com onde você parou "
        "e qual é o próximo passo. Grave com este comando, trocando só os dois textos "
        "(o corpo precisa ser JSON válido; se o texto tiver apóstrofo, mande o JSON por "
        f"heredoc): curl -sS -X POST {rota} -H 'Content-Type: application/json' "
        f"-H 'Tailscale-User-Login: agente-{slug}' "
        """-d '{"titulo": "TÍTULO", "nota": "NOTA"}' """
        "— depois responda só ok e não faça mais nada."
    )
