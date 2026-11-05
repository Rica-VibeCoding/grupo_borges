"""Fixtures Linux e CDP local falso; nenhum teste sinaliza processos reais."""

import base64
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import types

import pytest

import maquinas
from maquinas import Falha, Maquinas


@pytest.fixture(autouse=True)
def sem_efeitos_reais(monkeypatch):
    def proibido(*args, **kwargs):
        raise AssertionError("Operação real proibida no teste")

    monkeypatch.setattr(os, "pidfd_open", proibido)
    monkeypatch.setattr(signal, "pidfd_send_signal", proibido)
    monkeypatch.setattr(os, "kill", proibido)
    monkeypatch.setattr(maquinas.subprocess, "run", proibido)
    monkeypatch.setattr(maquinas, "json_cdp", proibido)


@pytest.fixture
def linux(tmp_path, monkeypatch):
    home, proc, cg, runtime = [tmp_path / n for n in ("home", "proc", "cgroup", "run")]
    for p in (home, proc, cg, runtime):
        p.mkdir()
    (proc / "meminfo").write_text("MemTotal: 8192000 kB\nMemAvailable: 4096000 kB\n")
    agora = [10_000.0, 0.0]
    m = Maquinas(home=home, proc=proc, cgroup=cg, runtime=runtime,
                 agentes=[{"id": "fluytcom", "nome": "Fluyt"}],
                 relogio=lambda: agora[0], monotono=lambda: agora[1])
    m.chave.parent.mkdir(parents=True)
    m.chave.write_text("segredo-de-teste\n")
    m.chave.chmod(0o600)
    (runtime / "hypr/sessao-teste").mkdir(parents=True)
    janelas = []
    chamadas = []
    ativo = [True]

    def rodar(cmd, **kwargs):
        chamadas.append((cmd, kwargs))
        env = kwargs["env"]
        assert env["XDG_RUNTIME_DIR"] == str(runtime)
        if cmd == ["hyprctl", "clients", "-j"]:
            assert env["HYPRLAND_INSTANCE_SIGNATURE"] == "sessao-teste"
            return subprocess.CompletedProcess(cmd, 0, json.dumps(janelas), "")
        assert cmd == ["systemctl", "--user", "is-active", "cockpit-maquina-idle.service"]
        return subprocess.CompletedProcess(cmd, 0 if ativo[0] else 3, "active\n" if ativo[0] else "inactive\n", "")

    monkeypatch.setattr(maquinas.subprocess, "run", rodar)

    def processo(pid, *, ppid=1, inicio=None, args=("foot",), pss=1024, swap=512, cpu=1000,
                 titulo_unico=False):
        pasta = proc / str(pid)
        pasta.mkdir(exist_ok=True)
        inicio = pid * 10 if inicio is None else inicio
        # comm com parêntese e espaço: parser não pode dar split no stat inteiro.
        campos = ["S", str(ppid)] + ["0"] * 17 + [str(inicio)]
        (pasta / "stat").write_text(f"{pid} (nome (com espaço)) " + " ".join(campos))
        texto = " ".join(args) if titulo_unico else "\0".join(args)
        (pasta / "cmdline").write_text(texto + "\0")
        (pasta / "smaps_rollup").write_text(
            f"Rss: 999999 kB\nPss: {pss} kB\nPss_Anon: 999999 kB\nSwapPss: {swap} kB\n")
        (pasta / "schedstat").write_text(f"{cpu} 0 1\n")
        return pasta

    def scope(nome, *pids):
        pasta = cg / nome
        pasta.mkdir(parents=True, exist_ok=True)
        (pasta / "cgroup.procs").write_text("\n".join(str(p) for p in pids))
        return pasta

    def chrome(pid=100, perfil="fluytcom", porta=9225, headless=False, nome=None):
        args = ["/opt/google/chrome/chrome", f"--user-data-dir={home}/.config/ze-chrome-{perfil}",
                f"--remote-debugging-port={porta}"]
        if headless:
            args.append("--headless=new")
        processo(pid, args=args, titulo_unico=True)
        return scope(nome or f"app.slice/app-chrome-{pid}.scope", pid)

    return types.SimpleNamespace(m=m, agora=agora, processo=processo, scope=scope, chrome=chrome,
                                 janelas=janelas, chamadas=chamadas, ativo=ativo)


