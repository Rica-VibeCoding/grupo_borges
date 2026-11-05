#!/usr/bin/env python3
"""Uma página, um processo, uma porta. Estado Linux e agentes sem bibliotecas externas."""
import ipaddress
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
import threading
import time
from urllib.parse import parse_qs

from agentes import AGENTES, CONFIG, PASTA, enviar, estado, rodar

INTERVALO = 3
TRAVA = threading.Lock()
FOTO = {"maquina": [], "agentes": [], "atualizado": None}


def ip_tailscale():
    try:
        r = rodar(["tailscale", "ip", "-4"], timeout=5)
        if r.returncode == 0:
            for linha in r.stdout.split():
                ip = ipaddress.IPv4Address(linha)
                if ip in ipaddress.ip_network("100.64.0.0/10"):
                    return str(ip)
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return CONFIG["ip_tailscale"]  # Se não estiver atribuído, o bind falha; não abre outra interface.


def tempo(segundos):
    s = int(segundos)
    dias, s = divmod(s, 86400)
    horas, s = divmod(s, 3600)
    minutos = s // 60
    return (f"{dias}d " if dias else "") + f"{horas}h {minutos}min"


def cpu_ler():
    valores = [int(v) for v in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
    # guest já está incluído em user/nice: não soma duas vezes.
    return valores[3] + valores[4], sum(valores[:8])


def temperatura():
    valores = []
    for base in Path("/sys/class/thermal").glob("thermal_zone*"):
        try:
            tipo = (base / "type").read_text().strip().lower()
            t = int((base / "temp").read_text()) / 1000
            if -20 < t < 150:
                valores.append((any(v in tipo for v in ("cpu", "pkg", "x86")), t))
        except (OSError, ValueError):
            pass
    if not valores:
        for arq in Path("/sys/class/hwmon").glob("hwmon*/temp*_input"):
            try:
                t = int(arq.read_text()) / 1000
                if -20 < t < 150:
                    valores.append((False, t))
            except (OSError, ValueError):
                pass
    preferidos = [t for cpu, t in valores if cpu] or [t for _, t in valores]
    return max(preferidos) if preferidos else None


def bateria():
    resultados = []
    traducao = {"Charging": "carregando", "Discharging": "em uso",
                "Full": "cheia", "Not charging": "sem carregar", "Unknown": "estado desconhecido"}
    for base in Path("/sys/class/power_supply").glob("*"):
        try:
            if (base / "type").read_text().strip() != "Battery":
                continue
            if (base / "present").exists() and (base / "present").read_text().strip() == "0":
                continue
            capacidade = max(0, min(100, int((base / "capacity").read_text())))
            status = (base / "status").read_text().strip()
            resultados.append((base.name, capacidade, traducao.get(status, "estado desconhecido")))
        except (OSError, ValueError):
            pass
    return resultados


def maquina(cpu_pct):
    mem = {}
    for linha in Path("/proc/meminfo").read_text().splitlines():
        k, v = linha.split(":", 1)
        mem[k] = int(v.split()[0])
    ram = mem["MemTotal"] - mem["MemAvailable"]
    disco = shutil.disk_usage("/")
    up = float(Path("/proc/uptime").read_text().split()[0])
    campos = [
        {"nome": "CPU", "valor": "—" if cpu_pct is None else f"{cpu_pct:.0f}%", "pct": cpu_pct},
        {"nome": "RAM", "valor": f"{ram / 2**20:.1f} / {mem['MemTotal'] / 2**20:.1f} GiB",
         "pct": 100 * ram / mem["MemTotal"]},
        {"nome": "Disco /", "valor": f"{(disco.total - disco.free) / 2**30:.1f} / {disco.total / 2**30:.1f} GiB",
         "pct": 100 * (disco.total - disco.free) / disco.total},
        {"nome": "Ligada há", "valor": tempo(up), "pct": None},
    ]
    t = temperatura()
    if t is not None:
        campos.append({"nome": "Temperatura", "valor": f"{t:.0f} °C", "pct": None})
    for nome, pct, status in bateria():
        campos.append({"nome": "Bateria " + nome, "valor": f"{pct}% · {status}", "pct": pct, "bateria": True})
    return campos


def coletar():
    anterior = None
    while True:
        inicio = time.monotonic()
        agentes, erro = [], None
        try:
            atual = cpu_ler()
            pct = None
            if anterior and atual[1] > anterior[1]:
                pct = max(0, min(100, 100 * (1 - (atual[0] - anterior[0]) / (atual[1] - anterior[1]))))
            anterior = atual
            campos = maquina(pct)
        except (OSError, ValueError, KeyError) as exc:
            campos, erro = [], "Não foi possível ler o estado da máquina."
            print(f"Coleta da máquina: {exc}", flush=True)
        for a in AGENTES.values():
            try:
                e = estado(a)
                # A página não precisa de PID, pane ou caminhos internos.
                e.pop("pid", None); e.pop("pane", None)
            except (OSError, ValueError, subprocess.SubprocessError) as exc:
                e = {"id": a["id"], "nome": a["nome"], "ligado": None,
                     "status": "desconhecido", "tokens": None, "modelo": None,
                     "segundos": None, "janela": CONFIG["janela_tokens"],
                     "erro": "Não foi possível consultar o agente."}
                print(f"Coleta de {a['id']}: {exc}", flush=True)
            agentes.append(e)
        with TRAVA:
            FOTO.update(maquina=campos, agentes=agentes, atualizado=time.time(), erro=erro)
        time.sleep(max(0.2, INTERVALO - (time.monotonic() - inicio)))


class Servidor(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class H(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(40)

    def responder(self, codigo, dados, tipo="application/json; charset=utf-8"):
        if isinstance(dados, dict):
            dados = json.dumps(dados, ensure_ascii=False)
        corpo = dados.encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; "
                         "style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; "
                         "frame-ancestors 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(corpo)

    def host_valido(self):
        hosts = self.headers.get_all("Host", [])
        return hosts == [self.server.autoridade]

    def do_GET(self):
        if not self.host_valido():
            return self.responder(403, {"mensagem": "Host recusado. Use o IP Tailscale e a porta do painel."})
        if self.path == "/":
            return self.responder(200, (PASTA / "painel.html").read_text(), "text/html; charset=utf-8")
        if self.path == "/api/estado":
            with TRAVA:
                foto = FOTO.copy()
            return self.responder(200, foto)
        self.responder(404, {"mensagem": "Página não encontrada."})

    def do_POST(self):
        # Origin é obrigatório no POST; comparar só Origin com Host permitiria DNS rebinding.
        if not self.host_valido() or self.headers.get_all("Origin", []) != ["http://" + self.server.autoridade]:
            return self.responder(403, {"mensagem": "Origem recusada. Abra o painel pelo IP Tailscale."})
        if self.path != "/api/acao":
            return self.responder(404, {"mensagem": "Ação não encontrada."})
        if self.headers.get_content_type() != "application/x-www-form-urlencoded":
            return self.responder(415, {"mensagem": "Formato de pedido inválido."})
        try:
            tamanhos = self.headers.get_all("Content-Length", [])
            if len(tamanhos) != 1 or self.headers.get("Transfer-Encoding"):
                raise ValueError("Tamanho de pedido inválido.")
            tamanho = int(tamanhos[0])
            if not 1 <= tamanho <= 1024:
                raise ValueError("Pedido muito grande ou vazio.")
            bruto = self.rfile.read(tamanho)
            if len(bruto) != tamanho:
                raise ValueError("Pedido incompleto.")
            params = parse_qs(bruto.decode("utf-8"), keep_blank_values=True, strict_parsing=True, max_num_fields=3)
            if not {"agente", "acao"} <= params.keys() or not params.keys() <= {"agente", "acao", "forcar"}:
                raise ValueError("Campos inválidos.")
            if any(len(v) != 1 for v in params.values()):
                raise ValueError("Campos repetidos.")
            nome, acao = params["agente"][0], params["acao"][0]
            forcar = params.get("forcar", ["0"])[0]
            if nome not in AGENTES or acao not in {"ligar", "desligar", "compactar", "nova"} or forcar not in {"0", "1"}:
                raise ValueError("Agente, ação ou forcar inválido.")
        except (ValueError, UnicodeError) as exc:
            return self.responder(400, {"mensagem": str(exc)})
        try:
            if acao in {"ligar", "desligar"}:
                # Mesmo CLI que o boot usa: não existe uma segunda lógica de subir.
                r = rodar([str(PASTA / "agente.sh"), acao, nome], timeout=35)
                if r.returncode:
                    return self.responder(409, {"mensagem": r.stderr.strip() or "Ação não concluída."})
                mensagem = r.stdout.strip()
            else:
                mensagem = enviar(AGENTES[nome], acao, forcar == "1")
            self.responder(200, {"mensagem": mensagem})
        except ValueError as exc:
            self.responder(409, {"mensagem": str(exc)})
        except (OSError, subprocess.SubprocessError) as exc:
            print(f"Ação {acao}/{nome}: {exc}", flush=True)
            self.responder(503, {"mensagem": "Falha ao executar a ação. Consulte o journal do painel."})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    host, porta = ip_tailscale(), CONFIG["porta"]
    servidor = Servidor((host, porta), H)
    servidor.autoridade = f"{host}:{porta}"
    threading.Thread(target=coletar, name="coleta", daemon=True).start()
    print(f"Cockpit em http://{host}:{porta}", flush=True)
    servidor.serve_forever()
