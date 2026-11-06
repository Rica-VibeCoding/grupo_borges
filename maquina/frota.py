"""Sessões da VPS por panes; Codex órfão por scope de dono inequívoco.

O servidor tmux e serviços ficam protegidos. Fechar alcança apenas uma sessão
identificada pelo socket, id nativo e starttime dos processos, inclusive MCPs
que systemd-run moveu para outro scope. Só stdlib, como o restante do painel.
"""

from dataclasses import dataclass, replace
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import time

from maquinas import Falha, IDENT, Maquinas, Processo, Scope, ScopePorProcessos
from medicao_processos import contadores_cpu, memoria_mb


@dataclass(frozen=True)
class Sessao(Scope):
    socket: str
    alvo: str
    ident: str
    cadeira: bool
    servidor: Processo
    panes: tuple[Processo, ...]


@dataclass(frozen=True)
class CadeiraCodex(ScopePorProcessos):
    # Recorte do scope do agente: RAM e CPU pelos processos, nunca o cgroup.
    ident: str


class MaquinasFrota(Maquinas):
    def _contadores_cpu(self, scope):
        # Sessões atravessam/compartilham cgroups: o contador da unidade inteira
        # duplicaria CPU e atribuiria trabalho ao dono errado. /proc/<pid>/stat
        # inclui TODAS as threads (utime+stime), ao contrário de schedstat.
        # Workers que nascem e morrem entre leituras ficam em Fora da lista.
        if isinstance(scope, (Sessao, ScopePorProcessos)):
            return contadores_cpu(self.proc, scope.processos)
        # Unidade inteira (serviço, container de root): cpu.stat do cgroup é
        # legível e não perde o worker que nasce e morre entre leituras.
        return super()._contadores_cpu(scope)

    def memoria(self, scope):
        if isinstance(scope, (Sessao, ScopePorProcessos)):
            return memoria_mb(self.proc, scope.processos)
        # Unidade inteira: memory.stat é legível inclusive para root/containers.
        return super().memoria(scope)

    def __init__(self, *, agentes=(), sockets=None, executar=None, **kwargs):
        kwargs.setdefault("cgroup", Path("/sys/fs/cgroup"))
        super().__init__(agentes=agentes, **kwargs)
        self.cadastro = {a["id"]: a for a in agentes}
        self.sockets = Path(sockets) if sockets is not None else Path(f"/tmp/tmux-{os.getuid()}")
        self.executar = executar or subprocess.run
        self._containers = {}
        self._containers_em = None

    def _nomes_containers(self):
        if self._containers_em is not None and self.monotono() - self._containers_em < 60:
            return
        try:
            r = self.executar(["docker", "ps", "--no-trunc", "--format", "{{.ID}}\t{{.Names}}"],
                              capture_output=True, text=True, timeout=2)
            if r.returncode == 0:
                self._containers = dict(linha.split("\t", 1) for linha in r.stdout.splitlines())
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
        self._containers_em = self.monotono()

    def janelas(self):
        return {}

    def tela(self):
        return {"em_uso": None, "ultimo_uso_s": None}

    def _tmux(self, socket, *args):
        return self.executar(["tmux", "-S", str(socket), *args], capture_output=True,
                             text=True, timeout=2, env=self.ambiente())

    def _inventario(self):
        # Sem busca por cwd, argv de Claude ou nomes genéricos de scopes.
        # Socket configurado + sessão exata (ou cadeira __) são a prova.
        nomes = {a["socket"] for a in self.cadastro.values()} | {"default"}
        for nome in sorted(nomes):
            if not IDENT.fullmatch(nome):
                continue
            socket = self.sockets / nome
            try:
                info = socket.lstat()
                if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
                    continue
                r = self._tmux(socket, "list-panes", "-a", "-F",
                               "#{pid}\t#{session_name}\t#{session_id}\t#{pane_pid}")
                if r.returncode:
                    continue
                sessoes = {}
                for linha in r.stdout.splitlines():
                    servidor, sessao, alvo, pane = linha.split("\t")
                    if not IDENT.fullmatch(sessao) or not re.fullmatch(r"\$[0-9]+", alvo):
                        continue
                    dono = next((a for a in self.cadastro.values()
                                 if (a["socket"] == nome or nome == "default")
                                 and (sessao == a["sessao"]
                                      or sessao.startswith(a["sessao"] + "__"))), None)
                    if dono is None:
                        continue
                    chave = (int(servidor), alvo, dono["id"],
                             sessao != dono["sessao"] or bool(dono.get("cadeira_de")))
                    sessoes.setdefault(chave, set()).add(int(pane))
                for chave, panes in sessoes.items():
                    yield socket, *chave, panes
            except (OSError, ValueError, subprocess.SubprocessError):
                # Uma falha não transforma um scope em sessão fechável.
                continue

    @staticmethod
    def _infra(processo):
        nomes = {Path(a).name.lower() for a in processo.args[:4]}
        return (processo.pid == os.getpid() or bool(nomes & {
            "tmux", "tmux: server", "docker", "dockerd", "containerd", "sshd",
            "tailscaled", "cron", "systemd", "painel.py", "uvicorn", "main:app",
            "next", "next-server", "n8n",
        }) or any(n.startswith(("sshd", "containerd-shim", "next-server")) for n in nomes))

    @staticmethod
    def _codex_exec(processo):
        args = processo.args
        if args and Path(args[0]).name in {"node", "nodejs"}:
            args = args[1:]
        return (len(args) >= 2 and Path(args[0]).name in {"codex", "codex.js"}
                and args[1] in {"exec", "e"})

    def _permitido(self, processo, unidade):
        return not (self._infra(processo) or Path(unidade.nome).suffix == ".service"
                    or {"system.slice", "session.slice"} & set(Path(unidade.nome).parts)
                    or Path(unidade.nome).name.startswith("docker-"))

    def scopes(self):
        brutos = super()._scopes_unidades()
        if any(Path(s.nome).name.startswith("docker-") for s in brutos):
            self._nomes_containers()
        processos = {p.pid: p for s in brutos for p in s.processos}
        unidades = {p.pid: s for s in brutos for p in s.processos}
        filhos = {}
        for p in processos.values():
            filhos.setdefault(p.ppid, set()).add(p.pid)
        sessoes, usados = [], set()
        for socket, servidor_pid, alvo, ident, cadeira, panes_ids in self._inventario():
            servidor = processos.get(servidor_pid)
            panes = tuple(processos[pid] for pid in sorted(panes_ids) if pid in processos)
            if (servidor is None or not panes or len(panes) != len(panes_ids)
                    or not all(p.ppid == servidor.pid for p in panes)):
                continue
            # Um supervisor ativo reporia a sessão após Fechar. A unit e seus
            # processos permanecem protegidos; este painel não para supervisores.
            if Path(unidades[servidor_pid].nome).name.startswith("borges-clawd@"):
                continue
            candidatos, fila = set(), list(panes_ids)
            while fila:
                pid = fila.pop()
                if pid in candidatos:
                    continue
                p = processos[pid]
                unidade = unidades[pid]
                if not self._permitido(p, unidade):
                    continue
                candidatos.add(pid)
                fila.extend(filhos.get(pid, ()))
            if not panes_ids <= candidatos or candidatos & usados:
                continue
            principal = min(panes, key=lambda p: (p.inicio, p.pid))
            # Identidade lógica independe de run-uNNNN, que pode ser compartilhado.
            nome = f"sessao/{socket.name}/{alvo}/{servidor.inicio}"
            sessoes.append(Sessao(unidades[principal.pid].caminho, nome,
                                  tuple(processos[pid] for pid in sorted(candidatos)), principal,
                                  str(socket), alvo, ident, cadeira, servidor, panes))
            usados.update(candidatos)
        # fork herda o cgroup, mesmo quando o processo perde o pai. O scope
        # não tem "main PID" (systemd.scope) e pode abrigar várias sessões:
        # parentesco comprovado vence; cgroup só decide com UMA sessão viva.
        donos_pid = {p.pid: s for s in sessoes for p in s.processos}
        donos_unidade = {}
        for s in sessoes:
            for p in s.processos:
                donos_unidade.setdefault(unidades[p.pid].nome, {})[s.id] = s
        cadeiras, separados = [], set()
        for raiz in sorted(processos.values(), key=lambda p: (p.inicio, p.pid)):
            if not self._codex_exec(raiz) or not self._permitido(raiz, unidades[raiz.pid]):
                continue
            # O launcher Node e o binário nativo são a mesma execução.
            ancestral, vistos = raiz.ppid, {raiz.pid}
            while ancestral in processos and ancestral not in vistos:
                vistos.add(ancestral)
                if self._codex_exec(processos[ancestral]):
                    break
                ancestral = processos[ancestral].ppid
            else:
                dono = donos_pid.get(raiz.pid)
                if dono is None:
                    candidatos = donos_unidade.get(unidades[raiz.pid].nome, {})
                    if len(candidatos) != 1:
                        continue
                    dono = next(iter(candidatos.values()))
                membros, fila = set(), [raiz.pid]
                while fila:
                    pid = fila.pop()
                    if pid in membros or pid in separados:
                        continue
                    p = processos[pid]
                    if (not self._permitido(p, unidades[pid])
                            or (pid in donos_pid and donos_pid[pid].id != dono.id)
                            or any(p in s.panes for s in sessoes)):
                        continue
                    membros.add(pid)
                    fila.extend(filhos.get(pid, ()))
                if not membros:
                    continue
                nome = f"{dono.nome}/codex/{raiz.pid}"
                cadeiras.append(CadeiraCodex(unidades[raiz.pid].caminho, nome,
                    tuple(processos[pid] for pid in sorted(membros)), raiz, dono.ident))
                separados.update(membros)
        sessoes = [replace(s, processos=tuple(p for p in s.processos if p.pid not in separados))
                   for s in sessoes]
        usados.update(separados)
        protegidos = []
        for s in brutos:
            restantes = tuple(p for p in s.processos if p.pid not in usados)
            if not restantes:
                continue
            pids = {p.pid for p in restantes}
            raizes = [p for p in restantes if p.ppid not in pids] or restantes
            principal = min(raizes, key=lambda p: (p.inicio, p.pid))
            protegidos.append(ScopePorProcessos(s.caminho, s.nome, restantes, principal)
                              if len(restantes) != len(s.processos)
                              else replace(s, principal=principal))
        return protegidos + sessoes + cadeiras

    def _terminal(self, scope, scopes=None):
        return scope if isinstance(scope, (Sessao, CadeiraCodex)) else None

    def classificar(self, scope, janelas, scopes=None):
        return "terminal" if isinstance(scope, (Sessao, CadeiraCodex)) else "protegido"

    def rotulo(self, scope, janelas):
        if isinstance(scope, CadeiraCodex):
            a = self.cadastro[scope.ident]
            dono = self.agentes.get(a.get("cadeira_de", scope.ident), a["nome"])
            return dono + " · Codex", dono
        if isinstance(scope, Sessao):
            a = self.cadastro[scope.ident]
            dono = self.agentes.get(a.get("cadeira_de", scope.ident), a["nome"])
            return (dono + " · cadeira" if scope.cadeira else a["nome"]), dono
        nome = Path(scope.nome).stem
        if nome.startswith("docker-"):
            ident = nome.removeprefix("docker-")
            return "Container " + self._containers.get(ident, "Docker " + ident[:12]), None
        if nome == "ssh":
            return "Acesso SSH", None
        if any(Path(p.args[0]).name.startswith("tmux") for p in scope.processos if p.args):
            return "Servidor tmux (" + nome + ")", None
        # run-u antigo sem sessão viva: não inventa um dono a partir do cwd.
        return super().rotulo(scope, janelas)

    def fechar(self, item_id):
        with self._fechamento:
            sessao = self._achar(item_id)
            memoria = self.memoria(sessao)
            fds = []
            try:
                # Fixa TODOS antes de qualquer efeito. Não sinaliza unidade,
                # servidor tmux, supervisor nem PID que apareça depois.
                for p in sessao.processos:
                    try:
                        fd = os.pidfd_open(p.pid)
                    except ProcessLookupError:
                        continue
                    fds.append((p, fd))
                    if self.processo(p.pid) != p:
                        raise Falha(409, "A sessão mudou; atualize a lista.")
                atual = self._achar(item_id)
                if (type(atual) is not type(sessao) or atual.principal != sessao.principal
                        or atual.processos != sessao.processos
                        or (isinstance(sessao, Sessao) and
                            (atual.servidor != sessao.servidor or atual.panes != sessao.panes))):
                    raise Falha(409, "A sessão mudou; atualize a lista.")
                # O alvo $N é exato; nunca kill-server nem kill do cgroup.
                if isinstance(sessao, Sessao):
                    r = self._tmux(sessao.socket, "kill-session", "-t", sessao.alvo)
                    if r.returncode:
                        raise Falha(409, "Não foi possível fechar a sessão.")
                for _, fd in reversed(fds):
                    try:
                        signal.pidfd_send_signal(fd, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                limite = self.monotono() + 8
                while any((p := self.processo(antigo.pid)) is not None and p.inicio == antigo.inicio
                          for antigo, _ in fds):
                    if self.monotono() >= limite:
                        raise Falha(409, "A sessão não fechou em 8 segundos.")
                    time.sleep(0.1)
                return {"liberou_mb": memoria}
            except OSError:
                raise Falha(409, "Não foi possível concluir o fechamento.") from None
            finally:
                for _, fd in fds:
                    os.close(fd)
