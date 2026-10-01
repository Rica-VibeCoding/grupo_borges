"""A lista de conversas do Claude Code de um agente (F2 de `docs/conversas/PLANO.md`).

Lê a pasta do cwd do agente em `~/.claude/projects/` e devolve um resumo por
JSONL: título, turnos, tamanho, hora da última escrita. O estado que o JSONL
não guarda (título estacionado, nota, estrela) vem da `conversa_meta`, que o
chamador passa pronta.

**JSONL não é formato documentado.** Por isso o parser só olha o que precisa —
as linhas curtas de metadado (`custom-title`, `ai-title`, `last-prompt`) e as
mensagens do usuário — e engole qualquer linha que não entenda. Linha quebrada
(arquivo truncado, ou a última linha ainda sendo escrita) é pulada, nunca
derruba a lista.

**Custo.** Contar turnos pede o arquivo inteiro: a contagem não mora no fim.
Três coisas mantêm isso barato:

- a janela de 30 dias (mais as ⭐) filtra por `mtime` ANTES de abrir arquivo;
- o cache é por `(inode, mtime, tamanho)`, e conversa que só cresceu é lida
  **do ponto onde parou** — o JSONL do CC é só-acréscimo, então depois da
  primeira leitura só a conversa viva custa alguma coisa, e só o trecho novo;
- a linha grande (resultado de ferramenta, anexo, resposta) não passa pelo
  `json.loads`: ela é descartada pelos bytes antes.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import threading
import unicodedata
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Iterable, Iterator

from orchestrator.lifecycle_ruido import eh_interrupcao, eh_ruido_de_lifecycle
from services.tmux_driver import _SESSION_ID_PATTERN

logger = logging.getLogger(__name__)

JANELA_SEGUNDOS = 30 * 24 * 3600
#: JSONL escrito há menos que isso e que não é a conversa desta linha está
#: aberta em outro lugar (outro terminal, outro agente) — 🔒.
ESCRITA_RECENTE_SEGUNDOS = 120
#: Até este número de turnos a conversa é "curta" e fica escondida por padrão.
TURNOS_CURTA = 2
_TITULO_MAX = 80
_BLOCO_LEITURA = 1 << 20

_PREFIXO_METADADO = b'{"type":"'
_MARCA_USER = b'"type":"user"'
_MARCA_TOOL_RESULT = b'"type":"tool_result"'
_SYSTEM_REMINDER_RE = re.compile(r"<system-reminder>.*?</system-reminder>", re.DOTALL)


@dataclass
class _Resumo:
    """O que a leitura do JSONL extrai. Sempre a ÚLTIMA ocorrência do metadado."""

    custom: str | None = None
    ai: str | None = None
    prompt: str | None = None
    primeira: str | None = None
    turnos: int = 0


@dataclass
class _Entrada:
    ino: int
    mtime_ns: int
    tamanho: int
    lido_ate: int
    resumo: _Resumo = field(default_factory=_Resumo)


_cache: dict[str, _Entrada] = {}
_trava = threading.Lock()


def _normalizar(texto: str) -> str:
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c)
    )
    return " ".join(sem_acento.casefold().split())


def nomes_do_agente(agent: dict[str, Any]) -> set[str]:
    """Os nomes que, como título, valem por "sem título".

    O boot dá o nome do agente a toda conversa (`/rename` do `subir-frota.sh`),
    e medido em 01/10 a `custom-title` do Pavan é "Pavan" ou "José Pavan". Por
    isso entram o slug, a sessão tmux, o nome inteiro e cada palavra dele.
    """
    nomes: set[str] = set()
    for valor in (agent.get("slug"), agent.get("tmux_session"), agent.get("name")):
        if not isinstance(valor, str) or not valor.strip():
            continue
        normal = _normalizar(valor)
        nomes.add(normal)
        nomes.update(p for p in re.split(r"[\s\-_]+", normal) if len(p) >= 3)
    return nomes


def _linha_curta(texto: str | None) -> str | None:
    if not isinstance(texto, str):
        return None
    limpo = " ".join(_SYSTEM_REMINDER_RE.sub(" ", texto).split())
    if not limpo:
        return None
    return limpo if len(limpo) <= _TITULO_MAX else limpo[: _TITULO_MAX - 1].rstrip() + "…"


def _texto_do_usuario(payload: dict[str, Any]) -> str | None:
    message = payload.get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        partes = [
            b.get("text")
            for b in content
            if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)
        ]
        return "\n".join(partes) if partes else None
    return None


def _eh_turno(payload: dict[str, Any]) -> str | None:
    """O texto do pedido, se a linha é um turno de verdade do usuário."""
    if payload.get("type") != "user":
        return None
    if payload.get("isSidechain") or payload.get("isMeta") or payload.get("isCompactSummary"):
        return None
    texto = _texto_do_usuario(payload)
    if not texto or not texto.strip():
        return None
    if eh_ruido_de_lifecycle(texto) or eh_interrupcao(texto):
        return None
    return texto


def _prompt_aproveitavel(texto: str | None) -> str | None:
    """`last-prompt` que é comando (`/clear`, `/rename`) não serve de título."""
    curto = _linha_curta(texto)
    if curto is None or curto.startswith("/"):
        return None
    return curto


def _absorver(resumo: _Resumo, linha: bytes) -> None:
    if linha.startswith(_PREFIXO_METADADO):
        try:
            payload = json.loads(linha)
        except ValueError:
            return
        tipo = payload.get("type")
        if tipo == "custom-title":
            resumo.custom = _linha_curta(payload.get("customTitle")) or resumo.custom
        elif tipo == "ai-title":
            resumo.ai = _linha_curta(payload.get("aiTitle")) or resumo.ai
        elif tipo == "last-prompt":
            resumo.prompt = _prompt_aproveitavel(payload.get("lastPrompt")) or resumo.prompt
        return
    if _MARCA_USER not in linha or _MARCA_TOOL_RESULT in linha:
        return
    try:
        payload = json.loads(linha)
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    texto = _eh_turno(payload)
    if texto is None:
        return
    resumo.turnos += 1
    if resumo.primeira is None:
        resumo.primeira = _linha_curta(texto)


def _linhas_completas(caminho: Path, inicio: int) -> Iterator[tuple[bytes, int]]:
    """Linhas terminadas em `\\n` a partir de `inicio`, com o offset depois de cada uma.

    A última linha sem `\\n` (o CC no meio da escrita, ou arquivo truncado) fica
    de fora e é relida na próxima vez, a partir do offset devolvido.
    """
    with caminho.open("rb") as arquivo:
        arquivo.seek(inicio)
        sobra = b""
        posicao = inicio
        while True:
            bloco = arquivo.read(_BLOCO_LEITURA)
            if not bloco:
                return
            dados = sobra + bloco
            fim = dados.rfind(b"\n")
            if fim < 0:
                sobra = dados
                continue
            for linha in dados[:fim].split(b"\n"):
                posicao += len(linha) + 1
                yield linha, posicao
            sobra = dados[fim + 1 :]


def _resumir(caminho: Path, st: os.stat_result) -> _Resumo:
    """Resumo do JSONL, relendo só o trecho que o cache ainda não viu."""
    chave = str(caminho)
    entrada = _cache.get(chave)
    if (
        entrada is not None
        and entrada.ino == st.st_ino
        and entrada.mtime_ns == st.st_mtime_ns
        and entrada.tamanho == st.st_size
    ):
        return entrada.resumo
    if entrada is not None and entrada.ino == st.st_ino and st.st_size >= entrada.lido_ate:
        resumo = replace(entrada.resumo)
        inicio = entrada.lido_ate
    else:
        resumo = _Resumo()
        inicio = 0
    lido_ate = inicio
    try:
        for linha, lido_ate in _linhas_completas(caminho, inicio):
            _absorver(resumo, linha)
    except OSError as exc:
        logger.warning("conversas: leitura de %s falhou (%s)", caminho, exc)
    _cache[chave] = _Entrada(
        ino=st.st_ino, mtime_ns=st.st_mtime_ns, tamanho=st.st_size,
        lido_ate=lido_ate, resumo=resumo,
    )
    return resumo


def _titulo(
    session_id: str, resumo: _Resumo, meta: dict[str, Any] | None, nomes: set[str]
) -> tuple[str, str]:
    """Ordem de queda do contrato. Nunca vazio."""
    estacionado = _linha_curta(meta.get("titulo")) if meta else None
    if estacionado:
        return estacionado, "estacionada"
    if resumo.custom and _normalizar(resumo.custom) not in nomes:
        return resumo.custom, "custom"
    if resumo.ai:
        return resumo.ai, "ai"
    if resumo.prompt:
        return resumo.prompt, "prompt"
    if resumo.primeira:
        return resumo.primeira, "primeira"
    return f"Conversa {session_id[:8]}", "primeira"


def _arquivos(pasta: Path) -> Iterable[tuple[str, Path, os.stat_result]]:
    try:
        itens = list(os.scandir(pasta))
    except (FileNotFoundError, NotADirectoryError):
        return
    for item in itens:
        if not item.name.endswith(".jsonl"):
            continue
        session_id = item.name[: -len(".jsonl")]
        if not _SESSION_ID_PATTERN.fullmatch(session_id):
            continue
        try:
            if not item.is_file(follow_symlinks=False):
                continue
            st = item.stat(follow_symlinks=False)
        except OSError:
            continue
        yield session_id, Path(item.path), st


def trava(
    session_id: str,
    st: os.stat_result,
    *,
    atual: str | None,
    atuais_de_outras: dict[str, str],
    agora: float,
) -> tuple[bool, str | None]:
    """🔒 e quem tem a conversa aberta.

    `atuais_de_outras` é `session_id → slug` da conversa atual de cada outra
    linha viva. Escrita há < 2 min sem ser a atual desta linha também trava,
    mas sem dono conhecido (outro terminal, `claude` solto): `(True, None)`.
    """
    dono = atuais_de_outras.get(session_id)
    if dono:
        return True, dono
    if session_id != atual and agora - st.st_mtime < ESCRITA_RECENTE_SEGUNDOS:
        return True, None
    return False, None


def localizar(pasta: Path, session_id: str) -> tuple[Path, os.stat_result] | None:
    """O JSONL da conversa, só se o id é um sessionId e o arquivo mora na pasta.

    Id fora do padrão (`../`, caminho, lixo) nem vira caminho. Depois do
    padrão, o caminho resolvido ainda tem de cair dentro da pasta, e link
    simbólico não conta — a mesma régua de `_arquivos`.
    """
    if not _SESSION_ID_PATTERN.fullmatch(session_id):
        return None
    caminho = pasta / f"{session_id}.jsonl"
    try:
        if caminho.resolve().parent != pasta.resolve():
            return None
        st = caminho.lstat()
    except OSError:
        return None
    if not caminho.is_file() or caminho.is_symlink():
        return None
    return caminho, st


class LixeiraIndisponivel(RuntimeError):
    """`gio` não existe no servidor. Nada foi apagado."""


class LixeiraFalhou(RuntimeError):
    """`gio trash` recusou o JSONL. Nada foi apagado."""


def _comando_gio() -> str | None:
    return shutil.which("gio")


def _gio_trash(gio: str, alvo: Path) -> str | None:
    """Manda para a lixeira; devolve a mensagem de erro, ou `None` se deu certo."""
    try:
        feito = subprocess.run(
            [gio, "trash", str(alvo)], capture_output=True, text=True, timeout=30
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return str(exc) or exc.__class__.__name__
    if feito.returncode != 0:
        return (feito.stderr or feito.stdout).strip() or f"gio saiu com {feito.returncode}"
    return None


def mandar_para_lixeira(pasta: Path, session_id: str, caminho: Path) -> dict[str, Any]:
    """Manda o JSONL e a pasta irmã `<id>/` (subagentes, anexos) para a lixeira.

    O JSONL vai primeiro: se ele falhar, nada saiu do lugar. A pasta irmã só
    vai depois; se ela falhar, a conversa já sumiu da lista e o que sobra é
    resto órfão — fica registrado em `pasta_irma`, não vira erro.
    """
    gio = _comando_gio()
    if gio is None:
        raise LixeiraIndisponivel("gio não está instalado no servidor; nada foi apagado")
    erro = _gio_trash(gio, caminho)
    if erro is not None:
        raise LixeiraFalhou(f"gio trash recusou a conversa ({erro}); nada foi apagado")
    with _trava:
        _cache.pop(str(caminho), None)

    irma = pasta / session_id
    if irma.is_symlink() or not irma.is_dir():
        pasta_irma = "ausente"
    elif irma.resolve().parent != pasta.resolve():
        pasta_irma = "ausente"
    else:
        erro = _gio_trash(gio, irma)
        if erro is None:
            pasta_irma = "lixeira"
        else:
            logger.warning("conversas: pasta irmã %s ficou (%s)", irma, erro)
            pasta_irma = "ficou"
    return {"id": session_id, "pasta_irma": pasta_irma}


def listar(
    pasta: Path,
    *,
    nomes: set[str],
    metas: dict[str, dict[str, Any]],
    atual: str | None,
    atuais_de_outras: dict[str, str],
    agora: float,
) -> list[dict[str, Any]]:
    """Todas as conversas da janela (30 dias + ⭐), da mais recente para a mais antiga.

    Filtro, busca e `curtas` ficam com quem chama (`filtrar`): aqui sai a lista
    inteira da janela, que é o que o cache precisa ver.
    """
    conversas: list[dict[str, Any]] = []
    with _trava:
        for session_id, caminho, st in _arquivos(pasta):
            meta = metas.get(session_id)
            estrela = bool(meta and meta.get("estrela"))
            if not estrela and agora - st.st_mtime > JANELA_SEGUNDOS:
                continue
            resumo = _resumir(caminho, st)
            titulo, origem = _titulo(session_id, resumo, meta, nomes)
            eh_atual = session_id == atual
            bloqueada, bloqueada_por = trava(
                session_id, st, atual=atual, atuais_de_outras=atuais_de_outras, agora=agora
            )
            conversas.append(
                {
                    "id": session_id,
                    "titulo": titulo,
                    "titulo_origem": origem,
                    "nota": (meta or {}).get("nota") or None,
                    "atualizada_em": st.st_mtime_ns // 1_000_000,
                    "turnos": resumo.turnos,
                    "bytes": st.st_size,
                    "estrela": estrela,
                    "atual": eh_atual,
                    "bloqueada": bloqueada,
                    "bloqueada_por": bloqueada_por,
                    "pendencia": None,
                }
            )
    conversas.sort(key=lambda c: c["atualizada_em"], reverse=True)
    return conversas


def filtrar(
    conversas: list[dict[str, Any]], *, filtro: str, q: str | None, curtas: bool
) -> tuple[list[dict[str, Any]], int]:
    """Aplica filtro e busca; depois esconde as curtas e conta quantas sumiram.

    A conversa atual e as ⭐ nunca são escondidas por serem curtas: a atual de
    um agente recém-limpo tem zero turnos e precisa aparecer, e a estrela é
    escolha explícita de guardar.
    """
    if filtro == "estrela":
        conversas = [c for c in conversas if c["estrela"]]
    elif filtro == "pendencia":
        conversas = [c for c in conversas if c["pendencia"]]
    termo = _normalizar(q) if q else ""
    if termo:
        conversas = [
            c for c in conversas
            if termo in _normalizar(c["titulo"]) or termo in _normalizar(c["nota"] or "")
        ]
    if curtas:
        return conversas, 0
    visiveis = [
        c for c in conversas if c["turnos"] > TURNOS_CURTA or c["atual"] or c["estrela"]
    ]
    return visiveis, len(conversas) - len(visiveis)
