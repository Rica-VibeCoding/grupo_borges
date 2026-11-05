#!/usr/bin/env python3
"""Config, estado e comandos do tmux. Só stdlib; cada agente tem seu próprio socket."""
import contextlib
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid

PASTA = Path(__file__).resolve().parent
ESTADO = Path.home() / ".local/state/cockpit-maquina"
SESSOES = Path.home() / ".claude/sessions"
PROJETOS = Path.home() / ".claude/projects"
IDENT = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
SESSION_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\Z")
ENV_NOME = re.compile(r"[a-zA-Z_][a-zA-Z0-9_]*\Z")


def configurar():
    c = json.loads((PASTA / "agentes.json").read_text())
    ip = ipaddress.IPv4Address(c["ip_tailscale"])
    if ip not in ipaddress.ip_network("100.64.0.0/10"):
        raise ValueError("ip_tailscale precisa ser um IPv4 do Tailscale")
    if not isinstance(c["porta"], int) or not 1 <= c["porta"] <= 65535:
        raise ValueError("porta inválida")
    if not isinstance(c["janela_tokens"], int) or c["janela_tokens"] <= 0:
        raise ValueError("janela_tokens inválida")
    if not Path(c["claude"]).is_absolute() or not isinstance(c["path"], str):
        raise ValueError("claude precisa de caminho absoluto; path precisa ser texto")
    ids, sockets = set(), set()
    if not c["agentes"]:
        raise ValueError("configure pelo menos um agente")
    for a in c["agentes"]:
        for campo in ("id", "socket", "sessao"):
            if not isinstance(a[campo], str) or not IDENT.fullmatch(a[campo]):
                raise ValueError(f"{campo} inválido no config")
        if a["id"] in ids or a["socket"] in sockets:
            raise ValueError("ids e sockets precisam ser únicos")
        ids.add(a["id"])
        sockets.add(a["socket"])
        if not isinstance(a["nome"], str) or not isinstance(a["boot"], bool):
            raise ValueError("nome/boot inválido")
        for campo in ("cwd", "state_dir", "env_arquivo"):
            if campo == "cwd" or a.get(campo) is not None:
                if not isinstance(a[campo], str) or not Path(a[campo]).is_absolute():
                    raise ValueError(f"{campo} precisa de caminho absoluto")
        remover = a.get("env_remover", [])
        if not isinstance(remover, list) or not all(isinstance(v, str) and ENV_NOME.fullmatch(v) for v in remover):
            raise ValueError("env_remover precisa ser uma lista de nomes de variável")
        if not isinstance(a["flags"], list) or not all(isinstance(v, str) for v in a["flags"]):
            raise ValueError("flags precisa ser uma lista de argumentos")
        if any(v.split("=", 1)[0] in {"--continue", "-c", "--resume", "-r"} for v in a["flags"]):
            raise ValueError("retomada é controlada pelo cockpit: não ponha continue/resume nas flags")
    return c


CONFIG = configurar()
AGENTES = {a["id"]: a for a in CONFIG["agentes"]}


def ambiente(a):
    """KEY=VALUE literal, sem shell/expansão; erros nunca incluem valores."""
    env = os.environ.copy()
    if a.get("env_arquivo"):
        fd = os.open(a["env_arquivo"], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, encoding="utf-8", errors="replace") as f:
            info = os.fstat(f.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
                raise ValueError("env_arquivo exige arquivo regular do usuário em modo 600")
            for numero, linha in enumerate(f, 1):
                linha = linha.rstrip("\r\n")
                if not linha.strip() or linha.lstrip().startswith("#"):
                    continue
                nome, separador, valor = linha.partition("=")
                if not separador or not ENV_NOME.fullmatch(nome) or "\0" in valor or "\ufffd" in linha:
                    raise ValueError(f"env_arquivo inválido na linha {numero}")
                env[nome] = valor
    for nome in a.get("env_remover", []):
        env.pop(nome, None)
    env["PATH"] = CONFIG["path"]
    env.pop("TELEGRAM_STATE_DIR", None)
    if a.get("state_dir"):
        env["TELEGRAM_STATE_DIR"] = a["state_dir"]
    return env


def rodar(cmd, timeout=10):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                          encoding="utf-8", errors="replace")


