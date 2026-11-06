"""Recursos e scopes do usuário. Só stdlib; nenhuma ação aceita PID do cliente."""

import base64
from dataclasses import dataclass
import hashlib
import hmac
import http.client
import json
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import socket
import stat
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit

from chrome_processos import agrupar_chromes
from medicao_processos import contadores_cpu, memoria_mb, soma_medidas


IDENT = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
PROTEGIDOS = {
    "claude", "bun", "sshd", "sshd-session", "tailscaled", "hyprland",
    "start-hyprland", "hypridle", "hyprlock", "hyprsunset", "xwayland",
    "waybar", "quickshell", "qs", "pipewire", "pipewire-pulse", "wireplumber",
    "systemd", "uwsm", "gnome-shell", "painel.py",
}
NOMES_PERFIL = {
    "agente": "Agente", "campanha": "Campanha", "fluytcom": "Fluyt Com",
    "fluytpos": "Fluyt Pós", "fluytfin": "Fluyt Fin",
}


class Falha(Exception):
    def __init__(self, status, mensagem):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem


@dataclass(frozen=True)
class Processo:
    pid: int
    ppid: int
    inicio: int
    args: tuple[str, ...]


@dataclass(frozen=True)
class Scope:
    caminho: Path
    nome: str
    processos: tuple[Processo, ...]
    principal: Processo

    @property
    def id(self):
        bruto = f"{self.nome}\0{self.principal.inicio}".encode()
        return base64.urlsafe_b64encode(hashlib.sha256(bruto).digest()[:12]).decode()


class ScopePorProcessos(Scope):
    """Uma parte da unidade: seus contadores de cgroup não pertencem ao item."""


@dataclass
class Observacao:
    cpus: dict
    amostrado: float
    desde: float
    confirmado: bool = False
    cpu_pct: float | None = None


def opcao(args, nome):
    for i, arg in enumerate(args):
        if arg.startswith(nome + "="):
            return arg[len(nome) + 1:]
        if arg == nome and i + 1 < len(args):
            return args[i + 1]
    return None


def json_cdp(porta, caminho):
    # Não usa proxy nem segue redirecionamento; CDP só na interface local.
    conexao = http.client.HTTPConnection("127.0.0.1", porta, timeout=0.5)
    try:
        conexao.request("GET", caminho)
        resposta = conexao.getresponse()
        corpo = resposta.read(1024 * 1024 + 1)
        if resposta.status != 200 or len(corpo) > 1024 * 1024:
            raise ValueError("CDP indisponível")
        return json.loads(corpo)
    finally:
        conexao.close()