def falha(status, fn, *args):
    with pytest.raises(Falha) as e:
        fn(*args)
    assert e.value.status == status
    assert e.value.mensagem


@pytest.mark.parametrize("header", [[], ["Bearer errada"], ["Basic segredo-de-teste"],
                                    ["Bearer segredo-de-teste"] * 2, ["Bearer á"]])
def test_chave_errada_401(linux, header):
    falha(401, linux.m.autorizar, header)


def test_autenticacao_compare_digest(linux, monkeypatch):
    comparacoes = []
    original = maquinas.hmac.compare_digest

    def comparar(a, b):
        comparacoes.append((a, b))
        return original(a, b)

    monkeypatch.setattr(maquinas.hmac, "compare_digest", comparar)
    linux.m.autorizar(["Bearer segredo-de-teste"])
    assert comparacoes == [(b"Bearer segredo-de-teste", b"Bearer segredo-de-teste")]


@pytest.mark.parametrize("problema", ["ausente", "modo", "vazia", "symlink"])
def test_chave_indisponivel_503(linux, problema):
    chave = linux.m.chave
    if problema == "ausente":
        chave.unlink()
    elif problema == "modo":
        chave.chmod(0o644)
    elif problema == "vazia":
        chave.write_text("\n")
    else:
        destino = chave.with_name("outra")
        chave.rename(destino)
        chave.symlink_to(destino)
    falha(503, linux.m.autorizar, [])


def test_abertos_scope_pss_swap_cdp_headless_e_nomes(linux, monkeypatch):
    linux.chrome()
    linux.processo(101, ppid=100, args=("chrome", "--type=renderer"), pss=2048, swap=1024)
    # Crashpad reparentado, mas no mesmo cgroup: entra na soma.
    linux.processo(102, ppid=1, args=("chrome_crashpad_handler",), pss=512, swap=0)
    linux.scope("app.slice/app-chrome-100.scope", 100, 101, 102)
    linux.chrome(200, "fluytfin", 9226, headless=True)
    portas = []

    def cdp(porta, caminho):
        portas.append((porta, caminho))
        return [{"type": "page", "title": "Título " * 12},
                {"type": "service_worker", "title": "ignorar"}, {"type": "browser_ui"}]

    monkeypatch.setattr(maquinas, "json_cdp", cdp)
    resultado = linux.m.abertos()
    assert resultado["observado_desde"] == 10000
    com, fin = resultado["itens"]
    assert com["rotulo"] == "Chrome do Fluyt Com"
    assert com["dono"] == "Fluyt"
    assert com["memoria_mb"] == 5.0
    assert fin["grupo"] == com["grupo"] == "agente"
    assert fin["rotulo"] == "Chrome do Fluyt Fin"
    assert len(com["abas"]) == 1 and len(com["abas"][0]) == 40
    assert com["acao_rotulo"] == "Fechar Chrome do Fluyt Com"
    assert com["parado_s"] is None and not com["pede_confirmacao"]
    assert portas == [(9225, "/json/list"), (9226, "/json/list")]


def test_perfil_argumentos_separados_e_caminho_exato(linux):
    linux.processo(10, args=("chrome", "--user-data-dir", "~/.config/ze-chrome", "--remote-debugging-port", "9222"))
    linux.scope("app.slice/chrome.scope", 10)
    scope = linux.m.scopes()[0]
    assert linux.m.perfil(scope.principal) == "agente"
    assert linux.m.porta(scope) == 9222
    for args in [("chrome", "--user-data-dir=/tmp/ze-chrome-fluytcom"),
                 ("echo", f"--user-data-dir={linux.m.home}/.config/ze-chrome-fluytcom"),
                 ("chrome", f"--user-data-dir={linux.m.home}/.config/ze-chrome-fluytcom", "--type=renderer")]:
        linux.processo(10, args=args)
        assert linux.m.classificar(linux.m.scopes()[0], {}) == "protegido"


