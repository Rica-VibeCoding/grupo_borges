#!/usr/bin/env python3
"""/voltar pelo Telegram nos agentes desta máquina — inclusive até mensagem do canal.

O menu nativo do /rewind não lista mensagem do Telegram (são isMeta). Aqui a volta
é por cópia: `claude -p --resume <atual> --fork-session --resume-session-at <corte>`
grava uma conversa nova cortada, e o lançador (`agentes.relancar`) religa nela.
A original fica intacta; `desfazer` religa nela de novo.

Quem chama é o próprio agente (skill `voltar`), de dentro da sessão que vai cair:
`listar` e `ir` respondem na hora; a troca roda num serviço systemd à parte, que
espera o agente ficar livre antes de religar.

  voltar.py listar
  voltar.py ir <n> --chat <chat_id>
  voltar.py desfazer --chat <chat_id>
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import agentes as ag  # noqa: E402
except ImportError:  # no PC não há painel: o `voltar_pc.py` usa só as funções de conversa
    ag = None

MARCA_DA_COPIA = (
    "↩ voltou aqui\n"
    "[voltar] O Rica voltou a conversa até este ponto pelo /voltar. "
    "Não faça nada; responda só: ok."
)
MOSTRAR = 15
VALIDADE_LISTA_S = 1800
ESPERA_LIVRE_S = 180
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_CANAL = re.compile(r"^<channel\b([^>]*)>(.*)</channel>\s*$", re.DOTALL)
_ANEXO = {"voice": "Áudio", "audio": "Áudio", "photo": "Foto", "document": "Arquivo"}
try:
    BRT = ZoneInfo("America/Sao_Paulo")
except ZoneInfoNotFoundError:  # Python do Windows sem o pacote tzdata
    BRT = timezone(timedelta(hours=-3))


class Erro(Exception):
    pass


# ---------- conversa ----------

def ler_registros(caminho):
    registros = []
    with caminho.open(encoding="utf-8", errors="replace") as arquivo:
        for linha in arquivo:
            # Blobs de request repetem o contexto inteiro; não são mensagem.
            if re.match(r'^\{\s*"type"\s*:\s*"(?:api-request[^" ]*|file-history[^" ]*|last-prompt)"', linha):
                continue
            try:
                p = json.loads(linha)
            except ValueError:
                continue
            if isinstance(p, dict) and p.get("uuid"):
                registros.append(p)
    return registros


def _ativos(registros):
    """A cadeia de pais a partir da última mensagem — ramos de voltas antigas ficam fora."""
    msgs = {r["uuid"]: r for r in registros if not r.get("isSidechain")}
    ativos = set()
    cursor = next(reversed(msgs), "")
    while cursor in msgs and cursor not in ativos:
        ativos.add(cursor)
        cursor = msgs[cursor].get("parentUuid")
    return ativos


def _texto(registro):
    content = (registro.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return None
        partes = [b.get("text") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(p for p in partes if isinstance(p, str)) or None
    return None


def _texto_do_ponto(registro):
    """(texto, canal) se a linha abriu turno — prompt digitado ou mensagem do Telegram."""
    if registro.get("type") != "user" or registro.get("isSidechain") or registro.get("isCompactSummary"):
        return None
    texto = (_texto(registro) or "").strip()
    if not texto:
        return None
    if registro.get("isMeta"):
        if (registro.get("origin") or {}).get("kind") != "channel":
            return None
        achado = _CANAL.match(texto)
        if not achado:
            return None
        corpo = achado.group(2).strip()
        if re.fullmatch(r"\([^)]*\)", corpo):
            tipo = re.search(r'attachment_kind="([^"]+)"', achado.group(1))
            chave = tipo.group(1) if tipo else corpo.strip("()").split()[0]
            return _ANEXO.get(chave, "Anexo"), True
        return (corpo or None) and (corpo, True)
    if registro.get("promptSource") == "system" or texto.startswith("<") or texto.startswith("↩ voltou aqui"):
        return None
    return texto, False


def _transcricao(saida):
    """A fala do Rica na saída do `ouvir.py`.

    O diagnóstico "ouvir: …" vai pro stderr: conforme o terminal ele sai antes
    ou depois do texto. Em divergência ("openai: …" / "gemini: …") fica a primeira.
    """
    linhas = [l.strip() for l in saida.splitlines()]
    if not any(l.startswith("ouvir:") for l in linhas):
        return None
    for linha in linhas:
        if linha and not linha.startswith(("⚠", "exit=", "rc=", "ouvir:")):
            return re.sub(r"^(openai|gemini):\s*", "", linha) or None
    return None


def _saidas_de_ferramenta(registro):
    content = (registro.get("message") or {}).get("content")
    for bloco in content if isinstance(content, list) else []:
        if isinstance(bloco, dict) and bloco.get("type") == "tool_result":
            dentro = bloco.get("content")
            if isinstance(dentro, str):
                yield dentro
            elif isinstance(dentro, list):
                yield "\n".join(b.get("text", "") for b in dentro if isinstance(b, dict))


def pontos(registros):
    ativos = _ativos(registros)
    lista = []
    for i, r in enumerate(registros):
        if r["uuid"] not in ativos:
            continue
        achado = _texto_do_ponto(r)
        if achado:
            lista.append({"id": r["uuid"], "i": i, "texto": achado[0], "canal": achado[1],
                          "horario": r.get("timestamp")})
    # Áudio vira o que o Rica falou: a transcrição que o agente fez no turno.
    for n, p in enumerate(lista):
        if p["texto"] != "Áudio":
            continue
        fim = lista[n + 1]["i"] if n + 1 < len(lista) else len(registros)
        for r in registros[p["i"] + 1:fim]:
            fala = next(filter(None, map(_transcricao, _saidas_de_ferramenta(r))), None)
            if fala:
                p["texto"] = "🎤 " + fala
                break
    return lista


def corte_antes(registros, ponto_id):
    """A última user/assistant antes do ponto — `--resume-session-at` não acha registro system."""
    msgs = {r["uuid"]: r for r in registros if not r.get("isSidechain")}
    cursor = (msgs.get(ponto_id) or {}).get("parentUuid")
    vistos = set()
    while cursor in msgs and cursor not in vistos:
        vistos.add(cursor)
        if msgs[cursor].get("type") in {"user", "assistant"}:
            return cursor
        cursor = msgs[cursor].get("parentUuid")
    return None


def fork_ate(a, sid, corte):
    # Sem --setting-sources '' e --strict-mcp-config o -p sobe o plugin do
    # Telegram e toma o bot da sessão viva.
    cmd = [ag.CONFIG["claude"], "-p", MARCA_DA_COPIA, "--resume", sid, "--fork-session",
           "--resume-session-at", corte, "--setting-sources", "", "--strict-mcp-config",
           "--max-turns", "1", "--output-format", "json"]
    env = {k: v for k, v in os.environ.items() if k not in {"CLAUDECODE", "TELEGRAM_STATE_DIR"}}
    try:
        feito = subprocess.run(cmd, cwd=a["cwd"], stdin=subprocess.DEVNULL, capture_output=True,
                               text=True, timeout=300, env=env)
        nova = json.loads(feito.stdout).get("session_id", "")
    except (subprocess.TimeoutExpired, ValueError, AttributeError) as exc:
        raise Erro("a cópia da conversa falhou") from exc
    if feito.returncode or not UUID.match(nova) or nova == sid:
        raise Erro("a cópia da conversa falhou")
    return nova


# ---------- agente ----------

def agente_atual():
    state = os.environ.get("TELEGRAM_STATE_DIR")
    for a in ag.AGENTES.values():
        if state and a.get("state_dir") and Path(a["state_dir"]) == Path(state):
            return a
    cwd = Path.cwd().resolve()
    for a in ag.AGENTES.values():
        if Path(a["cwd"]).resolve() == cwd:
            return a
    raise Erro("não achei qual agente desta máquina chamou o /voltar")


def sessao_atual(a):
    ag.estado(a, detalhar=False)  # grava o sessionId vivo
    try:
        sid = (ag.ESTADO / (a["id"] + ".session")).read_text().strip()
    except FileNotFoundError:
        raise Erro("o agente não tem conversa salva") from None
    caminho = ag.arquivo_sessao(sid)
    if caminho is None:
        raise Erro("a conversa atual não foi achada no disco")
    return sid, caminho


def _arquivo(a, nome):
    ag.ESTADO.mkdir(parents=True, exist_ok=True, mode=0o700)
    return ag.ESTADO / f"{a['id']}.voltar-{nome}.json"


def _hora(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(BRT).strftime("%d/%m %H:%M")
    except (AttributeError, ValueError):
        return "--"


def _curto(texto, n=80):
    linha = " ".join(texto.split())
    return linha if len(linha) <= n else linha[: n - 1] + "…"


def enviar_telegram(a, chat, texto):
    env = {}
    for linha in (Path(a["state_dir"]) / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in linha and not linha.lstrip().startswith("#"):
            k, v = linha.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    dados = urllib.parse.urlencode({"chat_id": chat, "text": texto}).encode()
    url = f"https://api.telegram.org/bot{env['TELEGRAM_BOT_TOKEN']}/sendMessage"
    urllib.request.urlopen(url, dados, timeout=20).read()


def agendar_religar(a, sid, chat, aviso):
    """A troca roda fora da sessão: o relancar derruba o processo que chamou."""
    unit = f"voltar-{a['id']}-{uuid.uuid4().hex[:8]}"
    r = subprocess.run(["systemd-run", "--user", "--collect", "--quiet", f"--unit={unit}",
                        "/usr/bin/python3", str(Path(__file__).resolve()), "_religar",
                        a["id"], sid, chat, aviso], capture_output=True, text=True, timeout=20)
    if r.returncode:
        raise Erro("não consegui agendar a religação: " + r.stderr.strip())


# ---------- comandos ----------

def listar():
    a = agente_atual()
    sid, caminho = sessao_atual(a)
    lista = [p for p in pontos(ler_registros(caminho)) if not p["texto"].lstrip().startswith("/voltar")]
    lista = lista[-MOSTRAR:][::-1]  # 1 = a mais recente
    _arquivo(a, "lista").write_text(json.dumps(
        {"sid": sid, "criada": time.time(), "pontos": [{"id": p["id"], "texto": p["texto"]} for p in lista]},
        ensure_ascii=False))
    if not lista:
        return "Nenhum ponto de volta nesta conversa."
    linhas = [f"{n}) {_hora(p['horario'])} · {_curto(p['texto'])}" for n, p in enumerate(lista, 1)]
    return ("Voltar até antes de qual mensagem? Responda o número.\n"
            "Ela e tudo depois saem da conversa; arquivos editados não voltam.\n\n" + "\n".join(linhas))


def ir(n, chat):
    a = agente_atual()
    sid, caminho = sessao_atual(a)
    try:
        salva = json.loads(_arquivo(a, "lista").read_text())
    except (FileNotFoundError, ValueError):
        raise Erro("mande /voltar de novo para ver a lista") from None
    if salva.get("sid") != sid or time.time() - salva.get("criada", 0) > VALIDADE_LISTA_S:
        raise Erro("a lista ficou velha; mande /voltar de novo")
    if not 1 <= n <= len(salva["pontos"]):
        raise Erro(f"escolha um número de 1 a {len(salva['pontos'])}")
    ponto = salva["pontos"][n - 1]
    corte = corte_antes(ler_registros(caminho), ponto["id"])
    if corte is None:
        raise Erro("esse é o começo da conversa; não há antes dele")
    nova = fork_ate(a, sid, corte)
    _arquivo(a, "desfazer").write_text(json.dumps({"anterior": sid, "nova": nova}))
    _arquivo(a, "lista").unlink(missing_ok=True)
    agendar_religar(a, nova, chat, "↩ Voltei até antes de: " + _curto(ponto["texto"], 120)
                    + "\nPara desfazer: /voltar desfazer")
    return "Cópia pronta. Religo assim que você terminar este turno."


def desfazer(chat):
    a = agente_atual()
    sid, _ = sessao_atual(a)
    try:
        estado = json.loads(_arquivo(a, "desfazer").read_text())
    except (FileNotFoundError, ValueError):
        raise Erro("não há volta para desfazer") from None
    if estado.get("nova") != sid:
        raise Erro("a conversa mudou desde a última volta; não desfaço")
    if ag.arquivo_sessao(estado["anterior"]) is None:
        raise Erro("a conversa original já foi apagada do disco")
    # Trocar os papéis deixa um segundo `desfazer` refazer a volta.
    _arquivo(a, "desfazer").write_text(json.dumps({"anterior": sid, "nova": estado["anterior"]}))
    agendar_religar(a, estado["anterior"], chat, "↩ Desfeito: voltei para a conversa de antes da volta.")
    return "Religo na conversa original assim que você terminar este turno."


def _religar(agente_id, sid, chat, aviso):
    a = ag.AGENTES[agente_id]
    prazo = time.time() + ESPERA_LIVRE_S
    time.sleep(5)
    while ag.estado(a, detalhar=False)["status"] == "busy" and time.time() < prazo:
        time.sleep(2)
    if ag.estado(a, detalhar=False)["status"] == "busy":
        enviar_telegram(a, chat, "⚠ /voltar: o agente ficou ocupado e não religuei. Mande de novo.")
        return 1
    time.sleep(3)  # o turno fecha a resposta antes do status virar idle
    try:
        ag.relancar(a, resume=sid)
    except ValueError as exc:
        enviar_telegram(a, chat, f"⚠ /voltar falhou ao religar: {exc}")
        return 1
    enviar_telegram(a, chat, aviso)
    return 0


def main(args):
    if args[:1] == ["_religar"] and len(args) == 5:
        return _religar(*args[1:])
    chat = None
    if "--chat" in args:
        i = args.index("--chat")
        chat = args[i + 1] if i + 1 < len(args) else None
        args = args[:i] + args[i + 2:]
        if not chat or not re.fullmatch(r"-?\d+", chat):
            raise Erro("--chat precisa do chat_id numérico")
    if args == ["listar"]:
        print(listar())
    elif len(args) == 2 and args[0] == "ir" and args[1].isdigit() and chat:
        print(ir(int(args[1]), chat))
    elif args == ["desfazer"] and chat:
        print(desfazer(chat))
    else:
        print("uso: voltar.py listar | ir <n> --chat <id> | desfazer --chat <id>", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (Erro, ValueError, OSError, subprocess.SubprocessError) as exc:
        print(f"/voltar: {exc}", file=sys.stderr)
        sys.exit(1)
