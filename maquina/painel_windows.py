#!/usr/bin/env python3
r"""Resumo do PC, só stdlib. Iniciar na sessão do usuário: python painel_windows.py.

Chave em %USERPROFILE%\.config\cockpit-maquina\chave (Authorization: Bearer).
Sem Tailscale, falha fechado; --host permite fixar o IPv4 da tailnet.
"""

import argparse
import ctypes
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time


TAILNET = ipaddress.ip_network("100.64.0.0/10")
PORTA = 8787
INTERVALO = 3


def host_tailscale(valor):
    ip = ipaddress.IPv4Address(valor)
    if ip not in TAILNET:
        raise ValueError("Informe um IPv4 Tailscale (100.64.0.0/10).")
    return str(ip)


def ip_tailscale():
    executaveis = ["tailscale", str(Path(os.environ.get("ProgramFiles", "C:/Program Files"))
                                  / "Tailscale/tailscale.exe")]
    for executavel in executaveis:
        try:
            r = subprocess.run([executavel, "ip", "-4"], capture_output=True, text=True,
                               timeout=5, check=True)
            for linha in r.stdout.split():
                try:
                    return host_tailscale(linha)
                except ValueError:
                    continue
        except (OSError, subprocess.SubprocessError):
            pass
    raise ValueError("IPv4 Tailscale indisponível; use --host com o IP da máquina.")


# Tipos de largura fixa: o DWORD do Windows tem 32 bits, inclusive em Python 64 bits.
DWORD = ctypes.c_uint32
BOOL = ctypes.c_int32


class FILETIME(ctypes.Structure):
    _fields_ = [("baixo", DWORD), ("alto", DWORD)]

    def ticks(self):
        return (self.alto << 32) | self.baixo


class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [("dwLength", DWORD), ("dwMemoryLoad", DWORD)] + [
        (nome, ctypes.c_uint64) for nome in (
            "ullTotalPhys", "ullAvailPhys", "ullTotalPageFile", "ullAvailPageFile",
            "ullTotalVirtual", "ullAvailVirtual", "ullAvailExtendedVirtual")]


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", DWORD), ("dwTime", DWORD)]


class Windows:
    def __init__(self):
        # DLLs só são carregadas na inicialização, permitindo importar/testar no Linux.
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.user = ctypes.WinDLL("user32", use_last_error=True)
        for dll, nome, args, resultado in (
            (self.kernel, "GetSystemTimes", [ctypes.POINTER(FILETIME)] * 3, BOOL),
            (self.kernel, "GlobalMemoryStatusEx", [ctypes.POINTER(MEMORYSTATUSEX)], BOOL),
            (self.kernel, "GetCurrentProcessId", [], DWORD),
            (self.kernel, "ProcessIdToSessionId", [DWORD, ctypes.POINTER(DWORD)], BOOL),
            (self.kernel, "GetTickCount64", [], ctypes.c_uint64),
            (self.user, "GetLastInputInfo", [ctypes.POINTER(LASTINPUTINFO)], BOOL),
        ):
            funcao = getattr(dll, nome)
            funcao.argtypes, funcao.restype = args, resultado

    def cpu_ler(self):
        idle, kernel, user = FILETIME(), FILETIME(), FILETIME()
        if not self.kernel.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
            raise OSError("GetSystemTimes falhou")
        # Kernel já inclui idle: total = kernel + user.
        return idle.ticks(), kernel.ticks() + user.ticks()

    def memoria(self):
        mem = MEMORYSTATUSEX()
        mem.dwLength = ctypes.sizeof(mem)
        if not self.kernel.GlobalMemoryStatusEx(ctypes.byref(mem)):
            raise OSError("GlobalMemoryStatusEx falhou")
        return mem.ullTotalPhys, mem.ullAvailPhys

    def tela(self):
        desconhecida = {"em_uso": None, "ultimo_uso_s": None}
        sessao = DWORD()
        if (not self.kernel.ProcessIdToSessionId(self.kernel.GetCurrentProcessId(), ctypes.byref(sessao))
                or sessao.value == 0):
            return desconhecida  # Serviços não observam a sessão interativa.
        info = LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(info)
        if not self.user.GetLastInputInfo(ctypes.byref(info)):
            return desconhecida
        # LASTINPUTINFO usa ticks de 32 bits, que dão a volta a cada 49,7 dias.
        segundos = ((self.kernel.GetTickCount64() - info.dwTime) & 0xFFFFFFFF) // 1000
        return {"em_uso": segundos < 60, "ultimo_uso_s": segundos}


class Falha(Exception):
    def __init__(self, status, mensagem):
        super().__init__(mensagem)
        self.status, self.mensagem = status, mensagem


def recurso(total, livre):
    total, livre = total / 2**20, livre / 2**20
    return {"usado_mb": round(total - livre, 2), "livre_mb": round(livre, 2),
            "total_mb": round(total, 2), "pct": round(100 * (total - livre) / total, 2)}