def test_chrome_pessoal_com_cdp_tambem_lista_abas(linux, monkeypatch):
    linux.processo(10, args=("chrome", "--remote-debugging-port=9222"))
    linux.scope("app.slice/chrome.scope", 10)
    linux.janelas.append({"pid": 10, "class": "google-chrome"})
    monkeypatch.setattr(maquinas, "json_cdp", lambda *a: [{"type": "page", "title": "Pessoal"}])
    item = linux.m.abertos()["itens"][0]
    assert item["grupo"] == "seus" and item["abas"] == ["Pessoal"]
    assert item["rotulo"] == "Chrome pessoal"


def test_janela_exige_app_slice_e_env_hyprland(linux):
    linux.processo(10)
    linux.scope("app.slice/terminal.scope", 10)
    linux.janelas.append({"pid": 10, "class": "foot"})
    item = linux.m.abertos()["itens"][0]
    assert item["grupo"] == "seus" and item["rotulo"] == "Terminal"
    assert linux.chamadas[0][1]["env"]["HYPRLAND_INSTANCE_SIGNATURE"] == "sessao-teste"
    linux.janelas.clear()
    assert linux.m.abertos()["itens"][0]["grupo"] == "protegido"
    shutil.rmtree(linux.m.cgroup / "app.slice")
    linux.scope("background.slice/terminal.scope", 10)
    linux.janelas.append({"pid": 10})
    assert linux.m.abertos()["itens"][0]["grupo"] == "protegido"


@pytest.mark.parametrize("agente,nome,esperado", [
    ("estudio", "Estúdio", "Estúdio"), ("note", "Omarchy", "Omarchy"),
    ("fluytcom", "Fluyt Com", "Fluyt Com"), ("novo-agente", None, "Novo Agente"),
])
def test_rotulo_scope_agente_usa_config_antes_do_processo_e_perfil(linux, agente, nome, esperado):
    if nome is not None:
        linux.m.agentes[agente] = nome
    linux.chrome(nome=f"app.slice/cockpit-tmux-{agente}-a1b2.scope")
    linux.processo(101, ppid=100, args=("bun",))
    linux.scope(f"app.slice/cockpit-tmux-{agente}-a1b2.scope", 100, 101)
    assert linux.m.rotulo(linux.m.scopes()[0], {}) == ("Agente " + esperado, esperado)


@pytest.mark.parametrize("unidade,esperado", [
    ("cockpit-maquina.service", "Painel desta máquina"),
    ("cockpit-api.service", "API do cockpit local"), ("cockpit-v2.service", "Cockpit local"),
    ("cockpit-maquina-idle.service", "Vigia de teclado e mouse"),
    ("tailscaled.service", "Tailscale"), ("sshd.service", "Acesso SSH"),
    ("sshd@conexao.service", "Acesso SSH"),
    ("pipewire.service", "Som (PipeWire)"), ("pipewire-pulse.service", "Som (PulseAudio)"),
    ("wireplumber.service", "Som (WirePlumber)"),
    ("gnome-keyring-daemon.service", "Chaveiro de senhas"),
    ("gnome-keyring-daemon@ssh.service", "Chaveiro de senhas"),
    ("ze_claude.service", "Pasta da VPS (sshfs)"),
    ("tmux-spawn-45bb3e23-2f45-4847.scope", "Sessões de terminal (agentes)"),
    ("init.scope", "Sistema"), ("systemd.service", "Sistema"),
    ("systemd-user.service", "Sistema"), ("dbus.service", "Sistema"),
    ("dbus-broker.service", "Sistema"), ("dbus-broker-launch.service", "Sistema"),
    ("xdg-desktop-portal.service", "Serviços da sessão (portais)"),
    ("xdg-desktop-portal-hyprland.service", "Serviços da sessão (portais)"),
    ("xdg-document-portal.service", "Serviços da sessão (documentos)"),
    ("xdg-permission-store.service", "Serviços da sessão (permissões)"),
    ("gvfs-daemon.service", "Serviços da sessão (arquivos)"),
    ("gvfsd.service", "Serviços da sessão (arquivos)"),
    ("at-spi-dbus-bus.service", "Serviços da sessão (acessibilidade)"),
    ("at-spi-bus-launcher.service", "Serviços da sessão (acessibilidade)"),
])
def test_rotulo_servico_usa_unit_antes_do_executavel_e_janela(linux, unidade, esperado):
    linux.processo(10, args=("python3",))
    linux.scope("session.slice/" + unidade, 10)
    assert linux.m.rotulo(linux.m.scopes()[0], {10: {"class": "foot"}}) == (esperado, None)