def tmux(a, *args):
    return rodar(["tmux", "-L", a["socket"], *args])


def alvo(a):
    return "=" + a["sessao"]


def ligado(a):
    return tmux(a, "has-session", "-t", alvo(a)).returncode == 0


@contextlib.contextmanager
def trava(a):
    # Também serializa dois CLIs e o boot com um toque no telefone.
    ESTADO.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (ESTADO / (a["id"] + ".lock")).open("a") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Outra ação deste agente está em andamento.") from None
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def json_ler(caminho):
    try:
        v = json.loads(caminho.read_text())
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def id_valido(sid):
    return isinstance(sid, str) and SESSION_ID.fullmatch(sid) is not None


def gravar_sessao(a, sid):
    if not id_valido(sid):
        return
    ESTADO.mkdir(parents=True, exist_ok=True, mode=0o700)
    destino = ESTADO / (a["id"] + ".session")
    try:
        if destino.read_text().strip() == sid:
            return
    except FileNotFoundError:
        pass
    # Troca atômica: o Ligar nunca lê uma escrita pela metade.
    temporario = destino.with_name(destino.name + "." + uuid.uuid4().hex)
    try:
        with open(temporario, "x", opener=lambda p, flags: os.open(p, flags, 0o600)) as f:
            f.write(sid + "\n")
        temporario.replace(destino)
    finally:
        temporario.unlink(missing_ok=True)


def arquivo_sessao(sid):
    if not id_valido(sid):
        return None
    # Procura pelo ID exato, nunca pelo JSONL mais novo da pasta do projeto.
    return next((p for p in PROJETOS.rglob(sid + ".jsonl") if p.is_file()), None)


def filhos(pid):
    fila, vistos = [pid], set()
    while fila:
        atual = fila.pop(0)
        if atual in vistos:
            continue
        vistos.add(atual)
        yield atual
        try:
            texto = Path(f"/proc/{atual}/task/{atual}/children").read_text()
            fila.extend(int(v) for v in texto.split())
        except (OSError, ValueError):
            pass


def processo_claude(pane_pid):
    candidatos = []
    for pid in filhos(pane_pid):
        try:
            args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
            # Native Claude ou launcher node; não confunde claude -p com o interativo.
            nomes = {Path(os.fsdecode(v)).name for v in args[:2] if v}
            if not nomes.intersection({"claude", "claude.exe", "cli.js"}):
                continue
            if any(v in {b"-p", b"--print"} or v.startswith(b"--print=") for v in args):
                continue
            status = json_ler(SESSOES / f"{pid}.json")
            candidatos.append((pid, status))
        except OSError:
            pass
    # O launcher pode ter um filho Claude; prefere o que tem o registro de sessão.
    return next((v for v in candidatos if id_valido(v[1].get("sessionId"))),
                candidatos[-1] if candidatos else (None, {}))


def linhas_reversas(caminho):
    # JSONL pode ter centenas de MB; lemos de trás para frente em blocos.
    with caminho.open("rb") as f:
        f.seek(0, 2)
        pos, resto = f.tell(), b""
        while pos:
            n = min(pos, 65536)
            pos -= n
            f.seek(pos)
            partes = (f.read(n) + resto).split(b"\n")
            resto = partes[0]
            yield from reversed(partes[1:])
        if resto:
            yield resto


def contexto(sid):
    arq = arquivo_sessao(sid)
    tokens, modelo = None, None
    if arq:
        try:
            for linha in linhas_reversas(arq):
                try:
                    obj = json.loads(linha)
                    if obj.get("sessionId", sid) != sid:
                        continue
                    msg = obj.get("message")
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("model") == "<synthetic>":
                        continue  # Interrupção do harness não é resposta do motor.
                    if not modelo and isinstance(msg.get("model"), str):
                        modelo = msg["model"]
                    u = msg.get("usage")
                    if tokens is None and isinstance(u, dict):
                        campos = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
                        valores = [u.get(k, 0) for k in campos]
                        if all(isinstance(v, (int, float)) and v >= 0 for v in valores):
                            tokens = int(sum(valores))
                    if tokens is not None and modelo:
                        break
                except (ValueError, TypeError, AttributeError):
                    continue
        except OSError:
            pass
    return tokens, modelo


