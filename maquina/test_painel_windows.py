"""Contrato Windows testado no Linux, sem DLLs nem comandos reais."""

import ctypes
from contextlib import closing
import http.client
import json
import shutil
import subprocess
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import painel_windows as painel


@pytest.fixture(autouse=True)
def sem_comandos_reais(monkeypatch):
    def proibido(*args, **kwargs):
        raise AssertionError("Comando real proibido no teste")

    monkeypatch.setattr(painel.subprocess, "run", proibido)


@pytest.fixture
def windows(monkeypatch):
    kernel = SimpleNamespace(**{nome: Mock(return_value=1) for nome in (
        "GetSystemTimes", "GlobalMemoryStatusEx", "GetCurrentProcessId",
        "ProcessIdToSessionId", "GetTickCount64")})
    user = SimpleNamespace(GetLastInputInfo=Mock(return_value=1))
    monkeypatch.setattr(painel.ctypes, "WinDLL", lambda nome, **_: {
        "kernel32": kernel, "user32": user}[nome], raising=False)
    return painel.Windows()


def preencher(ponteiro, tipo, **campos):
    estrutura = ctypes.cast(ponteiro, ctypes.POINTER(tipo)).contents
    for nome, valor in campos.items():
        setattr(estrutura, nome, valor)
    return 1


def test_get_system_times_soma_kernel_e_user_sem_duplicar_idle(windows):
    def ler(idle, kernel, user):
        preencher(idle, painel.FILETIME, alto=1, baixo=20)
        preencher(kernel, painel.FILETIME, alto=2, baixo=30)
        return preencher(user, painel.FILETIME, baixo=40)

    windows.kernel.GetSystemTimes.side_effect = ler
    assert windows.cpu_ler() == (2**32 + 20, 2 * 2**32 + 70)
    windows.kernel.GetSystemTimes.side_effect = None
    windows.kernel.GetSystemTimes.return_value = 0
    with pytest.raises(OSError):
        windows.cpu_ler()


def test_global_memory_status_ex(windows):
    def ler(ptr):
        assert ctypes.sizeof(painel.MEMORYSTATUSEX) == 64
        assert ctypes.cast(ptr, ctypes.POINTER(painel.MEMORYSTATUSEX)).contents.dwLength == 64
        return preencher(ptr, painel.MEMORYSTATUSEX, ullTotalPhys=16 * 2**30, ullAvailPhys=12 * 2**30)

    windows.kernel.GlobalMemoryStatusEx.side_effect = ler
    assert windows.memoria() == (16 * 2**30, 12 * 2**30)
    windows.kernel.GlobalMemoryStatusEx.side_effect = None
    windows.kernel.GlobalMemoryStatusEx.return_value = 0
    with pytest.raises(OSError):
        windows.memoria()


@pytest.mark.parametrize("segundos", [0, 59, 60, 120])
@pytest.mark.parametrize("uptime", [200_000, 2**32 + 50_000])
def test_tela_sessao_usuario_e_wrap_dos_ticks(windows, segundos, uptime):
    windows.kernel.ProcessIdToSessionId.side_effect = lambda pid, ptr: preencher(ptr, painel.DWORD, value=1)
    windows.kernel.GetTickCount64.return_value = uptime
    windows.user.GetLastInputInfo.side_effect = lambda ptr: preencher(
        ptr, painel.LASTINPUTINFO, dwTime=(uptime - segundos * 1000) & 0xFFFFFFFF)
    assert windows.tela() == {"em_uso": segundos < 60, "ultimo_uso_s": segundos}


@pytest.mark.parametrize("falha", ["servico", "sessao", "input"])
def test_tela_sem_sessao_interativa_retorna_nulls(windows, falha):
    windows.kernel.ProcessIdToSessionId.side_effect = lambda pid, ptr: preencher(
        ptr, painel.DWORD, value=0 if falha == "servico" else 1)
    if falha == "sessao":
        windows.kernel.ProcessIdToSessionId.side_effect = None
        windows.kernel.ProcessIdToSessionId.return_value = 0
    if falha == "input":
        windows.user.GetLastInputInfo.return_value = 0
    assert windows.tela() == {"em_uso": None, "ultimo_uso_s": None}
    if falha != "input":
        windows.user.GetLastInputInfo.assert_not_called()