@pytest.mark.parametrize("unidade,exe,esperado", [
    ("backup-diario.service", "python", "Backup diario"),
    ("sincronizar_arquivos.service", "python3", "Sincronizar arquivos"),
    ("portal-local.service", "next-server", "Portal local"),
    ("sshfs-dados.service", "sshfs", "Sshfs dados"),
    ("outro-agente.scope", "bun", "Outro agente"),
    ("outra-sessao.scope", "claude", "Outra sessao"),
    (r"backup\x2ddiario@casa.service", "python", "Backup diario casa"),
])
def test_rotulo_desconhecido_usa_unit_legivel(linux, unidade, exe, esperado):
    linux.processo(10, args=(exe,))
    linux.scope("app.slice/" + unidade, 10)
    assert linux.m.rotulo(linux.m.scopes()[0], {10: {"class": "python"}}) == (esperado, None)


@pytest.mark.parametrize("nome,args", [
    ("app.slice/cockpit-tmux-fluytcom-abc.scope", ("chrome",)),
    ("app.slice/cockpit-maquina.service", ("python3", "painel.py")),
    ("app.slice/cockpit-api.service", ("python3",)),
    ("app.slice/manual.scope", ("python3", "painel.py")),
    ("session.slice/wayland.service", ("foot",)),
    ("app.slice/tmux-spawn.scope", ("claude",)),
    ("app.slice/bot.scope", ("bun", "server.ts")),
    ("app.slice/ssh.scope", ("sshd",)),
    ("app.slice/tail.scope", ("tailscaled",)),
    ("app.slice/wm.scope", ("Hyprland",)),
    ("app.slice/barra.scope", ("quickshell",)),
    ("app.slice/shell.scope", ("bash", "/usr/share/omarchy/bin/omarchy-launch-shell")),
    ("app.slice/audio.scope", ("pipewire",)),
    ("app.slice/audio.scope", ("wireplumber",)),
    ("app.slice/x.scope", ("Xwayland",)),
    ("app.slice/idle.scope", ("hypridle",)),
])
def test_protegido_prevalece_sobre_janela(linux, nome, args):
    linux.processo(10, args=args)
    linux.scope(nome, 10)
    linux.janelas.append({"pid": 10, "class": "foot"})
    item = linux.m.abertos()["itens"][0]
    assert item["grupo"] == "protegido" and item["acao_rotulo"] is None
    falha(403, linux.m.fechar, item["id"])


def test_chrome_em_scope_cockpit_ou_com_bun_e_protegido(linux, monkeypatch):
    linux.chrome(nome="app.slice/cockpit-tmux-x-abc.scope")
    monkeypatch.setattr(maquinas, "json_cdp", lambda *a: [])
    item = linux.m.abertos()["itens"][0]
    assert item["grupo"] == "protegido"
    falha(403, linux.m.fechar, item["id"])


@pytest.mark.parametrize("exe,classe", [("code", "code"), ("soffice.bin", "libreoffice-writer")])
def test_confirmacao_editor(linux, exe, classe):
    linux.processo(10, args=(exe,))
    linux.scope("app.slice/editor.scope", 10)
    linux.janelas.append({"pid": 10, "class": classe})
    assert linux.m.abertos()["itens"][0]["pede_confirmacao"] is True