def idade_processo(pid):
    try:
        # O campo 22 é o instante de início; comm pode conter espaços/parênteses.
        campos = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        inicio = int(campos[19]) / os.sysconf("SC_CLK_TCK")
        uptime = float(Path("/proc/uptime").read_text().split()[0])
        return max(0, int(uptime - inicio))
    except (OSError, ValueError, IndexError):
        return None


def estado(a, detalhar=True):
    r = tmux(a, "list-panes", "-s", "-t", alvo(a),
             "-F", "#{pane_id}\t#{pane_pid}\t#{session_created}")
    resultado = dict(id=a["id"], nome=a["nome"], ligado=r.returncode == 0,
                     status="desligado", tokens=None, modelo=None, segundos=None,
                     janela=CONFIG["janela_tokens"], pane=None, pid=None)
    if r.returncode:
        return resultado
    resultado["status"] = "desconhecido"
    for linha in r.stdout.splitlines():
        try:
            pane, pane_pid, criado = linha.split("\t")
            pid, dados = processo_claude(int(pane_pid))
        except (ValueError, OSError):
            continue
        if not resultado["pane"]:
            resultado["pane"] = pane
            resultado["segundos"] = max(0, int(time.time() - int(criado)))
        if pid is None:
            continue
        resultado["pane"], resultado["pid"] = pane, pid
        resultado["segundos"] = idade_processo(pid)
        status = dados.get("status")
        resultado["status"] = status if isinstance(status, str) and status in {"busy", "idle"} else "desconhecido"
        sid = dados.get("sessionId")
        if id_valido(sid):
            gravar_sessao(a, sid)
            if detalhar:
                resultado["tokens"], resultado["modelo"] = contexto(sid)
                telemetria = json_ler(Path("/tmp") / f"cc-status-{sid}.json")
                modelo_vivo = telemetria.get("model")
                if (telemetria.get("session_id") == sid and isinstance(modelo_vivo, dict)
                        and isinstance(modelo_vivo.get("id"), str)):
                    resultado["modelo"] = modelo_vivo["id"]
        if isinstance(dados.get("model"), str):
            resultado["modelo"] = dados["model"]
        break
    if not resultado["modelo"]:
        flags = a["flags"]
        if "--model" in flags and flags.index("--model") + 1 < len(flags):
            resultado["modelo"] = flags[flags.index("--model") + 1]
    return resultado


def telegram_pid(a):
    """bot.pid só vale se ainda pertence ao bun deste state_dir (não PID reciclado)."""
    try:
        pasta = Path(a["state_dir"])
        pid = int((pasta / "bot.pid").read_text().strip())
        if pid <= 1:
            return None
        proc = Path(f"/proc/{pid}")
        if proc.stat().st_uid != os.getuid():
            return None
        campos = (proc / "stat").read_text().rsplit(")", 1)[1].split()
        if campos[0] in {"Z", "X"}:
            return None
        args = (proc / "cmdline").read_bytes().split(b"\0")
        exe = Path(os.readlink(proc / "exe")).name
        if exe != "bun" and not exe.startswith("bun-"):
            return None
        env = (proc / "environ").read_bytes().split(b"\0")
        esperado = os.fsencode(str(pasta))
        if b"TELEGRAM_STATE_DIR=" + esperado not in env and not any(
                v == esperado or v == b"TELEGRAM_STATE_DIR=" + esperado
                or v.startswith(esperado + b"/") for v in args):
            return None
        os.kill(pid, 0)
        return pid
    except (OSError, ValueError, KeyError, IndexError):
        return None