def fechar_browser(url, porta):
    """Handshake RFC 6455 e um frame de texto mascarado: Browser.close."""
    alvo = urlsplit(url)
    if (alvo.scheme != "ws" or alvo.hostname not in {"127.0.0.1", "localhost", "::1"}
            or alvo.port != porta or alvo.username or alvo.password
            or not alvo.path.startswith("/devtools/browser/") or alvo.query or alvo.fragment):
        raise ValueError("Endereço CDP inválido")
    chave = base64.b64encode(os.urandom(16)).decode()
    with socket.create_connection(("127.0.0.1", porta), timeout=0.5) as ws:
        pedido = (f"GET {alvo.path} HTTP/1.1\r\nHost: 127.0.0.1:{porta}\r\n"
                  f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {chave}\r\n"
                  "Sec-WebSocket-Version: 13\r\n\r\n")
        ws.sendall(pedido.encode("ascii"))
        cabecalho = bytearray()
        limite = time.monotonic() + 1
        while not cabecalho.endswith(b"\r\n\r\n"):
            if len(cabecalho) >= 8192 or time.monotonic() >= limite:
                raise ValueError("Handshake CDP inválido")
            byte = ws.recv(1)
            if not byte:
                raise ValueError("CDP encerrou o handshake")
            cabecalho.extend(byte)
        linhas = cabecalho.decode("ascii").split("\r\n")
        headers = {}
        for linha in linhas[1:]:
            if linha:
                k, v = linha.split(":", 1)
                headers[k.lower()] = v.strip()
        aceito = base64.b64encode(hashlib.sha1(
            (chave + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        if (linhas[0].split()[:2] != ["HTTP/1.1", "101"]
                or headers.get("upgrade", "").lower() != "websocket"
                or "upgrade" not in headers.get("connection", "").lower().split(", ")
                or headers.get("sec-websocket-accept") != aceito):
            raise ValueError("Handshake CDP recusado")
        corpo = b'{"id":1,"method":"Browser.close"}'
        mascara = os.urandom(4)
        ws.sendall(bytes([0x81, 0x80 | len(corpo)]) + mascara
                   + bytes(v ^ mascara[i % 4] for i, v in enumerate(corpo)))


class Maquinas:
    def __init__(self, *, agentes=(), home=None, proc=Path("/proc"), cgroup=None,
                 runtime=None, chave=None,
                 relogio=time.time, monotono=time.monotonic):
        self.home = Path.home() if home is None else Path(home)
        self.proc = Path(proc)
        self.cgroup = Path(cgroup) if cgroup is not None else Path(
            f"/sys/fs/cgroup/user.slice/user-{os.getuid()}.slice/user@{os.getuid()}.service")
        self.runtime = Path(runtime) if runtime is not None else Path(f"/run/user/{os.getuid()}")
        self.chave = Path(chave) if chave is not None else self.home / ".config/cockpit-maquina/chave"
        self.agentes = {a["id"]: a["nome"] for a in agentes}
        self.relogio, self.monotono = relogio, monotono
        self.observado_desde = int(relogio())
        self._ultima_amostra = None
        self._cpu_anterior = None
        self._cpu_total = None
        self._observacoes = {}
        self._trava = threading.RLock()
        self._fechamento = threading.Lock()
        self._arquivo_observacoes = self.home / ".cache/cockpit-maquina/observacoes.json"
        self._restaurar_observacoes()

    def _restaurar_observacoes(self):
        try:
            dados = json.loads(self._arquivo_observacoes.read_text(encoding="utf-8"))
            # O cache antigo media apenas a thread principal em nanossegundos.
            if not isinstance(dados, dict) or dados.get("versao") != 2:
                return
            if not isinstance(dados, dict) or type(dados["observado_desde"]) is not int:
                raise ValueError("observações inválidas")
            if not isinstance(dados["observacoes"], dict):
                raise ValueError("observações inválidas")
            parede, mono = self.relogio(), self.monotono()

            def tempo(valor):
                if type(valor) not in (int, float) or not math.isfinite(valor):
                    raise ValueError("timestamp inválido")
                return mono - (parede - valor)

            observacoes = {}
            for item_id, obs in dados["observacoes"].items():
                if (not isinstance(obs, dict) or not isinstance(obs["cpus"], dict)
                        or type(obs["confirmado"]) is not bool):
                    raise ValueError("observação inválida")
                cpus = {}
                for chave, cpu in obs["cpus"].items():
                    if not isinstance(chave, str) or type(cpu) is not int or cpu < 0:
                        raise ValueError("CPU inválida")
                    cpus[chave] = cpu
                cpu_pct = obs.get("cpu_pct")
                if cpu_pct is not None and (type(cpu_pct) not in (int, float)
                                           or not math.isfinite(cpu_pct) or cpu_pct < 0):
                    raise ValueError("CPU inválida")
                observacoes[item_id] = Observacao(
                    cpus, tempo(obs["amostrado"]), tempo(obs["desde"]), obs["confirmado"], cpu_pct)
        except (OSError, ValueError, TypeError, KeyError, OverflowError):
            return
        self._observacoes = observacoes
        self.observado_desde = dados["observado_desde"]

    def _salvar_observacoes(self):
        # Só o relógio de parede é transportável entre reinícios da máquina.
        deslocamento = self.relogio() - self.monotono()
        dados = {"versao": 2, "observado_desde": self.observado_desde, "observacoes": {
            item_id: {"cpus": obs.cpus,
                      "amostrado": obs.amostrado + deslocamento,
                      "desde": obs.desde + deslocamento, "confirmado": obs.confirmado,
                      "cpu_pct": obs.cpu_pct}
            for item_id, obs in self._observacoes.items()}}
        temporario = None
        try:
            self._arquivo_observacoes.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False,
                                             dir=self._arquivo_observacoes.parent) as arquivo:
                temporario = Path(arquivo.name)
                os.fchmod(arquivo.fileno(), 0o600)
                json.dump(dados, arquivo)
            os.replace(temporario, self._arquivo_observacoes)
        except OSError:
            pass  # Cache indisponível não interrompe a amostragem em memória.
        finally:
            if temporario is not None:
                try:
                    temporario.unlink(missing_ok=True)
                except OSError:
                    pass

    def autorizar(self, autorizacoes):
        try:
            fd = os.open(self.chave, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as arquivo:
                info = os.fstat(arquivo.fileno())
                if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
                        or info.st_uid != os.getuid()):
                    raise ValueError("permissão da chave")
                chave = arquivo.read(4097).strip()
                if not chave or len(chave) > 4096:
                    raise ValueError("chave vazia ou muito grande")
        except (OSError, ValueError):
            raise Falha(503, "Chave do painel indisponível (exige arquivo 0600).") from None
        recebido = autorizacoes[0].encode("utf-8") if len(autorizacoes) == 1 else b""
        if not hmac.compare_digest(recebido, b"Bearer " + chave):
            raise Falha(401, "Chave inválida ou ausente.")

    def processo(self, pid):
        try:
            pasta = self.proc / str(pid)
            campos = (pasta / "stat").read_text().rsplit(")", 1)[1].split()
            if campos[0] in {"Z", "X"}:
                return None
            args = tuple(v for v in (pasta / "cmdline").read_text().split("\0") if v)
            # Chrome no Arsenal reescreve argv como um único argumento com espaços.
            if len(args) == 1 and " " in args[0]:
                args = tuple(shlex.split(args[0]))
            return Processo(int(pid), int(campos[1]), int(campos[19]), args)
        except (OSError, ValueError, IndexError):
            return None

    def scopes(self):
        return agrupar_chromes(self, self._scopes_unidades())

    def _scopes_unidades(self):
        # Um item por unidade; sub-cgroups sem unidade pertencem à unidade mais próxima.
        unidades = {}
        for arquivo in sorted(self.cgroup.rglob("cgroup.procs")):
            unidade = arquivo.parent
            while unidade != self.cgroup and unidade.suffix not in {".scope", ".service"}:
                unidade = unidade.parent
            if unidade == self.cgroup:
                continue
            try:
                unidades.setdefault(unidade, set()).update(int(v) for v in arquivo.read_text().split())
            except (OSError, ValueError):
                continue
        resultado = []
        for caminho, pids in unidades.items():
            processos = tuple(p for pid in sorted(pids) if (p := self.processo(pid)) is not None)
            if not processos:
                continue
            raizes = [p for p in processos if p.ppid not in pids] or list(processos)
            principal = min(raizes, key=lambda p: (p.inicio, p.pid))
            resultado.append(Scope(caminho, str(caminho.relative_to(self.cgroup)), processos, principal))
        return resultado

    def ambiente(self):
        return {**os.environ, "XDG_RUNTIME_DIR": str(self.runtime)}

    def janelas(self):
        for pasta in sorted((self.runtime / "hypr").glob("*"), reverse=True):
            if not pasta.is_dir():
                continue
            try:
                r = subprocess.run(["hyprctl", "clients", "-j"], capture_output=True, text=True,
                                   timeout=1, env={**self.ambiente(), "HYPRLAND_INSTANCE_SIGNATURE": pasta.name})
                janelas = json.loads(r.stdout) if r.returncode == 0 else None
                if isinstance(janelas, list):
                    return {j["pid"]: j for j in janelas if isinstance(j, dict)
                            and isinstance(j.get("pid"), int)}
            except (OSError, ValueError, subprocess.SubprocessError):
                continue
        # Sem compositor não há prova para autorizar um app como "seus".
        return {}

    @staticmethod
    def chrome(processo):
        args = processo.args
        return (bool(args) and Path(args[0]).name in {"chrome", "google-chrome", "chromium", "chromium-browser"}
                and opcao(args, "--type") is None)

    def perfil(self, processo):
        if not self.chrome(processo):
            return None
        args = processo.args
        valor = opcao(args, "--user-data-dir")
        if not valor:
            return None
        pasta = Path(valor.replace("~/", str(self.home) + "/", 1))
        if pasta.parent != self.home / ".config" or not pasta.name.startswith("ze-chrome"):
            return None
        return pasta.name.removeprefix("ze-chrome").lstrip("-") or "agente"

    def _terminal(self, scope, scopes=None):
        def servidor(s):
            return re.fullmatch(r"cockpit-tmux-(.+)-[^-]+\.scope", Path(s.nome).name)

        if servidor(scope):
            return scope
        if re.fullmatch(r"tmux-spawn-.+\.scope", Path(scope.nome).name):
            for candidato in self.scopes() if scopes is None else scopes:
                if servidor(candidato) and any(
                        p.pid == scope.principal.ppid for p in candidato.processos):
                    return candidato
            return scope  # Spawn órfão também é um terminal fechável.
        return None

    def classificar(self, scope, janelas, scopes=None):
        if self._terminal(scope, scopes) is not None:
            return "terminal"
        # Proteção prevalece sobre perfil de Chrome e janela, em toda a unidade.
        protegido = (any(p.startswith("cockpit-") for p in Path(scope.nome).parts)
                     or "session.slice" in Path(scope.nome).parts or scope.nome == "init.scope")
        for p in scope.processos:
            nomes = {Path(a).name.lower() for a in p.args[:2]}
            if (p.pid == os.getpid() or nomes & PROTEGIDOS or any(n.startswith("sshd") for n in nomes)
                    or any("/omarchy/shell" in a or "omarchy-launch-shell" in a for a in p.args[:3])):
                protegido = True
        if protegido:
            return "protegido"
        if self.perfil(scope.principal) is not None:
            return "agente"
        if "app.slice" in Path(scope.nome).parts and any(p.pid in janelas for p in scope.processos):
            return "seus"
        return "protegido"

    def rotulo(self, scope, janelas):
        for parte in Path(scope.nome).parts:
            agente = re.fullmatch(r"cockpit-tmux-(.+)-[^-]+\.scope", parte)
            if agente:
                ident = agente[1]
                dono = self.agentes.get(ident, ident.replace("-", " ").replace("_", " ").title())
                return dono, dono
        unidade = Path(scope.nome).stem
        religa = re.fullmatch(r"cockpit-reconnect-(.+)-[0-9a-f]+", unidade)
        if religa:
            dono = self.agentes.get(religa[1], religa[1].replace("-", " ").title())
            return "Religando " + dono, dono
        servico = unidade.split("@", 1)[0]
        conhecidos = {
            "cockpit-maquina": "Painel desta máquina", "cockpit-api": "API do cockpit local",
            "cockpit-v2": "Cockpit local", "cockpit-maquina-idle": "Vigia de teclado e mouse",
            "tailscaled": "Tailscale", "sshd": "Acesso SSH",
            "pipewire": "Som (PipeWire)", "pipewire-pulse": "Som (PulseAudio)",
            "wireplumber": "Som (WirePlumber)", "gnome-keyring-daemon": "Chaveiro de senhas",
            "init": "Sistema", "systemd": "Sistema", "dbus": "Sistema",
            "ze_claude": "Pasta da VPS (sshfs)",
        }
        if servico.startswith("tmux-spawn-"):
            return "Terminal", None
        if servico in conhecidos:
            return conhecidos[servico], None
        if servico.startswith(("systemd-", "dbus-")):
            return "Sistema", None
        for prefixo, nome in (
            ("xdg-desktop-portal", "portais"), ("xdg-document-portal", "documentos"),
            ("xdg-permission-store", "permissões"), ("gvfs", "arquivos"),
            ("at-spi", "acessibilidade"),
        ):
            if servico.startswith(prefixo):
                return f"Serviços da sessão ({nome})", None
        perfil = self.perfil(scope.principal)
        if perfil is not None:
            nome = NOMES_PERFIL.get(perfil, self.agentes.get(perfil, perfil.replace("-", " ").title()))
            return "Chrome do " + nome, self.agentes.get(perfil, nome)
        janela = next((janelas[p.pid] for p in scope.processos if p.pid in janelas), {})
        classe = str(janela.get("class", "")).lower()
        exe = Path(scope.principal.args[0]).name if scope.principal.args else scope.caminho.stem
        nome = {"google-chrome": "Chrome pessoal", "chrome": "Chrome pessoal", "foot": "Terminal",
                "code": "VS Code", "code-oss": "VS Code", "soffice.bin": "LibreOffice",
                "libreoffice": "LibreOffice"}.get(classe) or {
                    "chrome": "Chrome pessoal", "foot": "Terminal", "code": "VS Code",
                    "soffice.bin": "LibreOffice"}.get(exe)
        if not nome:
            unidade = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m[1], 16)), unidade)
            nome = re.sub(r"[-_@]+", " ", unidade).capitalize()
        return nome, None

    @staticmethod
    def porta(scope):
        try:
            porta = int(opcao(scope.principal.args, "--remote-debugging-port") or 0)
            return porta if 0 < porta < 65536 else None
        except ValueError:
            return None

    @staticmethod
    def _estatisticas(arquivo):
        return {k: int(v) for k, v in (linha.split() for linha in arquivo.read_text().splitlines())}

    def memoria(self, scope):
        if isinstance(scope, ScopePorProcessos):
            return memoria_mb(self.proc, scope.processos)
        # RAM residente: não mistura swap ou todo o cache de memory.current
        # com o total MemTotal - MemAvailable. Kernel/cache ficam no residual.
        try:
            mem = self._estatisticas(scope.caminho / "memory.stat")
            uso = mem["anon"] + mem["shmem"]
            for filha in self._unidades_filhas(scope):
                mem = self._estatisticas(filha / "memory.stat")
                uso -= mem["anon"] + mem["shmem"]
            return round(max(0, uso) / 2**20, 2)
        except (OSError, ValueError, KeyError):
            return None

    @staticmethod
    def _unidades_filhas(scope):
        # Sub-cgroups comuns pertencem ao item; outra unidade tem linha própria.
        for arquivo in scope.caminho.rglob("cgroup.procs"):
            filha = arquivo.parent
            if filha == scope.caminho or filha.suffix not in {".scope", ".service"}:
                continue
            if not any(p.suffix in {".scope", ".service"}
                       for p in filha.relative_to(scope.caminho).parents if p != Path(".")):
                yield filha

    def _contadores_cpu(self, scope):
        if isinstance(scope, ScopePorProcessos):
            return contadores_cpu(self.proc, scope.processos)
        # Inode + boot distinguem uma unidade recriada e um reboot. O contador
        # sobrevive à saída de workers e inclui threads e cgroups descendentes.
        try:
            boot = (self.proc / "sys/kernel/random/boot_id").read_text().strip()
            contadores = {}
            for caminho in (scope.caminho, *self._unidades_filhas(scope)):
                inode = caminho.stat().st_ino
                uso = self._estatisticas(caminho / "cpu.stat")["usage_usec"]
                sinal = "-" if caminho != scope.caminho else "+"
                contadores[f"{sinal}cgroup:{boot}:{caminho}:{inode}"] = uso
            return contadores
        except (OSError, ValueError, KeyError):
            return {}

    def cpu_total(self):
        with self._trava:
            return self._cpu_total

    @staticmethod
    def _delta_cpu(cpus, anterior):
        if (anterior is None or cpus.keys() != anterior.cpus.keys()
                or any(cpu < anterior.cpus[k] for k, cpu in cpus.items())):
            return None
        return max(0, sum((cpu - anterior.cpus[k]) * (-1 if k.startswith("-") else 1)
                          for k, cpu in cpus.items()))

    def amostrar(self):
        """A cada 3 s; sem PSS, CDP ou consulta de estado dos agentes."""
        with self._trava:
            agora = self.monotono()
            if self._ultima_amostra is not None and agora - self._ultima_amostra < 3:
                return
            valores = [int(v) for v in (self.proc / "stat").read_text().splitlines()[0].split()[1:]]
            atual = valores[3] + valores[4], sum(valores[:8])  # guest já está em user/nice.
            self._cpu_total = None
            if self._cpu_anterior and atual[1] > self._cpu_anterior[1]:
                idle = atual[0] - self._cpu_anterior[0]
                self._cpu_total = round(max(0, min(100, 100 * (1 - idle / (atual[1] - self._cpu_anterior[1])))), 1)
            self._cpu_anterior = atual
            novas = {}
            for scope in self.scopes():
                cpus = self._contadores_cpu(scope)
                anterior = self._observacoes.get(scope.id)
                if not cpus:
                    continue
                delta = self._delta_cpu(cpus, anterior)
                if delta is None:
                    novas[scope.id] = Observacao(cpus, agora, agora)
                    continue
                intervalo = agora - anterior.amostrado
                # 0,1 s / 10 s = 1% de um core, escalado ao intervalo real.
                dormindo = intervalo > 0 and delta < intervalo * 10_000
                cpu_pct = (round(delta / (intervalo * 1e6 * (os.cpu_count() or 1)) * 100, 1)
                           if intervalo > 0 else None)
                novas[scope.id] = Observacao(
                    cpus, agora, anterior.desde if dormindo else agora, dormindo, cpu_pct)
            self._observacoes = novas
            self._ultima_amostra = agora
            self._salvar_observacoes()

    def parado(self, item_id):
        with self._trava:
            obs = self._observacoes.get(item_id)
            if obs is None or obs.cpu_pct is None:
                return None
            # Delta válido e ociosidade não confirmada significam atividade.
            if not obs.confirmado:
                return 0
            # Não extrapola tempo que o painel ainda não amostrou.
            return max(0, int(obs.amostrado - obs.desde))

    def cpu(self, item_id):
        with self._trava:
            obs = self._observacoes.get(item_id)
            return obs.cpu_pct if obs is not None else None

    def abertos(self):
        janelas = self.janelas()
        itens = []
        scopes = self.scopes()
        with self._trava:
            cpu_total = self._cpu_total
            cpu_scopes = {s.id: self.cpu(s.id) for s in scopes}
            parados_scopes = {s.id: self.parado(s.id) for s in scopes}
        terminais = {}
        for scope in scopes:
            terminal = self._terminal(scope, scopes)
            if terminal is not None:
                terminais.setdefault(terminal.id, (terminal, []))[1].append(scope)
                continue
            grupo = self.classificar(scope, janelas, scopes)
            rotulo, dono = self.rotulo(scope, janelas)
            abas = []
            porta = self.porta(scope)
            if porta and self.chrome(scope.principal):
                try:
                    targets = json_cdp(porta, "/json/list")
                    if isinstance(targets, list):
                        abas = [str(t.get("title", ""))[:40] for t in targets
                                if isinstance(t, dict) and t.get("type") == "page"]
                except (OSError, ValueError, http.client.HTTPException):
                    pass
            itens.append({"id": scope.id, "grupo": grupo, "rotulo": rotulo, "dono": dono,
                          "memoria_mb": self.memoria(scope), "cpu_pct": cpu_scopes[scope.id],
                          "parado_s": parados_scopes[scope.id],
                          "abas": abas, "pede_confirmacao": False,
                          "acao_rotulo": None if grupo == "protegido" else "Fechar " + rotulo})
        for terminal, membros in terminais.values():
            rotulo, dono = self.rotulo(terminal, janelas)
            spawns = sorted((s for s in membros if s.id != terminal.id),
                            key=lambda s: (s.principal.inicio, s.principal.pid))
            # Só a sessão mais antiga fica junto do servidor; as demais são cadeiras.
            grupos = [(terminal, [terminal] + spawns[:1], False)]
            grupos.extend((s, [s], True) for s in spawns[1:])
            for alvo, scopes_item, cadeira in grupos:
                parados = [parados_scopes[s.id] for s in scopes_item]
                cpus = [cpu_scopes[s.id] for s in scopes_item]
                # Um membro ativo basta, mesmo com outro ainda sem duas amostras.
                parado = 0 if 0 in parados else None if None in parados else min(parados)
                itens.append({"id": alvo.id, "grupo": "terminal",
                              "rotulo": rotulo + " · cadeira" if cadeira else rotulo, "dono": dono,
                              "memoria_mb": soma_medidas(self.memoria(s) for s in scopes_item),
                              "cpu_pct": round(sum(cpus), 1) if None not in cpus else None,
                              "parado_s": parado,
                              "abas": [], "pede_confirmacao": False,
                              "acao_rotulo": "Fechar cadeira" if cadeira else "Fechar " + rotulo})
        return self.contabilizar({"observado_desde": self.observado_desde, "itens": itens}, cpu_total)

    def contabilizar(self, leitura, cpu_total):
        """Completa a mesma lista que o cliente renderiza, inclusive fora de user@."""
        mem = self._estatisticas_memoria()
        ram = round((mem["MemTotal"] - mem["MemAvailable"]) / 1024, 2)
        itens = leitura["itens"]
        cpu_listada = sum(i["cpu_pct"] or 0 for i in itens)
        ram_listada = soma_medidas(i["memoria_mb"] for i in itens)
        # Não esconde diferenças negativas: expõe desvio em vez de alterar itens
        # ou inventar um residual zero (contadores não são leituras atômicas).
        itens.append({"id": "fora-da-lista", "grupo": "protegido", "rotulo": "Fora da lista",
                      "dono": None, "cpu_pct": None if cpu_total is None else round(cpu_total - cpu_listada, 1),
                      "memoria_mb": None if ram_listada is None else round(ram - ram_listada, 2), "parado_s": None,
                      "abas": [], "pede_confirmacao": False, "acao_rotulo": None})
        return {**leitura, "cpu_pct": cpu_total, "memoria_mb": ram,
                "memoria_metrica": "anon+shmem", "medido_em": int(self.relogio())}

    def _estatisticas_memoria(self):
        return {nome: int(valor.split()[0]) for nome, valor in
                (linha.split(":", 1) for linha in (self.proc / "meminfo").read_text().splitlines())}

    def tela(self):
        try:
            r = subprocess.run(["systemctl", "--user", "is-active", "cockpit-maquina-idle.service"],
                               capture_output=True, text=True, timeout=1, env=self.ambiente())
            if r.returncode != 0 or r.stdout.strip() != "active":
                return {"em_uso": None, "ultimo_uso_s": None}
            arquivo = self.home / ".cache/cockpit-maquina/ocioso"
            try:
                ts = float(arquivo.read_text())
                if not math.isfinite(ts) or ts > self.relogio():
                    raise ValueError("timestamp inválido")
            except FileNotFoundError:
                return {"em_uso": True, "ultimo_uso_s": 0}
            return {"em_uso": False, "ultimo_uso_s": max(0, int(self.relogio() - (ts - 60)))}
        except (OSError, ValueError, subprocess.SubprocessError):
            return {"em_uso": None, "ultimo_uso_s": None}

    def resumo(self, cpu_pct, temperatura_c):
        mem = {}
        for linha in (self.proc / "meminfo").read_text().splitlines():
            nome, valor = linha.split(":", 1)
            mem[nome] = int(valor.split()[0])
        disco = shutil.disk_usage("/")

        def recurso(total, livre):
            return {"usado_mb": round(total - livre, 2), "livre_mb": round(livre, 2),
                    "total_mb": round(total, 2), "pct": round(100 * (total - livre) / total, 2)}

        janelas = self.janelas()
        scopes = self.scopes()
        tempos = [self.parado(s.id) for s in scopes
                  if self.classificar(s, janelas, scopes) in {"agente", "seus"}]
        parados = None if None in tempos else sum(t >= 1800 for t in tempos)
        return {"cpu_pct": cpu_pct, "ram": recurso(mem["MemTotal"] / 1024, mem["MemAvailable"] / 1024),
                "disco": recurso(disco.total / 2**20, disco.free / 2**20),
                "temperatura_c": temperatura_c, "parados_30min": parados,
                "tela": self.tela(), "medido_em": int(self.relogio())}

    def _achar(self, item_id):
        scopes = self.scopes()
        scope = next((s for s in scopes if s.id == item_id), None)
        if scope is None:
            raise Falha(404, "Item não encontrado.")
        if self.classificar(scope, self.janelas(), scopes) not in {"agente", "seus", "terminal"}:
            raise Falha(403, "Este item é protegido.")
        return scope

    def fechar(self, item_id):
        with self._fechamento:
            scope = self._achar(item_id)
            memoria = self.memoria(scope)
            # pidfd fixa o processo: um PID reciclado jamais recebe o sinal.
            try:
                fd = os.pidfd_open(scope.principal.pid)
            except ProcessLookupError:
                raise Falha(404, "Item não encontrado.") from None
            except OSError:
                raise Falha(409, "Não foi possível preparar o fechamento.") from None
            try:
                atual = self._achar(item_id)
                if atual.principal != scope.principal:
                    raise Falha(409, "O item mudou; atualize a lista.")
                via_cdp = False
                porta = self.porta(atual)
                if self.classificar(atual, {}) == "agente" and porta:
                    try:
                        versao = json_cdp(porta, "/json/version")
                        fechar_browser(versao["webSocketDebuggerUrl"], porta)
                        via_cdp = True
                    except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
                        pass
                if not via_cdp:
                    try:
                        signal.pidfd_send_signal(fd, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    except OSError:
                        raise Falha(409, "Não foi possível enviar SIGTERM.") from None
                limite = self.monotono() + 8
                def ainda_vivo():
                    if isinstance(scope, ScopePorProcessos):
                        return any((p := self.processo(antigo.pid)) is not None and p.inicio == antigo.inicio
                                   for antigo in scope.processos)
                    return scope.caminho.exists()

                while ainda_vivo():
                    if self.monotono() >= limite:
                        raise Falha(409, "O item não fechou em 8 segundos.")
                    time.sleep(0.1)
                return {"liberou_mb": memoria}
            finally:
                os.close(fd)