def test_id_muda_com_starttime_e_nao_com_pid_ou_ordem(linux):
    linux.processo(10, inicio=123)
    linux.scope("app.slice/a.scope", 10)
    primeiro = linux.m.scopes()[0].id
    assert re.fullmatch(r"[A-Za-z0-9_-]{16}", primeiro)
    linux.processo(10, inicio=124)
    segundo = linux.m.scopes()[0].id
    assert primeiro != segundo
    falha(404, linux.m.fechar, primeiro)
    falha(404, linux.m.fechar, "forjado")


def test_subcgroup_sem_duplicar_e_principal_por_parentesco(linux):
    linux.processo(100, inicio=200)
    linux.processo(50, ppid=100, inicio=100)  # PID menor não significa principal.
    linux.scope("app.slice/a.scope", 100)
    filho = linux.scope("app.slice/a.scope/subgrupo", 50)
    scopes = linux.m.scopes()
    assert len(scopes) == 1 and scopes[0].principal.pid == 100
    assert linux.m.memoria(scopes[0]) == 3
    (linux.m.proc / "50/smaps_rollup").unlink()
    assert linux.m.memoria(scopes[0]) == 1.5
    (filho / "cgroup.procs").write_text("")
    shutil.rmtree(linux.m.proc / "50")
    assert len(linux.m.scopes()) == 1


def test_amostras_60s_limiar_parados_30min_sem_pss_cdp(linux, monkeypatch):
    linux.processo(10)
    linux.scope("app.slice/a.scope", 10)
    linux.janelas.append({"pid": 10})
    item_id = linux.m.scopes()[0].id
    linux.m.amostrar()
    assert linux.m.parado(item_id) is None
    for segundo in range(60, 1801, 60):
        linux.agora[1] = segundo
        (linux.m.proc / "10/schedstat").write_text(f"{1000 + segundo * 1000} 0 0")
        linux.m.amostrar()
    assert linux.m.parado(item_id) == 1800
    assert not linux.chamadas  # Nem hyprctl é necessário na amostra.
    monkeypatch.setattr(maquinas.shutil, "disk_usage", lambda _: shutil._ntuple_diskusage(100 * 2**20, 25 * 2**20, 75 * 2**20))
    resumo = linux.m.resumo(12.5, 51)
    assert resumo["parados_30min"] == 1
    assert resumo["cpu_pct"] == 12.5 and resumo["temperatura_c"] == 51
    assert resumo["ram"] == {"usado_mb": 4000, "livre_mb": 4000, "total_mb": 8000, "pct": 50}
    assert resumo["disco"] == {"usado_mb": 25, "livre_mb": 75, "total_mb": 100, "pct": 25}
    assert resumo["medido_em"] == 10000
    linux.agora[1] = 1830
    (linux.m.proc / "10/schedstat").write_text("99999999999 0 0")
    linux.m.amostrar()  # Menos de 60s: não amostra nem extrapola.
    assert linux.m.parado(item_id) == 1800
    linux.agora[1] = 1860
    linux.m.amostrar()
    assert linux.m.parado(item_id) is None
    assert linux.m.resumo(0, None)["parados_30min"] == 0


@pytest.mark.parametrize("delta,dormindo", [(599999999, True), (600000000, False), (600000001, False)])
def test_limiar_exato_e_soma_cpu_do_scope(linux, delta, dormindo):
    linux.processo(10, cpu=0)
    linux.processo(11, ppid=10, cpu=0)
    linux.scope("app.slice/a.scope", 10, 11)
    item_id = linux.m.scopes()[0].id
    linux.m.amostrar()
    linux.agora[1] = 60
    (linux.m.proc / "10/schedstat").write_text(f"{delta // 2} 0 0")
    (linux.m.proc / "11/schedstat").write_text(f"{delta - delta // 2} 0 0")
    linux.m.amostrar()
    assert linux.m.parado(item_id) == (60 if dormindo else None)