def reconnect_log(a, resultado):
    ESTADO.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (ESTADO / "reconnect.log").open("a") as f:
        f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {a['id']} {resultado}\n")


def iniciar_vigia(a):
    if not a.get("state_dir"):
        return
    # Serviço transitório independente: não herda o cgroup nem a vida do boot/API.
    # O PID do Claude é fixado no vigia, para nunca operar uma sessão substituta.
    r = tmux(a, "list-panes", "-s", "-t", alvo(a), "-F", "#{pane_id}\t#{pane_pid}")
    if r.returncode or len(r.stdout.splitlines()) != 1:
        reconnect_log(a, "parado pane ambíguo")
        return
    pane, pane_pid = r.stdout.strip().split("\t")
    r = rodar(["systemd-run", "--user", "--quiet", "--collect", "--expand-environment=no",
               "--unit=cockpit-reconnect-" + a["id"] + "-" + uuid.uuid4().hex,
               "--property=RuntimeMaxSec=300", "/usr/bin/python3", str(PASTA / "agentes.py"),
               "--reconnect", a["id"], pane, pane_pid])
    if r.returncode:
        reconnect_log(a, "erro ao destacar vigia")


def prompt_texto(tela):
    # Só reconhece o editor atual, entre as duas réguas. Ignora prompts históricos
    # e rejeita texto em continuação de linha (inclusive quando a primeira é vazia).
    linhas = tela.splitlines()
    for i in range(len(linhas) - 2, 0, -1):
        if linhas[i].lstrip().startswith("❯") and re.fullmatch(r"\s*─{4,}.*", linhas[i - 1]):
            if re.fullmatch(r"\s*─{4,}.*", linhas[i + 1]):
                return linhas[i].lstrip()[1:].strip()
            return None
    return None


def menu_mcp(tela):
    # O diálogo ocupa a parte inferior; texto antigo na conversa não conta.
    bloco = re.split(r"(?m)^\s*▔{4,}.*$", tela)[-1]
    if "Esc to " not in bloco:
        return None, ""
    if "Manage MCP servers" in bloco:
        return "lista", bloco
    if "Plugin:telegram:telegram MCP Server" in bloco:
        return "telegram", bloco
    return None, ""


