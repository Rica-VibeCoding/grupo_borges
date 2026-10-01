"""Os arquivos de uma conversa contra o git: selo ⚠️ e briefing de retorno (F7).

Quem diz QUAIS arquivos a conversa mexeu é `conversas.arquivos_de`. Aqui eles
viram repositório por repositório, e o git responde duas perguntas:

- **pendência** (o ⚠️ da lista): quantos desses arquivos continuam sem commit
  e foram mexidos por último por esta conversa — arquivo sujo cuja última
  escrita é mais nova que a conversa é de quem veio depois;
- **briefing**: os commits que tocaram esses arquivos desde a última atividade
  da conversa, mais os que seguem sem commit. No máximo 25 linhas.

O `git status` de cada repositório fica em cache por 30 s: a lista conta a
pendência de todas as conversas da janela com um `git status` por repo.
"""
from __future__ import annotations

import logging
import os
import subprocess
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

TTL_STATUS_S = 30.0
#: Folga entre a última escrita do arquivo e a do JSONL: o CC grava a linha da
#: ferramenta um instante depois de escrever o arquivo.
FOLGA_AUTORIA_S = 60.0
LINHAS_MAX = 25
_COMMITS_MAX = 10
_PENDENTES_MAX = 10
_GIT_TIMEOUT_S = 5.0
_PATHSPECS_MAX = 500
#: O agente lê o briefing ao lado do Rica, e a tela vive em Brasília. A VPS roda
#: em UTC: sem fuso explícito, o agente recebia 05:16 e a tela mostrava 02:16.
FUSO = "America/Sao_Paulo"
_ZONA = ZoneInfo(FUSO)
#: `format-local` + `TZ` no ambiente: o `git log` data no fuso de Brasília, não
#: no fuso de quem fez o commit.
_GIT_ENV = {**os.environ, "TZ": FUSO}


@dataclass(frozen=True)
class _Status:
    #: caminho relativo à raiz → código XY do `git status --porcelain`
    sujos: dict[str, str]
    #: pastas inteiras não rastreadas, com a barra no fim (`apps/novo/`)
    pastas_novas: tuple[str, ...]

    def codigo(self, relativo: str) -> str | None:
        if relativo in self.sujos:
            return self.sujos[relativo]
        if any(relativo.startswith(p) for p in self.pastas_novas):
            return "??"
        return None


_raizes: dict[str, Path | None] = {}
_status: dict[str, tuple[float, _Status | None]] = {}
_trava = threading.Lock()