def test_amostra_some_reinicio_e_novo_pid_nao_produzem_idle_falso(linux):
    linux.processo(10, cpu=0)
    pasta = linux.scope("app.slice/a.scope", 10)
    item_id = linux.m.scopes()[0].id
    linux.m.amostrar()
    linux.agora[1] = 60
    linux.m.amostrar()
    assert linux.m.parado(item_id) == 60
    linux.processo(11, ppid=10, cpu=700000000)
    linux.scope("app.slice/a.scope", 10, 11)
    linux.agora[1] = 120
    linux.m.amostrar()
    assert linux.m.parado(item_id) is None
    shutil.rmtree(pasta)
    linux.agora[1] = 180
    linux.m.amostrar()
    assert linux.m.parado(item_id) is None and not linux.m._observacoes
    novo = Maquinas(home=linux.m.home, proc=linux.m.proc, cgroup=linux.m.cgroup,
                    relogio=lambda: 20000)
    assert novo.observado_desde == 20000 and novo.parado(item_id) is None


def test_tela_arquivo_e_servico(linux):
    m = linux.m
    assert m.tela() == {"em_uso": True, "ultimo_uso_s": 0}
    arquivo = m.home / ".cache/cockpit-maquina/ocioso"
    arquivo.parent.mkdir(parents=True)
    arquivo.write_text("9900\n")
    assert m.tela() == {"em_uso": False, "ultimo_uso_s": 160}
    linux.ativo[0] = False
    assert m.tela() == {"em_uso": None, "ultimo_uso_s": None}
    linux.ativo[0] = True
    arquivo.write_text("nan")
    assert m.tela() == {"em_uso": None, "ultimo_uso_s": None}


@pytest.fixture
def sinal_simulado(linux, monkeypatch, tmp_path):
    sinais = []
    marcador = tmp_path / "pidfd-falso"
    marcador.touch()
    monkeypatch.setattr(os, "pidfd_open", lambda pid: os.open(marcador, os.O_RDONLY))
    monkeypatch.setattr(signal, "pidfd_send_signal", lambda fd, sig: sinais.append(sig))
    return sinais


def test_fechar_seus_sigterm_e_memoria_antes(linux, sinal_simulado, monkeypatch):
    linux.processo(10)
    pasta = linux.scope("app.slice/terminal.scope", 10)
    linux.janelas.append({"pid": 10, "class": "foot"})
    item_id = linux.m.scopes()[0].id

    def sinal(fd, sig):
        sinal_simulado.append(sig)
        shutil.rmtree(pasta)

    monkeypatch.setattr(signal, "pidfd_send_signal", sinal)
    assert linux.m.fechar(item_id) == {"liberou_mb": 1.5}
    assert sinal_simulado == [signal.SIGTERM]


def test_fechar_agente_cdp_browser_version(linux, sinal_simulado, monkeypatch):
    pasta = linux.chrome(headless=True)
    item_id = linux.m.scopes()[0].id
    chamadas = []
    url = "ws://127.0.0.1:9225/devtools/browser/abc"

    def cdp(porta, caminho):
        chamadas.append((porta, caminho))
        return {"webSocketDebuggerUrl": url}

    def fechar(alvo, porta):
        assert (alvo, porta) == (url, 9225)
        shutil.rmtree(pasta)

    monkeypatch.setattr(maquinas, "json_cdp", cdp)
    monkeypatch.setattr(maquinas, "fechar_browser", fechar)
    assert linux.m.fechar(item_id) == {"liberou_mb": 1.5}
    assert chamadas == [(9225, "/json/version")] and not sinal_simulado


@pytest.mark.parametrize("falha_em", ["http", "websocket"])
def test_cdp_falha_fallback_sigterm(linux, sinal_simulado, monkeypatch, falha_em):
    pasta = linux.chrome()
    item_id = linux.m.scopes()[0].id

    def cdp(*args):
        if falha_em == "http":
            raise OSError("offline")
        return {"webSocketDebuggerUrl": "ws://127.0.0.1:9225/devtools/browser/a"}

    def ws(*args):
        raise ValueError("handshake inválido")

    def sinal(fd, sig):
        sinal_simulado.append(sig)
        shutil.rmtree(pasta)

    monkeypatch.setattr(maquinas, "json_cdp", cdp)
    monkeypatch.setattr(maquinas, "fechar_browser", ws)
    monkeypatch.setattr(signal, "pidfd_send_signal", sinal)
    assert linux.m.fechar(item_id)["liberou_mb"] == 1.5
    assert sinal_simulado == [signal.SIGTERM]


