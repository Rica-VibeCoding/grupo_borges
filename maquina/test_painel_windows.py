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
        "ProcessIdToSessionId", "GetTickCount64", "OpenProcess", "CloseHandle",
        "QueryFullProcessImageNameW", "K32GetProcessMemoryInfo")})
    user = SimpleNamespace(**{nome: Mock(return_value=1) for nome in (
        "GetLastInputInfo", "EnumWindows", "IsWindowVisible", "GetWindow",
        "GetWindowLongW", "GetWindowTextW", "GetWindowThreadProcessId")})
    dwm = SimpleNamespace(DwmGetWindowAttribute=Mock(return_value=0))
    monkeypatch.setattr(painel.ctypes, "WinDLL", lambda nome, **_: {
        "kernel32": kernel, "user32": user, "dwmapi": dwm}[nome], raising=False)
    # stdcall/LastError só existem no Windows; o callback ainda cruza C no Linux.
    monkeypatch.setattr(painel.ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE, raising=False)
    erro = [0]
    monkeypatch.setattr(painel.ctypes, "set_last_error", lambda valor: erro.__setitem__(0, valor), raising=False)
    monkeypatch.setattr(painel.ctypes, "get_last_error", lambda: erro[0], raising=False)
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
    assert pc.cpu_pct is None
    pc.amostrar_cpu()
    assert pc.cpu_pct == 80.0
    pc.amostrar_cpu()
    assert pc.cpu_pct is None
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
        "temperatura_c": 50.0, "parados_30min": None,
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
    pc.windows.janelas.return_value = []
    assert servidor() == (200, {"cpu_pct": 12.5})
    status, dados = servidor("/api/maquina/abertos")
    assert status == 200 and dados["itens"] == []
    assert dados["observado_desde"] == pc.observado_desde
    pc.windows.janelas.side_effect = OSError()
    assert servidor("/api/maquina/abertos")[0] == 503
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


def test_cpu_falha_retira_medida_antiga_e_exige_duas_amostras(pc):
    pc.cpu_pct = 85
    pc.windows.cpu_ler.side_effect = OSError('indisponível')
    with pytest.raises(OSError):
        pc.amostrar_cpu()
    assert pc.cpu_pct is None
    pc.windows.cpu_ler.side_effect = [(100, 500), (120, 600)]
    pc.amostrar_cpu()
    assert pc.cpu_pct is None
    pc.amostrar_cpu()
    assert pc.cpu_pct == 80


def test_primeiro_resumo_nao_inventa_cpu_nem_parados(pc, monkeypatch):
    monkeypatch.setattr(painel.shutil, 'disk_usage', lambda _: shutil._ntuple_diskusage(100, 50, 50))
    resumo = pc.resumo()
    assert resumo['cpu_pct'] is None
    assert resumo['parados_30min'] is None


def enumerar(windows, *, estilo=0, dono=0, cloak=0, hr=0, titulo="Documento", hwnd=2**40 + 17):
    windows.user.GetWindowLongW.return_value = estilo
    windows.user.GetWindow.return_value = dono
    windows.user.GetWindowThreadProcessId.side_effect = lambda h, ptr: preencher(ptr, painel.DWORD, value=123)
    windows.user.GetWindowTextW.side_effect = lambda h, buf, n: setattr(buf, "value", titulo) or len(titulo)

    def dwm(h, atributo, ptr, tamanho):
        assert atributo == painel.DWMWA_CLOAKED and tamanho == 4
        preencher(ptr, painel.DWORD, value=cloak)
        return hr

    windows.dwm.DwmGetWindowAttribute.side_effect = dwm
    windows.user.EnumWindows.side_effect = lambda callback, arg: callback(hwnd, arg)


@pytest.mark.parametrize("estilo,dono,incluida", [
    (0, 0, True), (0, 99, False),
    (painel.WS_EX_APPWINDOW, 99, True),
    (painel.WS_EX_TOOLWINDOW, 0, False),
    (painel.WS_EX_TOOLWINDOW | painel.WS_EX_APPWINDOW, 0, False),
    (painel.WS_EX_NOACTIVATE, 0, False),
    (painel.WS_EX_NOACTIVATE | painel.WS_EX_APPWINDOW, 99, True),
])
def test_janelas_owner_e_estilos_da_barra(windows, estilo, dono, incluida):
    enumerar(windows, estilo=estilo, dono=dono)
    janelas = windows.janelas()
    assert bool(janelas) is incluida
    if incluida:
        assert janelas == [{"hwnd": 2**40 + 17, "pid": 123, "titulo": "Documento", "cloaked": False}]
    windows.kernel.OpenProcess.assert_not_called()


def test_janela_invisivel_excluida_mas_sem_titulo_continua(windows):
    enumerar(windows, titulo="")
    assert windows.janelas()[0]["titulo"] == ""
    windows.user.IsWindowVisible.return_value = 0
    assert windows.janelas() == []


@pytest.mark.parametrize("cloak", [1, 2, 4, 7])
def test_cloaked_exclui_todas_as_razoes_documentadas(windows, cloak):
    enumerar(windows, cloak=cloak)
    assert windows.janelas() == []


def test_dwm_falhou_cloaking_desconhecido_nao_usa_buffer(windows):
    enumerar(windows, cloak=7, hr=-2147024891)
    assert windows.janelas()[0]["cloaked"] is None