def _git(raiz: Path, *args: str) -> str | None:
    """Saída do `git`, ou `None` se ele falhar — briefing incompleto, nunca exceção."""
    try:
        feito = subprocess.run(
            ["git", "--literal-pathspecs", "-C", str(raiz), *args],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT_S, env=_GIT_ENV,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("briefing: git %s em %s falhou (%s)", args[0], raiz, exc)
        return None
    if feito.returncode != 0:
        logger.warning("briefing: git %s em %s saiu com %s", args[0], raiz, feito.returncode)
        return None
    return feito.stdout


def _raiz_de(pasta: str) -> Path | None:
    """A raiz do repositório que contém `pasta`, subindo até achar um `.git`."""
    with _trava:
        if pasta in _raizes:
            return _raizes[pasta]
    atual = Path(pasta)
    raiz = None
    for candidata in (atual, *atual.parents):
        if (candidata / ".git").exists():
            raiz = candidata
            break
    with _trava:
        _raizes[pasta] = raiz
    return raiz


def por_repo(arquivos: list[str]) -> dict[Path, list[str]]:
    """`raiz → caminhos relativos a ela`. Arquivo fora de repositório fica de fora."""
    grupos: dict[Path, list[str]] = {}
    for arquivo in arquivos:
        raiz = _raiz_de(os.path.dirname(arquivo))
        if raiz is None:
            continue
        relativo = os.path.relpath(arquivo, raiz)
        if relativo.startswith(".."):
            continue
        grupos.setdefault(raiz, []).append(relativo)
    return grupos


def _ler_status(raiz: Path) -> _Status | None:
    saida = _git(raiz, "status", "--porcelain=v1", "-z", "--untracked-files=normal")
    if saida is None:
        return None
    sujos: dict[str, str] = {}
    pastas: list[str] = []
    partes = iter(saida.split("\0"))
    for item in partes:
        if len(item) < 4:
            continue
        codigo, caminho = item[:2], item[3:]
        if "R" in codigo or "C" in codigo:
            next(partes, None)  # o caminho de antes do rename
        if codigo == "??" and caminho.endswith("/"):
            pastas.append(caminho)
        else:
            sujos[caminho] = codigo
    return _Status(sujos=sujos, pastas_novas=tuple(pastas))


def status_do_repo(raiz: Path, agora: float, *, ttl: float = TTL_STATUS_S) -> _Status | None:
    chave = str(raiz)
    with _trava:
        guardado = _status.get(chave)
    if guardado is not None and agora - guardado[0] < ttl:
        return guardado[1]
    lido = _ler_status(raiz)
    with _trava:
        _status[chave] = (agora, lido)
    return lido


def _mtime(caminho: Path) -> float | None:
    try:
        return caminho.stat().st_mtime
    except OSError:
        return None


def pendencia(arquivos: list[str], *, ate: float, agora: float) -> int:
    """Arquivos da conversa sem commit cuja última escrita é dela.

    `ate` é o mtime do JSONL. Arquivo apagado (sem mtime) conta: sumir também
    é mudança sem commit.
    """
    total = 0
    for raiz, relativos in por_repo(arquivos).items():
        status = status_do_repo(raiz, agora)
        if status is None:
            continue
        for relativo in relativos:
            if status.codigo(relativo) is None:
                continue
            escrito = _mtime(raiz / relativo)
            if escrito is None or escrito <= ate + FOLGA_AUTORIA_S:
                total += 1
    return total


def _quando(epoch: float, agora: float) -> str:
    horas = max(0, int((agora - epoch) // 3600))
    if horas < 1:
        ha = "há menos de 1 h"
    elif horas < 48:
        ha = f"há {horas} h"
    else:
        ha = f"há {horas // 24} dias"
    return f"{datetime.fromtimestamp(epoch, _ZONA):%d/%m %H:%M} ({ha})"


def _limitar(itens: list[str], maximo: int) -> list[str]:
    if len(itens) <= maximo:
        return itens
    return [*itens[: maximo - 1], f"- … e mais {len(itens) - maximo + 1}"]


def montar(arquivos: list[str], *, desde: float, agora: float) -> str:
    """O texto do briefing, ou `""` quando nada mudou nos arquivos da conversa."""
    commits: list[str] = []
    pendentes: list[str] = []
    for raiz, relativos in sorted(por_repo(arquivos).items()):
        nome = raiz.name
        log = _git(
            raiz, "log", f"--since=@{int(desde)}", "--format=%h%x09%ad%x09%an%x09%s",
            "--date=format-local:%d/%m %H:%M", f"-n{_COMMITS_MAX}", "--",
            *relativos[:_PATHSPECS_MAX],
        )
        for linha in (log or "").splitlines():
            partes = linha.split("\t", 3)
            if len(partes) == 4:
                sha, data, autor, assunto = partes
                commits.append(f"- {nome} {sha} {data} {autor} — {assunto[:100]}")
        status = status_do_repo(raiz, agora, ttl=0)
        if status is None:
            continue
        for relativo in relativos:
            codigo = status.codigo(relativo)
            if codigo is not None:
                pendentes.append(f"- {nome} {relativo} ({codigo.strip()})")
    if not commits and not pendentes:
        return ""

    linhas = [
        "Briefing de retorno do cockpit: esta conversa acabou de ser retomada. "
        f"A última atividade dela foi em {_quando(desde, agora)}. "
        "Do que ela mexeu, isto mudou desde então:"
    ]
    if commits:
        linhas.append("Commits que tocaram arquivos desta conversa:")
        linhas += _limitar(commits, _COMMITS_MAX)
    if pendentes:
        linhas.append(f"Arquivos desta conversa ainda sem commit ({len(pendentes)}):")
        linhas += _limitar(pendentes, _PENDENTES_MAX)
    linhas.append("Confira o estado atual desses arquivos antes de seguir do ponto onde parou.")
    return "\n".join(linhas[:LINHAS_MAX])
