"""Energia da frota: configuração fechada e uma única fronteira de efeitos."""

from __future__ import annotations

import asyncio
import os
import re
import shlex
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal

from pydantic import BaseModel

MAQUINAS = {
    "arsenal": {
        "nome": "Arsenal", "host": "ricardo@100.91.105.22", "sistema": "linux",
        "motivo": "falta a tomada",
    },
    "pc": {
        "nome": "PC", "host": "RicardoBorges@100.118.54.91", "sistema": "windows",
        "motivo": None,
    },
    "note": {
        "nome": "Note", "host": "ricardo@100.116.209.95", "sistema": "linux",
        "motivo": "liga só na mão",
    },
}
# A tomada mora no HA da VPS; fora dela (Arsenal) o .env aponta para um repasse por SSH.
PC_SCRIPT = os.environ.get(
    "PC_SCRIPT", "/home/clawd/repos/ze_claude/pavan/.claude/skills/pc-remoto/scripts/pc.sh"
)
CACHE_SEGUNDOS = 15
TCP_TIMEOUT = 3.0
COMANDO_TIMEOUT = 10.0
ACAO_TIMEOUT = 600.0
MAQUINAS_COM_PAINEL = {"arsenal"}
AVISO_USO = "O Rica pode estar usando esta máquina agora."
# Scopes dos agentes e, depois de uma linha "--", "id<TAB>nome" do agentes.json do painel.
TMUX = (
    "systemctl --user list-units --no-legend --plain 'cockpit-tmux-*.scope'; echo --; "
    "python3 -c 'import json,os; d=json.load(open(os.path.expanduser("
    "\"~/.local/share/cockpit-maquina/agentes.json\"))); "
    "[print(a[\"id\"], a[\"nome\"], sep=chr(9)) for a in d.get(\"agentes\", [])]' 2>/dev/null || true"
)
CHROMES_LINUX = "ps -eo comm=,args="
SESSOES_GRAFICAS = '''sessions=$(loginctl list-sessions --no-legend --no-pager) || exit 1
while read -r session rest; do
    if [ -n "$session" ]; then
        loginctl show-session "$session" -p Type --value || exit 1
    fi
done <<EOF
$sessions
EOF'''
# Conta janelas de Chrome, não processos: só o principal vem sem `--type=` (o PC tinha 44 processos e 4 Chromes).
CHROMES_WINDOWS = (
    'powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\"'
    ' | Where-Object { $_.CommandLine -notmatch \'--type=\' }).Count"'
)


class CaminhoLigar(BaseModel):
    pode: bool
    motivo: str | None


class EstadoEnergia(BaseModel):
    id: str
    nome: str
    ligado: bool
    ligar: CaminhoLigar
    em_andamento: Literal["ligando", "desligando"] | None


class Impacto(BaseModel):
    agentes: list[str]
    chromes: int
    em_uso: bool | None
    aviso: str | None


class AcaoEnergia(BaseModel):
    mensagem: str
    em_andamento: Literal["ligando", "desligando"] | None


class Mensagem(BaseModel):
    mensagem: str


class FalhaEnergia(Exception):
    def __init__(self, mensagem: str, status: int = 502):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status


@dataclass(frozen=True)
class Execucao:
    tipo: Literal["tcp", "comando"]
    argumentos: tuple[str, ...]
    timeout_s: float


@dataclass(frozen=True)
class Resultado:
    codigo: int = 0
    stdout: str = ""
    stderr: str = ""