def test_janela_some_antes_de_ler_estilo_ou_pid(windows):
    enumerar(windows)

    def falhar(*_):
        painel.ctypes.set_last_error(1400)
        return 0

    windows.user.GetWindowLongW.side_effect = falhar
    assert windows.janelas() == []
    windows.user.GetWindowLongW.side_effect = None
    windows.user.GetWindowThreadProcessId.side_effect = None
    windows.user.GetWindowThreadProcessId.return_value = 0
    assert windows.janelas() == []


def test_enum_falha_nao_devolve_inventario_parcial_e_callback_propaga_erro(windows):
    enumerar(windows)
    windows.user.EnumWindows.side_effect = lambda cb, arg: cb(17, arg) and 0
    with pytest.raises(OSError, match="EnumWindows"):
        windows.janelas()
    enumerar(windows)
    windows.user.IsWindowVisible.side_effect = ValueError("erro no callback")
    with pytest.raises(OSError) as erro:
        windows.janelas()
    assert isinstance(erro.value.__cause__, ValueError)


def test_processo_memoria_executavel_unicode_e_handle_64_bits(windows):
    handle = 2**40 + 19
    windows.kernel.OpenProcess.return_value = handle

    def caminho(h, flags, buf, n):
        assert h == handle and flags == 0
        assert ctypes.cast(n, ctypes.POINTER(painel.DWORD)).contents.value == 32768
        buf.value = "C:\\Program Files\\Aplicação\\editor.exe"
        return preencher(n, painel.DWORD, value=len(buf.value))

    def memoria(h, ptr, n):
        assert h == handle
        assert n == 8 + 8 * ctypes.sizeof(ctypes.c_size_t)
        assert ctypes.cast(ptr, ctypes.POINTER(painel.PROCESS_MEMORY_COUNTERS)).contents.cb == n
        return preencher(ptr, painel.PROCESS_MEMORY_COUNTERS, WorkingSetSize=42 * 2**20)

    windows.kernel.QueryFullProcessImageNameW.side_effect = caminho
    windows.kernel.K32GetProcessMemoryInfo.side_effect = memoria
    assert windows.processo(123) == {"executavel": "editor.exe", "memoria_mb": 42.0}
    windows.kernel.OpenProcess.assert_called_once_with(0x1000, False, 123)
    windows.kernel.CloseHandle.assert_called_once_with(handle)
    assert windows.kernel.OpenProcess.restype is ctypes.c_void_p
    assert windows.user.GetWindow.restype is ctypes.c_void_p


def test_processo_acesso_negado_preserva_desconhecidos(windows):
    windows.kernel.OpenProcess.return_value = None
    assert windows.processo(123) == {"executavel": None, "memoria_mb": None}
    windows.kernel.QueryFullProcessImageNameW.assert_not_called()
    windows.kernel.K32GetProcessMemoryInfo.assert_not_called()
    windows.kernel.CloseHandle.assert_not_called()


@pytest.mark.parametrize("nome,mem", [(0, 1), (1, 0), (0, 0)])
def test_falhas_de_consulta_independentes_e_handle_sempre_fechado(windows, nome, mem):
    windows.kernel.QueryFullProcessImageNameW.side_effect = lambda h, f, buf, n: setattr(buf, "value", "a.exe") or nome
    windows.kernel.K32GetProcessMemoryInfo.side_effect = lambda h, ptr, n: preencher(
        ptr, painel.PROCESS_MEMORY_COUNTERS, WorkingSetSize=2**20) and mem
    assert windows.processo(123) == {"executavel": "a.exe" if nome else None,
                                     "memoria_mb": 1.0 if mem else None}
    windows.kernel.CloseHandle.assert_called_once()
    windows.kernel.CloseHandle.reset_mock()
    windows.kernel.QueryFullProcessImageNameW.side_effect = OSError()
    with pytest.raises(OSError):
        windows.processo(123)
    windows.kernel.CloseHandle.assert_called_once()


def test_abertos_agrupa_pid_sem_duplicar_ram_e_preserva_acesso_negado(pc):
    pc.windows.janelas.return_value = [
        {"hwnd": 11, "pid": 7, "titulo": "Um", "cloaked": False},
        {"hwnd": 12, "pid": 7, "titulo": "Dois", "cloaked": None},
        {"hwnd": 13, "pid": 8, "titulo": "Elevado", "cloaked": False},
        {"hwnd": 14, "pid": 9, "titulo": "", "cloaked": False},
    ]
    pc.windows.processo.side_effect = lambda pid: {
        "executavel": "a.exe" if pid == 7 else None, "memoria_mb": 42 if pid == 7 else None}
    leitura = pc.abertos()
    um, elevado, vazio = leitura["itens"]
    assert len(leitura["itens"]) == 3
    assert um["rotulo"] == "a.exe · Um" and um["memoria_mb"] == 42
    assert len(um["janelas"]) == 2 and um["janelas"][1]["cloaked"] is None
    assert elevado["rotulo"] == "Elevado" and elevado["memoria_mb"] is None
    assert vazio["rotulo"] == "Processo 9"
    assert pc.windows.processo.call_count == 3
    for item in leitura["itens"]:
        assert item["acao_rotulo"] is None
        assert item["cpu_pct"] is None and item["parado_s"] is None


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer errada"}])
def test_abertos_exige_chave_antes_de_enumerar(servidor, pc, headers):
    assert servidor("/api/maquina/abertos", headers=headers)[0] == 401
    pc.windows.janelas.assert_not_called()