def vigiar_telegram(a, pane, pane_pid):
    ESTADO.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (ESTADO / (a["id"] + ".reconnect.lock")).open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            reconnect_log(a, "parado vigia já ativo")
            return
        teclas, pid_claude = 0, None
        dono_menu = False

        def capturar():
            nonlocal pid_claude
            r = tmux(a, "display-message", "-p", "-t", pane, "#{pane_pid}")
            if r.returncode or r.stdout.strip() != str(pane_pid):
                raise ValueError("sessão encerrada ou substituída")
            pid, dados = processo_claude(int(pane_pid))
            if pid_claude is not None and pid != pid_claude:
                raise ValueError("Claude encerrado ou substituído")
            if pid is not None:
                pid_claude = pid
            r = tmux(a, "capture-pane", "-p", "-t", pane)
            if r.returncode:
                raise ValueError("pane indisponível")
            return r.stdout, dados.get("status")

        def enviar_tecla(tela, *args):
            nonlocal teclas
            # Serializa a tecla com Desligar/Relançar e revalida dentro da trava.
            with trava(a):
                atual, status = capturar()
                if dono_menu and prompt_texto(atual) is not None:
                    raise ValueError("prompt reapareceu; usuário pode estar digitando")
                if atual != tela or not (status == "idle" or (
                        dono_menu and status == "waiting" and menu_mcp(atual)[0] is not None)):
                    raise ValueError("tela mudou ou turno em voo")
                if tmux(a, "send-keys", "-t", pane, *args).returncode:
                    raise ValueError("falha ao enviar tecla")
                teclas += 1
            time.sleep(0.25)

        def aguardar_prompt(limite):
            estavel = None
            while time.monotonic() < limite:
                tela, status = capturar()
                if status == "idle" and prompt_texto(tela) == "":
                    if tela == estavel:
                        return tela
                    estavel = tela
                else:
                    estavel = None
                time.sleep(1)
            raise ValueError("tempo esgotado aguardando prompt vazio e ocioso")

        def aguardar_menu(tipo, limite):
            while time.monotonic() < limite:
                tela, status = capturar()
                if status == "busy" or prompt_texto(tela) not in {None, "/mcp"}:
                    raise ValueError("usuário assumiu o prompt ou turno em voo")
                if menu_mcp(tela)[0] == tipo:
                    return tela
                time.sleep(0.25)
            raise ValueError("menu MCP não reconhecido")

        def selecionar(tipo, texto):
            # Uma seta por captura; seleciona pela linha visível, nunca pelo índice.
            vistos = set()
            for _ in range(40):
                tela = aguardar_menu(tipo, time.monotonic() + 5)
                bloco = menu_mcp(tela)[1]
                linhas = bloco.splitlines()
                selecionada = next((l.strip() for l in linhas if l.lstrip().startswith("❯")), "")
                if not selecionada or selecionada in vistos:
                    raise ValueError("seleção MCP não reconhecida")
                if texto in selecionada:
                    enviar_tecla(tela, "Enter")
                    return
                vistos.add(selecionada)
                # Escolhe a direção pelo alvo visível; se fora da janela, varre uma
                # linha por vez até aparecer (o ciclo acima limita menus inesperados).
                alvo_i = next((i for i, l in enumerate(linhas) if texto in l), None)
                atual_i = next(i for i, l in enumerate(linhas) if l.lstrip().startswith("❯"))
                enviar_tecla(tela, "Up" if alvo_i is not None and alvo_i < atual_i else "Down")
            raise ValueError("linha MCP não encontrada")

        def fechar_menu():
            nonlocal dono_menu
            for _ in range(3):
                tela, status = capturar()
                if prompt_texto(tela) == "":
                    dono_menu = False
                    return
                if (prompt_texto(tela) is not None or status not in {"idle", "waiting"}
                        or menu_mcp(tela)[0] is None):
                    raise ValueError("tela desconhecida; sem Escape")
                enviar_tecla(tela, "Escape")
            raise ValueError("menu não fechou")

        try:
            aguardar_prompt(time.monotonic() + 180)
            if telegram_pid(a):
                reconnect_log(a, f"ok pid={telegram_pid(a)} teclas=0")
                return
            for tentativa in range(1, 3):
                tela = aguardar_prompt(time.monotonic() + 15)
                if telegram_pid(a):
                    reconnect_log(a, f"ok pid={telegram_pid(a)} teclas={teclas}")
                    return
                enviar_tecla(tela, "-l", "/mcp")
                tela, _ = capturar()
                if prompt_texto(tela) != "/mcp":
                    raise ValueError("prompt mudou; comando não enviado")
                enviar_tecla(tela, "Enter")
                dono_menu = True
                aguardar_menu("lista", time.monotonic() + 10)
                selecionar("lista", "plugin:telegram:telegram")
                aguardar_menu("telegram", time.monotonic() + 10)
                selecionar("telegram", "Reconnect")
                # Reconnect pode mostrar progresso antes de voltar ao diálogo.
                limite = time.monotonic() + 20
                while time.monotonic() < limite:
                    if telegram_pid(a):
                        break
                    time.sleep(0.5)
                fechar_menu()
                if telegram_pid(a):
                    reconnect_log(a, f"reconectado pid={telegram_pid(a)} tentativa={tentativa} teclas={teclas}")
                    return
                reconnect_log(a, f"sem poller tentativa={tentativa} teclas={teclas}")
            reconnect_log(a, f"falhou após 2 tentativas teclas={teclas}")
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            reconnect_log(a, f"parado {exc} teclas={teclas}")
        finally:
            if dono_menu:
                try:
                    fechar_menu()
                except (ValueError, OSError, subprocess.SubprocessError):
                    pass