@pytest.fixture
def pc(tmp_path, monkeypatch):
    api = Mock()
    api.memoria.return_value = (16000 * 2**20, 12000 * 2**20)
    api.tela.return_value = {"em_uso": None, "ultimo_uso_s": None}
    chave = tmp_path / ".config/cockpit-maquina/chave"
    chave.parent.mkdir(parents=True)
    chave.write_text("segredo-de-teste\n")
    monkeypatch.setattr(painel.Path, "home", lambda: tmp_path)
    return painel.Painel(api)


def test_cpu_amostras_em_segundo_plano(pc):
    pc.windows.cpu_ler.side_effect = [(100, 500), (120, 600), (120, 600), (120, 700)]
    pc.amostrar_cpu()
    assert pc.cpu_pct == 0.0
    pc.amostrar_cpu()
    assert pc.cpu_pct == 80.0
    pc.amostrar_cpu()
    assert pc.cpu_pct == 80.0
    pc.amostrar_cpu()
    assert pc.cpu_pct == 100.0


@pytest.mark.parametrize("saida,esperado", [
    ("3132\n3232\n", 50.05), ("", None), ("0\n99999\n", None),
    ("nan\ninf\n", None), ("inválido", None), ("0\n3132\n", 40.05),
])
def test_temperatura_converte_kelvin_filtra_absurdos_e_cacheia(pc, monkeypatch, saida, esperado):
    agora = [0.0]
    monkeypatch.setattr(painel.time, "monotonic", lambda: agora[0])
    rodar = Mock(return_value=subprocess.CompletedProcess([], 0, saida, ""))
    monkeypatch.setattr(painel.subprocess, "run", rodar)
    pc.amostrar_temperatura()
    assert pc.temperatura_c == esperado
    args, kwargs = rodar.call_args
    assert args[0][0] == "powershell"
    assert "Get-CimInstance -Namespace root/wmi" in args[0][-1]
    assert kwargs["timeout"] == 5 and kwargs["check"] is True
    agora[0] = 59.9
    pc.amostrar_temperatura()
    assert rodar.call_count == 1
    agora[0] = 60
    pc.amostrar_temperatura()
    assert rodar.call_count == 2


@pytest.mark.parametrize("erro", [OSError(), subprocess.TimeoutExpired("powershell", 5),
                                subprocess.CalledProcessError(1, "powershell")])
def test_temperatura_falha_tambem_tem_cache(pc, monkeypatch, erro):
    rodar = Mock(side_effect=erro)
    monkeypatch.setattr(painel.subprocess, "run", rodar)
    pc.temperatura_c = 40
    pc.amostrar_temperatura()
    pc.amostrar_temperatura()
    assert pc.temperatura_c is None
    assert rodar.call_count == 1


def test_resumo_mesmo_contrato_linux_e_disco_c(pc, monkeypatch):
    disco = Mock(return_value=shutil._ntuple_diskusage(100000 * 2**20, 10000 * 2**20, 90000 * 2**20))
    monkeypatch.setattr(painel.shutil, "disk_usage", disco)
    monkeypatch.setattr(painel.time, "time", lambda: 1234.5)
    pc.cpu_pct, pc.temperatura_c = 12.5, 50.0
    assert pc.resumo() == {
        "cpu_pct": 12.5,
        "ram": {"usado_mb": 4000, "livre_mb": 12000, "total_mb": 16000, "pct": 25.0},
        "disco": {"usado_mb": 10000, "livre_mb": 90000, "total_mb": 100000, "pct": 10.0},
        "temperatura_c": 50.0, "parados_30min": 0,
        "tela": {"em_uso": None, "ultimo_uso_s": None}, "medido_em": 1234,
    }
    disco.assert_called_once_with("C:/")
    pc.windows.cpu_ler.assert_not_called()


