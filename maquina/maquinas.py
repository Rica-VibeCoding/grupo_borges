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
import threading
import time
from urllib.parse import urlsplit


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


@dataclass
class Observacao:
    cpus: dict
    amostrado: float
    desde: float
    confirmado: bool = False


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
                 runtime=Path("/run/user/1000"), chave=None,
                 relogio=time.time, monotono=time.monotonic):
        self.home = Path.home() if home is None else Path(home)
        self.proc = Path(proc)
        self.cgroup = Path(cgroup) if cgroup is not None else Path(
            "/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service")
        self.runtime = Path(runtime)
        self.chave = Path(chave) if chave is not None else self.home / ".config/cockpit-maquina/chave"
        self.agentes = {a["id"]: a["nome"] for a in agentes}
        self.relogio, self.monotono = relogio, monotono
        self.observado_desde = int(relogio())
        self._ultima_amostra = None
        self._observacoes = {}
        self._trava = threading.Lock()
        self._fechamento = threading.Lock()

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

    def classificar(self, scope, janelas):
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
                return "Agente " + dono, dono
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
            return "Sessões de terminal (agentes)", None
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

    def memoria(self, scope):
        kb = 0
        for processo in scope.processos:
            try:
                for linha in (self.proc / str(processo.pid) / "smaps_rollup").read_text().splitlines():
                    if linha.startswith(("Pss:", "SwapPss:")):
                        kb += int(linha.split()[1])
            except (OSError, ValueError, IndexError):
                continue
        return round(kb / 1024, 2)

    def amostrar(self):
        """Chamado pela coleta existente; nunca lê PSS nem consulta CDP."""
        with self._trava:
            agora = self.monotono()
            if self._ultima_amostra is not None and agora - self._ultima_amostra < 60:
                return
            novas = {}
            for scope in self.scopes():
                cpus = {}
                for p in scope.processos:
                    try:
                        cpus[(p.pid, p.inicio)] = int((self.proc / str(p.pid) / "schedstat").read_text().split()[0])
                    except (OSError, ValueError, IndexError):
                        pass
                anterior = self._observacoes.get(scope.id)
                if not cpus:
                    continue
                if anterior is None:
                    novas[scope.id] = Observacao(cpus, agora, agora)
                    continue
                delta = sum(max(0, cpu - anterior.cpus.get(pid, 0)) for pid, cpu in cpus.items())
                intervalo = agora - anterior.amostrado
                # 0,1 s / 10 s = 1% de um core, escalado ao intervalo real.
                dormindo = intervalo > 0 and delta < intervalo * 10_000_000
                novas[scope.id] = Observacao(cpus, agora, anterior.desde if dormindo else agora, dormindo)
            self._observacoes = novas
            self._ultima_amostra = agora

    def parado(self, item_id):
        with self._trava:
            obs = self._observacoes.get(item_id)
            if obs is None or not obs.confirmado:
                return None
            # Não extrapola tempo que o painel ainda não amostrou.
            return max(0, int(obs.amostrado - obs.desde))

    def abertos(self):
        janelas = self.janelas()
        itens = []
        for scope in self.scopes():
            grupo = self.classificar(scope, janelas)
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
            confirmar = (rotulo in {"VS Code", "LibreOffice"} or any(
                Path(a).name.lower() in {"code", "code-oss", "soffice", "soffice.bin", "libreoffice"}
                for p in scope.processos for a in p.args[:2]))
            itens.append({"id": scope.id, "grupo": grupo, "rotulo": rotulo, "dono": dono,
                          "memoria_mb": self.memoria(scope), "parado_s": self.parado(scope.id),
                          "abas": abas, "pede_confirmacao": confirmar,
                          "acao_rotulo": None if grupo == "protegido" else "Fechar " + rotulo})
        return {"observado_desde": self.observado_desde, "itens": itens}

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
        parados = sum(self.classificar(s, janelas) in {"agente", "seus"}
                      and (self.parado(s.id) or 0) >= 1800 for s in self.scopes())
        return {"cpu_pct": cpu_pct, "ram": recurso(mem["MemTotal"] / 1024, mem["MemAvailable"] / 1024),
                "disco": recurso(disco.total / 2**20, disco.free / 2**20),
                "temperatura_c": temperatura_c, "parados_30min": parados,
                "tela": self.tela(), "medido_em": int(self.relogio())}

    def _achar(self, item_id):
        scope = next((s for s in self.scopes() if s.id == item_id), None)
        if scope is None:
            raise Falha(404, "Item não encontrado.")
        if self.classificar(scope, self.janelas()) not in {"agente", "seus"}:
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
                while scope.caminho.exists():
                    if self.monotono() >= limite:
                        raise Falha(409, "O item não fechou em 8 segundos.")
                    time.sleep(0.1)
                return {"liberou_mb": memoria}
            finally:
                os.close(fd)