async def executar(pedido: Execucao) -> Resultado:
    """Único ponto com socket/subprocesso; testes substituem esta função inteira."""
    if pedido.tipo == "tcp":
        try:
            async with asyncio.timeout(pedido.timeout_s):
                _, escritor = await asyncio.open_connection(
                    pedido.argumentos[0], int(pedido.argumentos[1])
                )
                escritor.close()
                await escritor.wait_closed()
            return Resultado()
        except (OSError, TimeoutError):
            return Resultado(codigo=1)

    processo = await asyncio.create_subprocess_exec(
        *pedido.argumentos,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(processo.communicate(), pedido.timeout_s)
    finally:
        if processo.returncode is None:
            processo.kill()
            await processo.wait()
    return Resultado(
        codigo=processo.returncode,
        stdout=stdout.decode(errors="replace"),
        stderr=stderr.decode(errors="replace"),
    )


def comando_ssh(maquina: str, comando: str) -> tuple[str, ...]:
    return (
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3",
        "-o", "StrictHostKeyChecking=yes", MAQUINAS[maquina]["host"], comando,
    )


def comando_pc(acao: Literal["ligar", "desligar"]) -> tuple[str, ...]:
    # Type=exec faz o systemd confirmar o exec; o script tem seu próprio tempo.
    return (
        "systemd-run", "--user", "--collect", "--property=Type=exec",
        "--property=RuntimeMaxSec=600s", PC_SCRIPT, acao,
    )


def contar_chromes(saida: str) -> int:
    """Um Chrome por perfil ze-chrome*, mais o pessoal; ignora renderers."""
    perfis = set()
    pessoal = False
    for linha in saida.splitlines():
        try:
            campos = shlex.split(linha)
        except ValueError:
            continue
        if len(campos) < 2 or campos[0] not in {
            "chrome", "chromium", "chromium-browse", "google-chrome",
        }:
            continue
        argumentos = campos[2:]
        if any(arg.startswith("--type=") or arg == "--type" for arg in argumentos):
            continue
        perfil = None
        for indice, argumento in enumerate(argumentos):
            if argumento.startswith("--user-data-dir="):
                perfil = argumento.split("=", 1)[1]
            elif argumento == "--user-data-dir" and indice + 1 < len(argumentos):
                perfil = argumentos[indice + 1]
        if perfil is None or PurePosixPath(perfil).name in {"google-chrome", "chromium"}:
            pessoal = True
        elif PurePosixPath(perfil).name.startswith("ze-chrome"):
            perfis.add(perfil.rstrip("/"))
    return len(perfis) + int(pessoal)


class ServicoEnergia:
    def __init__(
        self,
        *,
        executor: Callable[[Execucao], Awaitable[Resultado]] = executar,
        relogio: Callable[[], float] = time.monotonic,
        ler_abertos: Callable[[str], Awaitable] | None = None,
    ):
        self._executor = executor
        self._relogio = relogio
        self._ler_abertos = ler_abertos
        self._cache: dict[str, tuple[float, bool]] = {}
        self._andamento: dict[str, tuple[float, Literal["ligando", "desligando"]]] = {}
        self._travas: dict[str, asyncio.Lock] = {}

    async def _chromes_da_lista(self, maquina: str) -> int | None:
        """Conta pela MESMA lista que a aba mostra: a confirmação não pode dizer outro número."""
        ler = self._ler_abertos
        if ler is None:
            from services.maquinas import ServicoMaquinas
            ler = ServicoMaquinas().abertos
        try:
            lista = await ler(maquina)
        except Exception:
            return None  # painel fora: cai na contagem por processo
        return sum(i.grupo == "agente" or i.rotulo == "Chrome pessoal" for i in lista.itens)

    def _configuracao(self, maquina: str) -> dict:
        if maquina not in MAQUINAS:
            raise FalhaEnergia("máquina desconhecida", 404)
        return MAQUINAS[maquina]

    async def _ligado(self, maquina: str) -> bool:
        config = self._configuracao(maquina)
        cache = self._cache.get(maquina)
        if cache and self._relogio() < cache[0]:
            return cache[1]
        pedido = Execucao("tcp", (config["host"].split("@", 1)[1], "22"), TCP_TIMEOUT)
        try:
            resultado = await self._executor(pedido)
            ligado = resultado.codigo == 0
        except (OSError, TimeoutError):
            ligado = False
        self._cache[maquina] = (self._relogio() + CACHE_SEGUNDOS, ligado)
        return ligado

    def _em_andamento(self, maquina: str, ligado: bool) -> Literal["ligando", "desligando"] | None:
        andamento = self._andamento.get(maquina)
        if andamento:
            expira, acao = andamento
            if self._relogio() < expira and ligado != (acao == "ligando"):
                return acao
            del self._andamento[maquina]
        return None

    async def _estado(self, maquina: str) -> EstadoEnergia:
        async with self._travas.setdefault(maquina, asyncio.Lock()):
            config = self._configuracao(maquina)
            ligado = await self._ligado(maquina)
            return EstadoEnergia(
                id=maquina, nome=config["nome"], ligado=ligado,
                ligar=CaminhoLigar(pode=config["motivo"] is None, motivo=config["motivo"]),
                em_andamento=self._em_andamento(maquina, ligado),
            )

    async def listar(self) -> list[EstadoEnergia]:
        return list(await asyncio.gather(*(self._estado(id) for id in MAQUINAS)))

    async def _comando(self, argumentos: tuple[str, ...]) -> Resultado:
        try:
            return await self._executor(Execucao("comando", argumentos, COMANDO_TIMEOUT))
        except TimeoutError as erro:
            raise FalhaEnergia("a máquina não respondeu a tempo") from erro
        except OSError as erro:
            raise FalhaEnergia("não foi possível executar o comando de energia") from erro

    def _conferir(self, resultado: Resultado, *, ssh: bool = True) -> Resultado:
        if resultado.codigo == 0:
            return resultado
        erro = resultado.stderr.lower()
        if "permission denied" in erro:
            motivo = "o acesso por SSH foi recusado; confira a chave e a permissão"
        elif "host key" in erro:
            motivo = "a identidade SSH da máquina precisa ser conferida"
        elif "timed out" in erro:
            motivo = "a máquina não respondeu a tempo"
        elif "connection refused" in erro or "no route to host" in erro:
            motivo = "não foi possível conectar à máquina por SSH"
        elif "sudo:" in erro:
            motivo = "falta permissão para desligar esta máquina sem senha"
        else:
            motivo = "não foi possível consultar ou comandar a máquina por SSH" if ssh else (
                "não foi possível iniciar o controle da tomada do PC"
            )
        raise FalhaEnergia(motivo)

    async def impacto(self, maquina: str) -> Impacto:
        config = self._configuracao(maquina)
        agentes = []
        if config["sistema"] == "windows":
            usuarios = await self._comando(comando_ssh(maquina, "query user"))
            # query user sai com 1 mesmo listando quem está logado (medido no PC em 05/11);
            # só o 255 é falha do SSH.
            if usuarios.codigo not in (0, 1):
                self._conferir(usuarios)
            em_uso = any(
                linha.strip() and not linha.lstrip().upper().startswith("USERNAME")
                for linha in usuarios.stdout.splitlines()
            )
            processos = self._conferir(await self._comando(comando_ssh(maquina, CHROMES_WINDOWS)))
            texto = processos.stdout.strip()
            chromes = int(texto) if texto.isdigit() else 0
        else:
            if maquina == "arsenal":
                sessoes = self._conferir(await self._comando(comando_ssh(maquina, TMUX)))
                # Cada agente do cockpit roda num scope cockpit-tmux-<agente>-<id>.scope.
                scopes, _, tabela = sessoes.stdout.partition("\n--\n")
                nomes = dict(
                    linha.split("\t", 1) for linha in tabela.splitlines() if "\t" in linha
                )
                ids = sorted({
                    m[1] for linha in scopes.splitlines()
                    if (m := re.match(r"cockpit-tmux-(.+)-[0-9a-f]+\.scope", linha.split()[0] if linha.split() else ""))
                })
                agentes = [nomes.get(i, i.replace("-", " ").title()) for i in ids]
            chromes = await self._chromes_da_lista(maquina) if maquina in MAQUINAS_COM_PAINEL else None
            if chromes is None:
                processos = self._conferir(await self._comando(comando_ssh(maquina, CHROMES_LINUX)))
                chromes = contar_chromes(processos.stdout)
            sessoes = self._conferir(await self._comando(comando_ssh(maquina, SESSOES_GRAFICAS)))
            em_uso = any(tipo.strip() in {"x11", "wayland"} for tipo in sessoes.stdout.splitlines())
        return Impacto(
            agentes=agentes, chromes=chromes, em_uso=em_uso,
            aviso=AVISO_USO if maquina == "arsenal" or (maquina == "pc" and em_uso) else None,
        )

    async def acionar(self, maquina: str, acao: Literal["ligar", "desligar"]) -> tuple[int, AcaoEnergia]:
        config = self._configuracao(maquina)
        async with self._travas.setdefault(maquina, asyncio.Lock()):
            ligado = await self._ligado(maquina)
            andamento = self._em_andamento(maquina, ligado)
            if acao == "ligar" and ligado:
                return 200, AcaoEnergia(mensagem="já está ligada", em_andamento=andamento)
            if acao == "desligar" and not ligado:
                raise FalhaEnergia("já está desligada", 409)
            if acao == "ligar" and config["motivo"]:
                raise FalhaEnergia(config["motivo"], 409)
            destino = "ligando" if acao == "ligar" else "desligando"
            if andamento:
                if andamento != destino:
                    pendente = "ligar" if andamento == "ligando" else "desligar"
                    raise FalhaEnergia(f"aguarde a máquina terminar de {pendente}", 409)
                return 202, AcaoEnergia(mensagem=f"a máquina está {destino}", em_andamento=destino)
            comando = (
                comando_pc(acao) if maquina == "pc"
                else comando_ssh(maquina, "sudo -n systemctl poweroff")
            )
            self._conferir(await self._comando(comando), ssh=maquina != "pc")
            self._andamento[maquina] = (self._relogio() + ACAO_TIMEOUT, destino)
            # A próxima leitura acompanha a realidade, sem esperar o cache anterior.
            self._cache.pop(maquina, None)
            return 202, AcaoEnergia(mensagem=f"pedido de {acao} enviado", em_andamento=destino)


servico = ServicoEnergia()