def ligar(a, resume=None, nova=False, _locked=False):
    if resume is not None:
        pasta = PROJETOS / re.sub(r"[^a-zA-Z0-9]", "-", str(Path(a["cwd"]).resolve()))
        if not id_valido(resume) or not (pasta / (resume + ".jsonl")).is_file():
            raise ValueError("A conversa não pertence ao workspace deste agente.")
    if ligado(a):
        return "já no ar"
    with contextlib.nullcontext() if _locked else trava(a):
        if ligado(a):
            return "já no ar"
        if not Path(a["cwd"]).is_dir() or not os.access(CONFIG["claude"], os.X_OK):
            raise ValueError("Confira a pasta do projeto e o executável Claude no config.")
        if not shutil.which("systemd-run") or not shutil.which("tmux"):
            raise ValueError("tmux e systemd-run precisam estar disponíveis.")
        ambiente(a)  # Recusa arquivo inválido antes de criar a sessão.
        # O filho lê o arquivo e faz execve: valores nunca passam por argv,
        # systemd, shell ou ambiente de um servidor tmux já existente.
        cmd = ["tmux", "-L", a["socket"], "new-session", "-d", "-s", a["sessao"],
               "-x", "200", "-y", "50", "-c", a["cwd"],
               "/usr/bin/python3", str(PASTA / "agentes.py"), "--exec", a["id"],
               "--dangerously-skip-permissions", *a["flags"]]
        try:
            sid = (ESTADO / (a["id"] + ".session")).read_text().strip()
        except FileNotFoundError:
            sid = None
        if nova:
            sid = None
        elif resume is not None:
            sid = resume
        retomar = arquivo_sessao(sid) is not None
        if retomar:
            cmd += ["--resume", sid]
        elif nova:
            cmd += ["--session-id", str(uuid.uuid4())]
        if a.get("state_dir"):
            cmd += ["--channels", "plugin:telegram@claude-plugins-official"]
        # O servidor nasce no scope, fora das duas units. O cliente tmux termina,
        # mas o scope continua vivo enquanto o servidor tiver processos nele.
        scope = "cockpit-tmux-" + a["id"] + "-" + uuid.uuid4().hex
        r = rodar(["systemd-run", "--user", "--scope", "--quiet", "--collect", "--expand-environment=no",
                   "--unit=" + scope, *cmd], timeout=25)
        if r.returncode or not ligado(a):
            raise ValueError("Não foi possível ligar: " + (r.stderr.strip() or "sessão tmux não apareceu"))
        # O tmux.conf do Omarchy liga Alt+Enter a dividir a tela, e o terminal manda
        # Shift+Enter com esse código: o pulo de linha do composer abria outro terminal.
        # Alt+Esc fecha o pane: dois Esc do Claude Code chegando juntos pelo SSH viram
        # Alt+Esc no tmux e matavam o agente (03/11).
        # Desligar aqui vale mesmo se uma atualização do Omarchy restaurar o arquivo.
        for tecla in ("M-Enter", "M-S-Enter", "M-Escape"):
            tmux(a, "unbind-key", "-n", tecla)
        iniciar_vigia(a)
        return "Ligado; retomando a sessão salva." if retomar else "Ligado com conversa nova."


def desligar(a, _locked=False):
    with contextlib.nullcontext() if _locked else trava(a):
        if not ligado(a):
            return "Já está desligado."
        e = estado(a, detalhar=False)  # Guarda o ID antes de encerrar.
        pane = e["pane"]
        if pane:
            tmux(a, "send-keys", "-t", pane, "Escape")
            time.sleep(0.5)
            tmux(a, "send-keys", "-t", pane, "C-e", "C-u")
            tmux(a, "send-keys", "-t", pane, "-l", "/exit")
            tmux(a, "send-keys", "-t", pane, "Enter")
            for _ in range(15):
                if not ligado(a):
                    return "Desligado."
                time.sleep(1)
        r = tmux(a, "kill-session", "-t", alvo(a))
        if r.returncode and ligado(a):
            raise ValueError("Não foi possível desligar a sessão tmux.")
        return "Desligado."