@pytest.fixture
def servidor(pc):
    with painel.Servidor(("127.0.0.1", 0), painel.H) as server:
        host, porta = server.server_address
        server.autoridade = f"{host}:{porta}"
        server.painel = pc
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()

        def pedir(caminho="/api/maquina/resumo", headers=None, metodo="GET"):
            with closing(http.client.HTTPConnection(host, porta, timeout=2)) as conexao:
                conexao.request(metodo, caminho, headers=headers if headers is not None else {
                    "Authorization": "Bearer segredo-de-teste"})
                resposta = conexao.getresponse()
                return resposta.status, json.loads(resposta.read())

        try:
            yield pedir
        finally:
            server.shutdown()
            thread.join(timeout=2)


def test_http_resumo_e_abertos(servidor, pc):
    pc.resumo = Mock(return_value={"cpu_pct": 12.5})
    assert servidor() == (200, {"cpu_pct": 12.5})
    assert servidor("/api/maquina/abertos") == (501, {"mensagem": "o PC ainda não lista o que está aberto"})
    pc.resumo.side_effect = OSError()
    assert servidor()[0] == 503


@pytest.mark.parametrize("caminho", ["/", "/api/maquina/resumo/", "/api/maquina/fechar", "/api/estado"])
def test_http_outros_caminhos_404(servidor, caminho):
    assert servidor(caminho)[0] == 404
    assert servidor(caminho, metodo="POST")[0] == 404


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer errada"},
                                    {"Authorization": "Basic segredo-de-teste"}])
def test_http_chave_errada_401(servidor, headers):
    assert servidor(headers=headers)[0] == 401


@pytest.mark.parametrize("problema", ["ausente", "vazia", "grande"])
def test_http_chave_indisponivel_503(servidor, pc, problema):
    if problema == "ausente":
        pc.chave.unlink()
    else:
        pc.chave.write_text("\n" if problema == "vazia" else "a" * 4097)
    assert servidor()[0] == 503


def test_autorizacao_duplicada_recusada_e_comparacao_constante(pc, monkeypatch):
    comparar = Mock(wraps=painel.hmac.compare_digest)
    monkeypatch.setattr(painel.hmac, "compare_digest", comparar)
    pc.autorizar(["Bearer segredo-de-teste"])
    comparar.assert_called_once_with(b"Bearer segredo-de-teste", b"Bearer segredo-de-teste")
    with pytest.raises(painel.Falha) as erro:
        pc.autorizar(["Bearer segredo-de-teste"] * 2)
    assert erro.value.status == 401


def test_http_host_recusado(servidor):
    assert servidor(headers={"Host": "externo.test", "Authorization": "Bearer segredo-de-teste"})[0] == 403


def test_descoberta_ip_tailscale(monkeypatch):
    rodar = Mock(return_value=subprocess.CompletedProcess([], 0, "192.168.1.1\n100.118.54.91\n", ""))
    monkeypatch.setattr(painel.subprocess, "run", rodar)
    assert painel.ip_tailscale() == "100.118.54.91"
    assert rodar.call_args.args[0] == ["tailscale", "ip", "-4"]


def test_descoberta_tenta_caminho_windows_e_falha_fechado(monkeypatch):
    rodar = Mock(side_effect=[FileNotFoundError(), subprocess.CompletedProcess([], 0, "100.118.54.91", "")])
    monkeypatch.setattr(painel.subprocess, "run", rodar)
    assert painel.ip_tailscale() == "100.118.54.91"
    assert rodar.call_args.args[0][0].endswith("Tailscale/tailscale.exe")
    rodar.side_effect = OSError()
    with pytest.raises(ValueError, match="indisponível"):
        painel.ip_tailscale()


@pytest.mark.parametrize("host", ["0.0.0.0", "127.0.0.1", "192.168.1.1", "100.1.1.1", "::", "inválido"])
def test_host_fora_da_tailnet_recusado(host):
    with pytest.raises(ValueError):
        painel.host_tailscale(host)