class Painel:
    def __init__(self, windows, *, chave=None):
        self.windows = windows
        self.chave = Path(chave) if chave is not None else Path.home() / ".config/cockpit-maquina/chave"
        self.cpu_pct = None
        self.temperatura_c = None
        self._anterior = None
        self._temperatura_em = None
        self._trava = threading.Lock()

    def autorizar(self, autorizacoes):
        try:
            with self.chave.open("rb") as arquivo:
                chave = arquivo.read(4097).strip()
            if not chave or len(chave) > 4096:
                raise ValueError("chave vazia ou muito grande")
        except (OSError, ValueError):
            raise Falha(503, "Chave do painel indisponível.") from None
        recebido = autorizacoes[0].encode("utf-8") if len(autorizacoes) == 1 else b""
        if not hmac.compare_digest(recebido, b"Bearer " + chave):
            raise Falha(401, "Chave inválida ou ausente.")

    def amostrar_cpu(self):
        try:
            atual = self.windows.cpu_ler()
        except OSError:
            with self._trava:
                self._anterior, self.cpu_pct = None, None
            raise
        anterior, self._anterior = self._anterior, atual
        pct = None
        if anterior and atual[1] > anterior[1]:
            pct = round(max(0, min(100, 100 * (1 - (atual[0] - anterior[0]) / (atual[1] - anterior[1])))), 2)
        with self._trava:
            self.cpu_pct = pct

    def amostrar_temperatura(self):
        agora = time.monotonic()
        if self._temperatura_em is not None and agora - self._temperatura_em < 60:
            return
        valor = None
        try:
            r = subprocess.run([
                "powershell", "-NoProfile", "-NonInteractive", "-Command",
                "Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature "
                "-ErrorAction Stop | Select-Object -ExpandProperty CurrentTemperature",
            ], capture_output=True, text=True, timeout=5, check=True)
            valores = [float(linha) / 10 - 273.15 for linha in r.stdout.split()]
            validos = [t for t in valores if -20 < t < 150]
            valor = round(max(validos), 2) if validos else None
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
        with self._trava:
            self.temperatura_c = valor
        self._temperatura_em = time.monotonic()  # Também guarda falhas por 60 s.

    def coletar(self):
        while True:
            try:
                self.amostrar_cpu()
            except OSError:
                self._anterior = None
            self.amostrar_temperatura()
            time.sleep(INTERVALO)

    def resumo(self):
        total, livre = self.windows.memoria()
        disco = shutil.disk_usage("C:/")
        with self._trava:
            cpu, temperatura = self.cpu_pct, self.temperatura_c
        return {"cpu_pct": cpu, "ram": recurso(total, livre),
                "disco": recurso(disco.total, disco.free), "temperatura_c": temperatura,
                "parados_30min": None, "tela": self.windows.tela(), "medido_em": int(time.time())}


class Servidor(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class H(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def responder(self, codigo, dados):
        corpo = json.dumps(dados, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        if self.path not in {"/api/maquina/resumo", "/api/maquina/abertos"}:
            return self.responder(404, {"mensagem": "Página não encontrada."})
        if self.headers.get_all("Host", []) != [self.server.autoridade]:
            return self.responder(403, {"mensagem": "Host recusado. Use o IP Tailscale e a porta do painel."})
        try:
            self.server.painel.autorizar(self.headers.get_all("Authorization", []))
            if self.path == "/api/maquina/abertos":
                return self.responder(501, {"mensagem": "o PC ainda não lista o que está aberto"})
            return self.responder(200, self.server.painel.resumo())
        except Falha as exc:
            return self.responder(exc.status, {"mensagem": exc.mensagem})
        except OSError:
            return self.responder(503, {"mensagem": "Não foi possível consultar a máquina."})

    def do_POST(self):
        return self.responder(404, {"mensagem": "Página não encontrada."})

    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", help="IPv4 Tailscale para o bind (porta 8787)")
    args = parser.parse_args()
    # No logon a Tailscale pode ainda não ter IP: sem esperar, o painel saía
    # com código 2 e o PC ficava sem dados no cockpit até alguém religar (06/11).
    prazo = time.monotonic() + 600
    while True:
        try:
            host = host_tailscale(args.host) if args.host else ip_tailscale()
            break
        except ValueError as exc:
            if args.host or time.monotonic() > prazo:
                parser.error(str(exc))
            time.sleep(10)
    painel = Painel(Windows())
    with Servidor((host, PORTA), H) as servidor:
        servidor.autoridade = f"{host}:{PORTA}"
        servidor.painel = painel
        threading.Thread(target=painel.coletar, name="coleta", daemon=True).start()
        print(f"Cockpit em http://{host}:{PORTA}", flush=True)
        servidor.serve_forever()


if __name__ == "__main__":
    main()