def test_fechar_timeout_8s_409_sem_sigkill(linux, sinal_simulado, monkeypatch):
    linux.processo(10)
    linux.scope("app.slice/a.scope", 10)
    linux.janelas.append({"pid": 10})

    def dormir(segundos):
        linux.agora[1] += segundos

    monkeypatch.setattr(maquinas.time, "sleep", dormir)
    falha(409, linux.m.fechar, linux.m.scopes()[0].id)
    assert 8 <= linux.agora[1] < 8.2
    assert sinal_simulado == [signal.SIGTERM]


def test_revalida_starttime_antes_de_sinalizar(linux, sinal_simulado, monkeypatch):
    linux.processo(10)
    linux.scope("app.slice/a.scope", 10)
    linux.janelas.append({"pid": 10})
    item_id = linux.m.scopes()[0].id
    abrir = os.pidfd_open

    def reciclou(pid):
        linux.processo(10, inicio=999)
        return abrir(pid)

    monkeypatch.setattr(os, "pidfd_open", reciclou)
    falha(404, linux.m.fechar, item_id)
    assert not sinal_simulado


@pytest.mark.parametrize("correto", [True, False])
def test_websocket_handshake_e_frame_mascarado(correto):
    servidor = socket.socket()
    servidor.bind(("127.0.0.1", 0))
    servidor.listen(1)
    servidor.settimeout(3)
    porta = servidor.getsockname()[1]
    recebido = []
    erros = []

    def receber():
        try:
            with servidor, servidor.accept()[0] as conexao:
                conexao.settimeout(3)
                pedido = bytearray()
                while not pedido.endswith(b"\r\n\r\n"):
                    pedido.extend(conexao.recv(1))
                assert pedido.startswith(b"GET /devtools/browser/falso HTTP/1.1\r\n")
                chave = re.search(rb"Sec-WebSocket-Key: ([^\r]+)", pedido)[1]
                aceito = base64.b64encode(hashlib.sha1(chave + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
                if not correto:
                    aceito = b"incorreto"
                conexao.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                                b"Connection: Upgrade\r\nSec-WebSocket-Accept: " + aceito + b"\r\n\r\n")
                if correto:
                    with conexao.makefile("rb") as stream:
                        a, b = stream.read(2)
                        assert a == 0x81 and b & 0x80
                        mascara = stream.read(4)
                        corpo = stream.read(b & 0x7F)
                        recebido.append(json.loads(bytes(v ^ mascara[i % 4] for i, v in enumerate(corpo))))
        except Exception as e:
            erros.append(e)

    thread = threading.Thread(target=receber, daemon=True)
    thread.start()
    try:
        if correto:
            maquinas.fechar_browser(f"ws://127.0.0.1:{porta}/devtools/browser/falso", porta)
        else:
            with pytest.raises(ValueError, match="Handshake"):
                maquinas.fechar_browser(f"ws://127.0.0.1:{porta}/devtools/browser/falso", porta)
    finally:
        thread.join(timeout=4)
        servidor.close()
    assert not thread.is_alive() and not erros
    assert recebido == ([{"id": 1, "method": "Browser.close"}] if correto else [])


@pytest.mark.parametrize("url", ["ws://example.com:9222/devtools/browser/a", "ws://127.0.0.1:9223/devtools/browser/a",
                                "ws://127.0.0.1:9222/devtools/page/a", "wss://127.0.0.1:9222/devtools/browser/a"])
def test_websocket_recusa_alvo_externo_ou_outra_porta(url):
    with pytest.raises(ValueError):
        maquinas.fechar_browser(url, 9222)


@pytest.fixture
def http_painel(linux, tmp_path, monkeypatch):
    # Importa o handler real sem agentes.json privado nem ações antigas reais.
    agentes = types.ModuleType("agentes")
    agentes.AGENTES, agentes.CONFIG, agentes.PASTA = {}, {}, tmp_path
    agentes.enviar = agentes.estado = agentes.rodar = lambda *a, **k: None
    monkeypatch.setitem(sys.modules, "agentes", agentes)
    spec = importlib.util.spec_from_file_location("painel_testado", Path(__file__).with_name("painel.py"))
    painel = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(painel)
    painel.MAQUINAS = linux.m
    painel.temperatura = lambda: 51
    servidor = painel.Servidor(("127.0.0.1", 0), painel.H)
    servidor.autoridade = "127.0.0.1:" + str(servidor.server_port)
    thread = threading.Thread(target=servidor.serve_forever, daemon=True)
    thread.start()

    def pedir(metodo, rota, corpo=None, *, headers=None, chave=True):
        h = {"Content-Type": "application/json"}
        if chave:
            h["Authorization"] = "Bearer segredo-de-teste"
        h.update(headers or {})
        conexao = http.client.HTTPConnection("127.0.0.1", servidor.server_port, timeout=3)
        try:
            conexao.request(metodo, rota, body=corpo, headers=h)
            r = conexao.getresponse()
            return r.status, json.loads(r.read())
        finally:
            conexao.close()

    yield pedir
    servidor.shutdown()
    servidor.server_close()
    thread.join(timeout=2)


@pytest.mark.parametrize("metodo,rota", [("GET", "resumo"), ("GET", "abertos"), ("POST", "fechar")])
def test_http_auth_host_sem_exigir_origin(http_painel, linux, metodo, rota):
    path = "/api/maquina/" + rota
    corpo = '{"id":"desconhecido"}' if metodo == "POST" else None
    assert http_painel(metodo, path, corpo, chave=False)[0] == 401
    assert http_painel(metodo, path, corpo, headers={"Authorization": "Bearer errada"})[0] == 401
    assert http_painel(metodo, path, corpo, headers={"Host": "outro:8788"})[0] == 403
    assert http_painel(metodo, path, corpo)[0] == (404 if metodo == "POST" else 200)
    # Origin é ignorado nas rotas Bearer, inclusive quando enviado.
    assert http_painel(metodo, path, corpo, headers={"Origin": "https://cockpit"})[0] == (404 if metodo == "POST" else 200)
    linux.m.chave.unlink()
    assert http_painel(metodo, path, corpo)[0] == 503


def test_http_protegido_403_e_rotas_antigas(http_painel, linux):
    linux.processo(10, args=("claude",))
    linux.scope("app.slice/tmux-spawn.scope", 10)
    status, abertos = http_painel("GET", "/api/maquina/abertos")
    assert status == 200
    status, mensagem = http_painel("POST", "/api/maquina/fechar", json.dumps({"id": abertos["itens"][0]["id"]}))
    assert status == 403 and mensagem == {"mensagem": "Este item é protegido."}
    assert http_painel("GET", "/api/estado", chave=False)[0] == 200
    assert http_painel("POST", "/api/acao", "agente=x&acao=desligar", chave=False)[0] == 403
    assert http_painel("GET", "/nao-existe", chave=False)[0] == 404


@pytest.mark.parametrize("corpo", ['{}', '[]', '{"id":1}', '{"id":"../x"}',
                                  '{"id":"ok","pid":1}', 'null', '{'])
def test_http_fechar_json_invalido(http_painel, corpo):
    assert http_painel("POST", "/api/maquina/fechar", corpo)[0] == 400


def test_rotulo_religando_agente(linux):
    linux.m.agentes["fluytpos"] = "Fluyt Pós"
    linux.processo(100)
    linux.scope("app.slice/cockpit-reconnect-fluytpos-ce2dd4c0.service", 100)
    sc = linux.m.scopes()[0]
    assert linux.m.rotulo(sc, {}) == ("Religando Fluyt Pós", "Fluyt Pós")
    assert linux.m.classificar(sc, {}) == "protegido"