def enviar(a, acao, forcar=False):
    if acao not in {"compactar", "nova"}:
        raise ValueError("Ação desconhecida.")
    with trava(a):
        e = estado(a, detalhar=False)
        if not e["ligado"] or not e["pid"]:
            raise ValueError("O agente precisa estar ligado e com o Claude em execução.")
        if not forcar and e["status"] != "idle":
            if e["status"] == "busy":
                raise ValueError("Agente ocupado. Aguarde ficar livre ou envie forcar=1.")
            raise ValueError("Não foi possível confirmar que o agente está livre. Aguarde ou envie forcar=1.")
        # Limpa o prompt e envia apenas um dos dois comandos fixos.
        comando = "/compact" if acao == "compactar" else "/clear"
        for teclas in [("C-e", "C-u"), ("-l", comando), ("Enter",)]:
            r = tmux(a, "send-keys", "-t", e["pane"], *teclas)
            if r.returncode:
                raise ValueError("Falha ao enviar o comando ao agente.")
        return "Compactação solicitada." if acao == "compactar" else "Sessão nova solicitada."


def boot():
    falhou = False
    for a in AGENTES.values():
        if a["boot"]:
            try:
                r = rodar([str(PASTA / "agente.sh"), "ligar", a["id"]], timeout=40)
                print(a["nome"] + ": " + (r.stdout.strip() or r.stderr.strip()), flush=True)
                falhou |= r.returncode != 0
            except (OSError, subprocess.SubprocessError) as exc:
                # Um problema no primeiro agente não impede tentar os próximos.
                print(a["nome"] + ": " + str(exc), flush=True)
                falhou = True
    return int(falhou)


def relancar(a, resume=None, nova=False):
    # Valida antes de parar e mantém a mesma trava durante toda a troca.
    if resume is not None:
        pasta = PROJETOS / re.sub(r"[^a-zA-Z0-9]", "-", str(Path(a["cwd"]).resolve()))
        if not id_valido(resume) or not (pasta / (resume + ".jsonl")).is_file():
            raise ValueError("A conversa não pertence ao workspace deste agente.")
    with trava(a):
        desligar(a, _locked=True)
        return ligar(a, resume=resume, nova=nova, _locked=True)


def main():
    if len(sys.argv) == 5 and sys.argv[1] == "--reconnect" and sys.argv[2] in AGENTES:
        a = AGENTES[sys.argv[2]]
        if a.get("state_dir") and re.fullmatch(r"%[0-9]+", sys.argv[3]) and sys.argv[4].isdigit():
            vigiar_telegram(a, sys.argv[3], int(sys.argv[4]))
            return 0
        return 2
    if len(sys.argv) >= 4 and sys.argv[1] == "--exec" and sys.argv[2] in AGENTES:
        a = AGENTES[sys.argv[2]]
        os.execve(CONFIG["claude"], [CONFIG["claude"], *sys.argv[3:]], ambiente(a))
    if sys.argv[1:] == ["--boot"]:
        return boot()
    args = sys.argv[1:]
    if (len(args) not in {2, 3, 4} or args[0] not in {"ligar", "desligar", "estado", "relancar"}
            or args[1] not in AGENTES):
        print("uso: agente.sh <ligar|desligar|estado|relancar> <agente> [--new|--resume ID]", file=sys.stderr)
        return 2
    a, acao = AGENTES[args[1]], args[0]
    opcao = args[2:]
    if opcao and (acao not in {"ligar", "relancar"} or not (
            opcao == ["--new"] or (len(opcao) == 2 and opcao[0] == "--resume" and id_valido(opcao[1])))):
        raise ValueError("Opção inválida do lançador.")
    resume = opcao[1] if len(opcao) == 2 else None
    if acao == "estado":
        print(json.dumps(estado(a), ensure_ascii=False))
    else:
        if acao == "desligar":
            print(desligar(a))
        else:
            print((ligar if acao == "ligar" else relancar)(a, resume=resume, nova=opcao == ["--new"]))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
