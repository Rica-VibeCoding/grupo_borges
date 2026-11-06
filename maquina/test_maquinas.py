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
    (proc / "sys/kernel/random").mkdir(parents=True)
    (proc / "sys/kernel/random/boot_id").write_text("boot-teste")
    (proc / "stat").write_text("cpu 0 0 0 1000 0 0 0 0 0 0\n")
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
            f"Rss: 999999 kB\nPss: {pss} kB\nPss_Anon: {pss} kB\nPss_Shmem: 0 kB\nSwapPss: {swap} kB\n")
        (pasta / "schedstat").write_text(f"{cpu} 0 1\n")
        return pasta

    def scope(nome, *pids):
        pasta = cg / nome
        pasta.mkdir(parents=True, exist_ok=True)
        (pasta / "cgroup.procs").write_text("\n".join(str(p) for p in pids))
        (pasta / "cpu.stat").write_text("usage_usec 0\n")
        anon = sum(int((proc / str(pid) / "smaps_rollup").read_text().split("Pss_Anon: ")[1].split()[0])
                   for pid in pids)
        (pasta / "memory.stat").write_text(f"anon {anon * 1024}\nshmem 0\nfile 999999999\n")
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


def test_abertos_scope_ram_residente_sem_swap_cdp_headless_e_nomes(linux, monkeypatch):
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
    com, fin = resultado["itens"][:-1]
    assert com["rotulo"] == "Chrome do Fluyt Com"
    assert com["dono"] == "Fluyt"
    assert com["memoria_mb"] == 3.5
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
    item = linux.m.abertos()["itens"][:-1][0]
    assert item["grupo"] == "seus" and item["abas"] == ["Pessoal"]
    assert item["rotulo"] == "Chrome pessoal"


def test_janela_exige_app_slice_e_env_hyprland(linux):
    linux.processo(10)
    linux.scope("app.slice/terminal.scope", 10)
    linux.janelas.append({"pid": 10, "class": "foot"})
    item = linux.m.abertos()["itens"][:-1][0]
    assert item["grupo"] == "seus" and item["rotulo"] == "Terminal"
    assert linux.chamadas[0][1]["env"]["HYPRLAND_INSTANCE_SIGNATURE"] == "sessao-teste"
    linux.janelas.clear()
    assert linux.m.abertos()["itens"][:-1][0]["grupo"] == "protegido"
    shutil.rmtree(linux.m.cgroup / "app.slice")
    linux.scope("background.slice/terminal.scope", 10)
    linux.janelas.append({"pid": 10})
    assert linux.m.abertos()["itens"][:-1][0]["grupo"] == "protegido"


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
    scope = linux.m.scopes()[0]
    assert linux.m.rotulo(scope, {}) == (esperado, esperado)
    assert linux.m.classificar(scope, {}) == "terminal"
    assert linux.m.abertos()["itens"][:-1] == [{
        "id": scope.id, "grupo": "terminal", "rotulo": esperado,
        "dono": esperado, "memoria_mb": 2.0, "cpu_pct": None, "parado_s": None, "abas": [],
        "pede_confirmacao": False, "acao_rotulo": "Fechar " + esperado,
    }]
    assert linux.m._achar(scope.id) == scope


@pytest.mark.parametrize("parados,esperado", [
    ((1800, 1200, 600), 600), ((60, 1200, 600), 60),
    ((None, 1200, 600), None), ((1800, None, 600), 600), ((1800, 1200, None), None),
])
def test_terminal_junta_so_spawn_mais_antigo_e_separa_cadeira(linux, monkeypatch, parados, esperado):
    linux.processo(10, args=("tmux", "-L", "fluytcom", "new-session"), pss=2048, swap=0)
    linux.scope("app.slice/cockpit-tmux-fluytcom-a1b2.scope", 10)
    linux.processo(100, ppid=10, args=("claude",), pss=300 * 1024, swap=0)
    linux.processo(101, ppid=100, args=("bun", "mcp"), pss=100 * 1024, swap=0)
    linux.scope("app.slice/tmux-spawn-aaaa.scope", 100, 101)
    linux.processo(200, ppid=10, inicio=500, args=("claude",), pss=50 * 1024, swap=0)
    linux.scope("app.slice/tmux-spawn-bbbb.scope", 200)
    scopes = linux.m.scopes()
    tempos = {s.id: tempo for s, tempo in zip(scopes, parados)}
    monkeypatch.setattr(linux.m, "parado", tempos.get)
    assert all(linux.m.classificar(s, {}) == "terminal" for s in scopes)
    assert linux.m.abertos()["itens"][:-1] == [{
        "id": scopes[0].id, "grupo": "terminal", "rotulo": "Fluyt", "dono": "Fluyt",
        "memoria_mb": 52.0, "cpu_pct": None, "parado_s": esperado, "abas": [],
        "pede_confirmacao": False, "acao_rotulo": "Fechar Fluyt",
    }, {
        "id": scopes[1].id, "grupo": "terminal", "rotulo": "Fluyt · cadeira", "dono": "Fluyt",
        "memoria_mb": 400.0, "cpu_pct": None, "parado_s": parados[1], "abas": [],
        "pede_confirmacao": False, "acao_rotulo": "Fechar cadeira",
    }]
    for scope in scopes:
        assert linux.m._achar(scope.id) == scope


def test_terminais_separam_agentes_e_casam_pid_no_scope_do_servidor(linux):
    for pid, ident in [(10, "fluytcom"), (20, "novo_agente")]:
        linux.processo(pid, args=("tmux",))
        linux.processo(pid + 1, ppid=pid, args=("tmux",))
        linux.scope(f"app.slice/cockpit-tmux-{ident}-a1b2.scope", pid, pid + 1)
        linux.processo(pid + 100, ppid=pid + 1, args=("claude",))
        linux.scope(f"app.slice/tmux-spawn-{pid}.scope", pid + 100)
    itens = linux.m.abertos()["itens"][:-1]
    assert [(i["rotulo"], i["dono"], i["memoria_mb"]) for i in itens] == [
        ("Fluyt", "Fluyt", 3), ("Novo Agente", "Novo Agente", 3)]


@pytest.mark.parametrize("args", [("claude",), ("chrome", "--user-data-dir=~/.config/ze-chrome")])
def test_tmux_spawn_orfao_fechavel_sem_casar_parentesco_de_filho(linux, args):
    linux.processo(10, args=("tmux",))
    linux.scope("app.slice/cockpit-tmux-fluytcom-a1b2.scope", 10)
    linux.processo(20, args=("tmux",))
    linux.scope("app.slice/outro.scope", 20)
    linux.processo(100, ppid=20, args=args)
    linux.processo(101, ppid=10, args=("bun",))
    linux.scope("app.slice/tmux-spawn-aaaa.scope", 100, 101)
    linux.janelas.append({"pid": 100, "class": "foot"})
    scope = next(s for s in linux.m.scopes() if s.principal.pid == 100)
    assert linux.m.classificar(scope, linux.m.janelas()) == "terminal"
    item = next(i for i in linux.m.abertos()["itens"][:-1] if i["id"] == scope.id)
    assert item["grupo"] == "terminal" and item["dono"] is None
    assert item["rotulo"] == "Terminal" and item["memoria_mb"] == 2.0
    assert item["acao_rotulo"] == "Fechar Terminal" and not item["pede_confirmacao"]
    assert linux.m._achar(scope.id) == scope


def test_parados_30min_exclui_terminais_e_spawns_orfaos(linux, monkeypatch):
    linux.processo(10, args=("tmux",))
    linux.scope("app.slice/cockpit-tmux-fluytcom-a1b2.scope", 10)
    for pid, ppid in [(100, 10), (200, 1)]:
        linux.processo(pid, ppid=ppid, args=("claude",))
        linux.scope(f"app.slice/tmux-spawn-{pid}.scope", pid)
    linux.chrome(300)
    linux.processo(400)
    linux.scope("app.slice/pessoal.scope", 400)
    linux.janelas.append({"pid": 400, "class": "foot"})
    linux.m.amostrar()
    linux.agora[1] = 1800
    linux.m.amostrar()
    assert all(linux.m.parado(s.id) == 1800 for s in linux.m.scopes())
    monkeypatch.setattr(maquinas.shutil, "disk_usage", lambda _: shutil._ntuple_diskusage(100, 25, 75))
    assert linux.m.resumo(0, None)["parados_30min"] == 2


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
    ("tmux-spawn-45bb3e23-2f45-4847.scope", "Terminal"),
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
    ("app.slice/cockpit-maquina.service", ("python3", "painel.py")),
    ("app.slice/cockpit-api.service", ("python3",)),
    ("app.slice/cockpit-v2.service", ("next-server",)),
    ("app.slice/manual.scope", ("python3", "painel.py")),
    ("session.slice/wayland.service", ("foot",)),
    ("app.slice/tmux-spawn.scope", ("claude",)),
    ("app.slice/bot.scope", ("bun", "server.ts")),
    ("session.slice/claude.scope", ("claude",)),
    ("session.slice/bot.scope", ("bun",)),
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
    item = linux.m.abertos()["itens"][:-1][0]
    assert item["grupo"] == "protegido" and item["acao_rotulo"] is None
    falha(403, linux.m.fechar, item["id"])


def test_chrome_em_scope_cockpit_ou_com_bun_e_protegido(linux, monkeypatch):
    linux.chrome(nome="app.slice/cockpit-outro.scope")
    monkeypatch.setattr(maquinas, "json_cdp", lambda *a: [])
    item = linux.m.abertos()["itens"][:-1][0]
    assert item["grupo"] == "protegido"
    falha(403, linux.m.fechar, item["id"])


@pytest.mark.parametrize("exe,classe", [("code", "code"), ("soffice.bin", "libreoffice-writer")])
def test_editor_fecha_sem_confirmacao(linux, exe, classe):
    # Rica, 05/11: nada pede confirmação, igual ao PC.
    linux.processo(10, args=(exe,))
    linux.scope("app.slice/editor.scope", 10)
    linux.janelas.append({"pid": 10, "class": classe})
    assert linux.m.abertos()["itens"][:-1][0]["pede_confirmacao"] is False


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
    # Como no kernel: memory.stat do pai já inclui o subgrupo.
    (linux.m.cgroup / "app.slice/a.scope/memory.stat").write_text("anon 2097152\nshmem 0\n")
    scopes = linux.m.scopes()
    assert len(scopes) == 1 and scopes[0].principal.pid == 100
    assert linux.m.memoria(scopes[0]) == 2
    (linux.m.proc / "50/smaps_rollup").unlink()
    assert linux.m.memoria(scopes[0]) == 2  # Não depende mais de smaps nem de PIDs vivos.
    (filho / "cgroup.procs").write_text("")
    shutil.rmtree(linux.m.proc / "50")
    assert len(linux.m.scopes()) == 1


def uso(pasta, usec):
    (pasta / "cpu.stat").write_text(f"usage_usec {usec}\nuser_usec 0\nsystem_usec 0\n")


def total(linux, *, ocupado, ocioso):
    (linux.m.proc / "stat").write_text(f"cpu {ocupado} 0 0 {ocioso} 0 0 0 0 0 0\n")


def test_amostras_3s_limiar_parados_30min_sem_pss_cdp(linux, monkeypatch):
    linux.processo(10)
    pasta = linux.scope("app.slice/a.scope", 10)
    linux.janelas.append({"pid": 10})
    item_id = linux.m.scopes()[0].id
    linux.m.amostrar()
    assert linux.m.parado(item_id) is None
    for segundo in range(3, 1801, 3):
        linux.agora[1] = segundo
        uso(pasta, segundo)  # 1 microssegundo por segundo.
        linux.m.amostrar()
    assert linux.m.parado(item_id) == 1800
    assert not linux.chamadas
    monkeypatch.setattr(maquinas.shutil, "disk_usage", lambda _: shutil._ntuple_diskusage(100 * 2**20, 25 * 2**20, 75 * 2**20))
    resumo = linux.m.resumo(12.5, 51)
    assert resumo["parados_30min"] == 1
    assert resumo["cpu_pct"] == 12.5 and resumo["temperatura_c"] == 51
    assert resumo["ram"] == {"usado_mb": 4000, "livre_mb": 4000, "total_mb": 8000, "pct": 50}
    assert resumo["disco"] == {"usado_mb": 25, "livre_mb": 75, "total_mb": 100, "pct": 25}
    linux.agora[1] = 1802
    uso(pasta, 99_999_999)
    linux.m.amostrar()
    assert linux.m.parado(item_id) == 1800
    linux.agora[1] = 1803
    linux.m.amostrar()
    assert linux.m.parado(item_id) == 0
    assert linux.m.resumo(0, None)["parados_30min"] == 0


@pytest.mark.parametrize("cpus,esperado", [(1, 50), (4, 12.5), (None, 50)])
def test_cpu_pct_por_item_usa_delta_intervalo_e_maquina_inteira(linux, monkeypatch, cpus, esperado):
    monkeypatch.setattr(os, "cpu_count", lambda: cpus)
    linux.processo(10)
    pasta = linux.scope("app.slice/a.scope", 10)
    uso(pasta, 30_000_000)
    linux.m.amostrar()
    assert linux.m.abertos()["itens"][0]["cpu_pct"] is None
    linux.agora[:] = [10006, 6]  # Intervalo real, não o mínimo de 3s.
    uso(pasta, 33_000_000)
    linux.m.amostrar()
    assert linux.m.abertos()["itens"][0]["cpu_pct"] == esperado


@pytest.mark.parametrize("tipo", ["processo-curto", "thread", "sub-cgroup"])
def test_cpu_conta_worker_ausente_do_proc_na_segunda_leitura(linux, monkeypatch, tipo):
    monkeypatch.setattr(os, "cpu_count", lambda: 4)
    principal = linux.processo(10, cpu=0)
    pasta = linux.scope("app.slice/a.scope", 10)
    item_id = linux.m.scopes()[0].id
    linux.m.amostrar()
    if tipo == "processo-curto":
        filho = linux.processo(11, ppid=10, cpu=2_400_000_000)
        shutil.rmtree(filho)  # Nasceu e morreu ENTRE as duas amostras.
    elif tipo == "thread":
        thread = principal / "task/11"
        thread.mkdir(parents=True)
        (thread / "schedstat").write_text("2400000000 0 0")
    else:
        filho = pasta / "workers"
        filho.mkdir()
        (filho / "cgroup.procs").write_text("")
        uso(filho, 2_400_000)
    uso(pasta, 2_400_000)  # Kernel já agregou trabalho dos workers.
    linux.agora[1] = 3
    total(linux, ocupado=90, ocioso=1030)
    linux.m.amostrar()
    item = linux.m.abertos()["itens"][0]
    assert (principal / "schedstat").read_text() == "0 0 1\n"
    assert item["cpu_pct"] == 20 and item["parado_s"] == 0
    assert linux.m._observacoes[item_id].confirmado is False
    linux.agora[1] = 6
    total(linux, ocupado=90, ocioso=1150)
    linux.m.amostrar()
    item = linux.m.abertos()["itens"][0]
    assert item["cpu_pct"] == 0 and item["parado_s"] == 3


@pytest.mark.parametrize("ausentes,esperado", [((), 3.3), ((10,), None), ((10, 100), None)])
def test_cpu_terminal_soma_principal_servidor_e_separa_cadeira(linux, monkeypatch, ausentes, esperado):
    monkeypatch.setattr(os, "cpu_count", lambda: 4)
    pastas = {}
    linux.processo(10, args=("tmux",))
    pastas[10] = linux.scope("app.slice/cockpit-tmux-fluytcom-a1b2.scope", 10)
    for pid in (100, 200):
        linux.processo(pid, ppid=10, args=("claude",))
        pastas[pid] = linux.scope(f"app.slice/tmux-spawn-{pid}.scope", pid)
    for pid in ausentes:
        (pastas[pid] / "cpu.stat").unlink()
    linux.m.amostrar()
    linux.agora[1] = 3
    for pid, cpu in ((10, 132_000), (100, 264_000), (200, 528_000)):
        if pid not in ausentes:
            uso(pastas[pid], cpu)
    linux.m.amostrar()
    agente, cadeira = linux.m.abertos()["itens"][:-1]
    assert agente["cpu_pct"] == esperado
    assert cadeira["cpu_pct"] == 4.4


def test_fora_da_lista_fecha_cpu_e_ram_e_nao_e_fechavel(linux, monkeypatch):
    monkeypatch.setattr(os, "cpu_count", lambda: 4)
    linux.processo(10)
    pasta = linux.scope("app.slice/a.scope", 10)
    (pasta / "memory.stat").write_text(f"anon {100 * 2**20}\nshmem {20 * 2**20}\nfile {9000 * 2**20}\n")
    (pasta / "memory.current").write_text(str(9120 * 2**20))
    linux.m.amostrar()
    linux.agora[1] = 3
    uso(pasta, 2_400_000)
    total(linux, ocupado=90, ocioso=1030)  # 75% da máquina, item = 20%.
    linux.m.amostrar()
    leitura = linux.m.abertos()
    item, fora = leitura["itens"]
    assert item["cpu_pct"] == 20 and item["memoria_mb"] == 120
    assert fora["rotulo"] == "Fora da lista" and fora["grupo"] == "protegido"
    assert fora["cpu_pct"] == 55 and fora["memoria_mb"] == 3880
    assert sum(i["cpu_pct"] for i in leitura["itens"]) == leitura["cpu_pct"] == 75
    assert sum(i["memoria_mb"] for i in leitura["itens"]) == leitura["memoria_mb"] == 4000
    assert leitura["memoria_metrica"] == "anon+shmem"
    assert fora["acao_rotulo"] is None
    falha(404, linux.m.fechar, fora["id"])


def test_unidade_descendente_nao_duplica_cpu_e_ram(linux, monkeypatch):
    monkeypatch.setattr(os, "cpu_count", lambda: 4)
    linux.processo(10)
    linux.processo(11, ppid=10)
    pai = linux.scope("app.slice/a.scope", 10)
    filha = linux.scope("app.slice/a.scope/b.service", 11)
    (pai / "memory.stat").write_text(f"anon {3 * 2**20}\nshmem 0\n")
    linux.m.amostrar()
    linux.agora[1] = 3
    uso(pai, 3_600_000)
    uso(filha, 2_400_000)
    total(linux, ocupado=48, ocioso=1072)
    linux.m.amostrar()
    filha_item, pai_item, fora = linux.m.abertos()["itens"]
    assert filha_item["cpu_pct"] == 20 and filha_item["memoria_mb"] == 1
    assert pai_item["cpu_pct"] == 10 and pai_item["memoria_mb"] == 2
    assert fora["cpu_pct"] == 10 and fora["memoria_mb"] == 3997


@pytest.mark.parametrize("delta,dormindo", [(29_999, True), (30_000, False), (30_001, False)])
def test_limiar_exato_1pct_de_um_core(linux, delta, dormindo):
    linux.processo(10)
    pasta = linux.scope("app.slice/a.scope", 10)
    item_id = linux.m.scopes()[0].id
    linux.m.amostrar()
    linux.agora[1] = 3
    uso(pasta, delta)
    linux.m.amostrar()
    assert linux.m.parado(item_id) == (3 if dormindo else 0)


def test_atividade_distingue_primeira_amostra_ativo_e_retorno_do_repouso(linux, monkeypatch):
    monkeypatch.setattr(os, "cpu_count", lambda: 64)
    linux.processo(10)
    pasta = linux.scope("app.slice/a.scope", 10)
    linux.m.amostrar()
    assert linux.m.abertos()["itens"][0]["parado_s"] is None
    linux.agora[1] = 3
    uso(pasta, 30_000)  # Ativo no limiar, mesmo arredondando CPU da máquina a 0%.
    linux.m.amostrar()
    item = linux.m.abertos()["itens"][0]
    assert item["cpu_pct"] == 0 and item["parado_s"] == 0
    for segundo, esperado in ((66, 63), (69, 66), (72, 0)):
        linux.agora[1] = segundo
        if segundo == 72:
            uso(pasta, 60_000)
        linux.m.amostrar()
        assert linux.m.abertos()["itens"][0]["parado_s"] == esperado


@pytest.mark.parametrize("servidor,sessao,esperado", [
    (0, 0, 0), (0, 63, 0), (63, 0, 0), (63, 63, 63),
    (0, None, 0), (None, 0, 0), (63, None, None), (None, 63, None), (None, None, None),
])
def test_atividade_terminal_prioriza_membro_ativo_e_isola_cadeira(linux, servidor, sessao, esperado):
    linux.processo(10, args=("tmux",))
    pastas = [linux.scope("app.slice/cockpit-tmux-fluytcom-a1b2.scope", 10)]
    for pid in (100, 200):
        linux.processo(pid, ppid=10, args=("claude",))
        pastas.append(linux.scope(f"app.slice/tmux-spawn-{pid}.scope", pid))
    linux.m.amostrar()
    assert all(i["parado_s"] is None for i in linux.m.abertos()["itens"][:-1])
    linux.agora[1] = 63
    for pasta, parado in zip(pastas, (servidor, sessao, 0)):
        if parado is None:
            (pasta / "cpu.stat").unlink()
        elif parado == 0:
            uso(pasta, 630_000)
    linux.m.amostrar()
    agente, cadeira = linux.m.abertos()["itens"][:-1]
    assert agente["parado_s"] == esperado
    assert cadeira["parado_s"] == 0


@pytest.mark.parametrize("duas_amostras,esperado", [(False, None), (True, 0)])
def test_cache_distingue_primeira_amostra_de_atividade(linux, duas_amostras, esperado):
    linux.processo(10)
    pasta = linux.scope("app.slice/a.scope", 10)
    linux.m.amostrar()
    if duas_amostras:
        linux.agora[1] = 3
        uso(pasta, 30_000)
        linux.m.amostrar()
    novo = Maquinas(home=linux.m.home, proc=linux.m.proc, cgroup=linux.m.cgroup,
                    relogio=lambda: linux.agora[0], monotono=lambda: linux.agora[1])
    assert novo.parado(novo.scopes()[0].id) == esperado


@pytest.mark.parametrize("intervalo,mono", [(10, 2410), (300, 2700), (10, 5), (300, 5)])
def test_observacoes_preservam_40min_apos_reinicio(linux, intervalo, mono):
    linux.processo(10)
    pasta = linux.scope("app.slice/a.scope", 10)
    item_id = linux.m.scopes()[0].id
    linux.m.amostrar()
    linux.agora[:] = [12400, 2400]
    linux.m.amostrar()
    arquivo = linux.m._arquivo_observacoes
    dados = json.loads(arquivo.read_text())
    assert arquivo.stat().st_mode & 0o777 == 0o600
    assert dados["versao"] == 2 and dados["observado_desde"] == 10000
    assert dados["observacoes"][item_id]["desde"] == 10000
    linux.agora[:] = [12400 + intervalo, mono]
    novo = Maquinas(home=linux.m.home, proc=linux.m.proc, cgroup=linux.m.cgroup,
                    relogio=lambda: linux.agora[0], monotono=lambda: linux.agora[1])
    assert novo.parado(item_id) == 2400
    uso(pasta, intervalo * 1000)
    novo.amostrar()
    assert novo.parado(item_id) == 2400 + intervalo
    assert novo.abertos()["observado_desde"] == 10000


@pytest.mark.parametrize("mudanca", ["contador", "inode", "boot"])
def test_recriar_cgroup_ou_reboot_nao_produz_cpu_ou_idle_falso(linux, mudanca):
    linux.processo(10)
    pasta = linux.scope("app.slice/a.scope", 10)
    uso(pasta, 90_000_000)
    linux.m.amostrar()
    linux.agora[1] = 3
    linux.m.amostrar()
    assert linux.m.parado(linux.m.scopes()[0].id) == 3
    if mudanca == "contador":
        uso(pasta, 0)
    elif mudanca == "inode":
        pasta.rename(pasta.with_suffix(".antiga"))  # Mantém inode antigo ocupado.
        linux.scope("app.slice/a.scope", 10)
        uso(pasta, 90_000_000)
    else:
        (linux.m.proc / "sys/kernel/random/boot_id").write_text("outro-boot")
    linux.agora[1] = 6
    linux.m.amostrar()
    item = linux.m.abertos()["itens"][0]
    assert item["cpu_pct"] is None and item["parado_s"] is None


@pytest.mark.parametrize("conteudo", [
    b"{corrompido", b"\xff", b"[]", b"{}",
    b'{"versao":2,"observado_desde":9000,"observacoes":{"scope":{"cpus":[]}}}',
    b'{"versao":2,"observado_desde":9000,"observacoes":{"scope":{"cpus":{},"amostrado":10000,"desde":NaN,"confirmado":true}}}',
    b'{"observado_desde":9000,"observacoes":{"antigo":{"cpus":{"10:100":0},"amostrado":10000,"desde":9000,"confirmado":true}}}',
])
def test_cache_corrompido_ou_schedstat_antigo_comeca_do_zero(linux, conteudo):
    linux.processo(10)
    linux.scope("app.slice/a.scope", 10)
    arquivo = linux.m._arquivo_observacoes
    arquivo.parent.mkdir(parents=True)
    arquivo.write_bytes(conteudo)
    linux.agora[:] = [12000, 2000]
    novo = Maquinas(home=linux.m.home, proc=linux.m.proc, cgroup=linux.m.cgroup,
                    relogio=lambda: linux.agora[0], monotono=lambda: linux.agora[1])
    assert novo.observado_desde == 12000 and novo._observacoes == {}
    novo.amostrar()
    assert novo.parado(novo.scopes()[0].id) is None



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
    assert linux.m.fechar(item_id) == {"liberou_mb": 1.0}
    assert sinal_simulado == [signal.SIGTERM]


@pytest.mark.parametrize("alvo_pid", [10, 200, 300])
def test_fechar_terminal_agente_cadeira_e_orfao_sinaliza_principal(linux, sinal_simulado,
                                                               monkeypatch, alvo_pid):
    linux.processo(10, args=("tmux",))
    linux.processo(11, ppid=10, args=("tmux",))
    servidor = linux.scope("app.slice/cockpit-tmux-fluytcom-a1b2.scope", 10, 11)
    pastas = {10: servidor}
    for pid, ppid in ((100, 11), (200, 11), (300, 1)):
        linux.processo(pid, ppid=ppid, args=("claude",))
        pastas[pid] = linux.scope(f"app.slice/tmux-spawn-{pid}.scope", pid)
    item_id = next(s.id for s in linux.m.scopes() if s.principal.pid == alvo_pid)
    item = next(i for i in linux.m.abertos()["itens"][:-1] if i["id"] == item_id)
    assert not item["pede_confirmacao"]
    assert item["acao_rotulo"] == {10: "Fechar Fluyt", 200: "Fechar cadeira",
                                   300: "Fechar Terminal"}[alvo_pid]
    abrir = os.pidfd_open
    pids = []

    def pidfd(pid):
        pids.append(pid)
        return abrir(pid)

    def sinal(fd, sig):
        sinal_simulado.append(sig)
        shutil.rmtree(pastas[alvo_pid])

    monkeypatch.setattr(os, "pidfd_open", pidfd)
    monkeypatch.setattr(signal, "pidfd_send_signal", sinal)
    assert linux.m.fechar(item_id) == {"liberou_mb": 2.0 if alvo_pid == 10 else 1.0}
    assert pids == [alvo_pid] and sinal_simulado == [signal.SIGTERM]
    assert pastas[100].exists()
    assert pastas[200 if alvo_pid == 10 else 10].exists()


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
    assert linux.m.fechar(item_id) == {"liberou_mb": 1.0}
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
    assert linux.m.fechar(item_id)["liberou_mb"] == 1.0
    assert sinal_simulado == [signal.SIGTERM]


@pytest.mark.parametrize("nome", ["a.scope", "tmux-spawn-aaaa.scope"])
def test_fechar_timeout_8s_409_sem_sigkill(linux, sinal_simulado, monkeypatch, nome):
    linux.processo(10)
    linux.scope("app.slice/" + nome, 10)
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

    pedir.painel = painel
    pedir.autoridade = servidor.autoridade
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
    linux.scope("session.slice/claude.scope", 10)
    status, abertos = http_painel("GET", "/api/maquina/abertos")
    assert status == 200
    status, mensagem = http_painel("POST", "/api/maquina/fechar", json.dumps({"id": abertos["itens"][0]["id"]}))
    assert status == 403 and mensagem == {"mensagem": "Este item é protegido."}
    assert http_painel("GET", "/api/estado", chave=False)[0] == 200
    assert http_painel("POST", "/api/acao", "agente=x&acao=desligar", chave=False)[0] == 403
    assert http_painel("GET", "/nao-existe", chave=False)[0] == 404


@pytest.mark.parametrize("acao", ["ligar", "desligar", "compactar", "nova"])
@pytest.mark.parametrize("autenticacao,status", [
    ("ausente", 401), ("errada", 401), ("sem_arquivo", 503), ("certa", 200),
])
def test_http_acao_exige_chave_sem_executar_recusadas(http_painel, linux, monkeypatch,
                                                     acao, autenticacao, status):
    painel = http_painel.painel
    agente = {"id": "falso", "nome": "Agente falso"}
    monkeypatch.setattr(painel, "AGENTES", {"falso": agente})
    chamadas = []

    def rodar(cmd, **kwargs):
        chamadas.append((cmd, kwargs))
        return subprocess.CompletedProcess(cmd, 0, "Ação simulada.", "")

    def enviar(*args):
        chamadas.append(args)
        return "Ação simulada."

    monkeypatch.setattr(painel, "rodar", rodar)
    monkeypatch.setattr(painel, "enviar", enviar)
    headers = {"Origin": "http://" + http_painel.autoridade,
               "Content-Type": "application/x-www-form-urlencoded"}
    if autenticacao == "errada":
        headers["Authorization"] = "Bearer errada"
    elif autenticacao == "sem_arquivo":
        linux.m.chave.unlink()
    resposta = http_painel("POST", "/api/acao", f"agente=falso&acao={acao}",
                           headers=headers, chave=autenticacao != "ausente")
    assert resposta == (status, {"mensagem": {
        200: "Ação simulada.", 401: "Chave inválida ou ausente.",
        503: "Chave do painel indisponível (exige arquivo 0600).",
    }[status]})
    if status != 200:
        assert chamadas == []
    elif acao in {"ligar", "desligar"}:
        assert chamadas == [([str(painel.PASTA / "agente.sh"), acao, "falso"], {"timeout": 35})]
    else:
        assert chamadas == [(agente, acao, False)]


@pytest.mark.parametrize("autenticacao,status", [("ausente", 401), ("errada", 401), ("sem_arquivo", 503)])
def test_http_acao_autentica_antes_de_ler_corpo(http_painel, linux, autenticacao, status):
    headers = {"Origin": "http://" + http_painel.autoridade,
               "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "1024"}
    if autenticacao == "errada":
        headers["Authorization"] = "Bearer errada"
    elif autenticacao == "sem_arquivo":
        linux.m.chave.unlink()
    # Corpo não enviado: ler antes de autenticar causaria timeout, em vez da recusa imediata.
    assert http_painel("POST", "/api/acao", headers=headers,
                       chave=autenticacao != "ausente")[0] == status


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


@pytest.fixture
def frota(linux, monkeypatch):
    from frota import MaquinasFrota
    import frota as modulo
    cadastro = [
        {"id": ident, "nome": nome, "socket": "borges-" + ident, "sessao": ident}
        for ident, nome in (("pavan", "Pavan"), ("daniel", "Daniel"), ("sobral", "Sobral"),
                            ("vinicius", "Vinicius"), ("barsi", "Barsi"), ("felipe", "Felipe"),
                            ("caseiro", "Caseiro"), ("miga", "Miga"), ("canario", "Canário"))
    ]
    cadastro.append({"id": "pavan-alerta", "nome": "Pavan alerta", "socket": "borges-pavan-alerta",
                     "sessao": "pavan-alerta", "cadeira_de": "pavan"})
    m = MaquinasFrota(home=linux.m.home, proc=linux.m.proc, cgroup=linux.m.cgroup,
                     runtime=linux.m.runtime, agentes=cadastro,
                     relogio=lambda: linux.agora[0], monotono=lambda: linux.agora[1])
    def executar_seguro(cmd, **kwargs):
        assert cmd == ["docker", "ps", "--no-trunc", "--format", "{{.ID}}\t{{.Names}}"]
        return subprocess.CompletedProcess(cmd, 0, "", "")
    m.executar = executar_seguro
    inventario = []
    monkeypatch.setattr(m, "_inventario", lambda: iter(inventario))
    monkeypatch.setattr(modulo.time, "sleep", lambda _: linux.agora.__setitem__(1, linux.agora[1] + 1))

    def sessao(ident="pavan", pid=100, *, cadeira=False, scope="app.slice/tmux-spawn-a.scope"):
        # O tmux e o CLI ficam em scopes DIFERENTES, como na VPS.
        linux.processo(pid, args=("tmux",), pss=1024, swap=0)
        linux.scope(f"app.slice/servico-{pid}.service", pid)
        linux.processo(pid + 1, ppid=pid, args=("bash",), pss=1024, swap=0)
        linux.scope(scope, pid + 1)
        linux.processo(pid + 2, ppid=pid + 1, args=("claude",), pss=2048, swap=0)
        linux.processo(pid + 3, ppid=pid + 2, args=("bun", "server.ts"), pss=4096, swap=0)
        compartilhado = linux.m.cgroup / "borges.slice/borges-frota.slice/run-u5465.scope/cgroup.procs"
        antigos = [int(v) for v in compartilhado.read_text().split()] if compartilhado.exists() else []
        linux.scope("borges.slice/borges-frota.slice/run-u5465.scope", *antigos, pid + 2, pid + 3)
        inventario.append((m.sockets / ("borges-" + ident), pid, "$0", ident, cadeira, {pid + 1}))
        return next(s for s in m.scopes() if s.principal.pid == pid + 1)

    return types.SimpleNamespace(m=m, inventario=inventario, sessao=sessao, modulo=modulo)


def test_defaults_seguem_uid_real(monkeypatch, tmp_path):
    monkeypatch.setattr(os, "getuid", lambda: 1002)
    m = Maquinas(home=tmp_path)
    assert m.cgroup == Path("/sys/fs/cgroup/user.slice/user-1002.slice/user@1002.service")
    assert m.runtime == Path("/run/user/1002")


def test_frota_soma_sessao_atraves_de_scopes_e_separa_cadeira(linux, frota):
    principal = frota.sessao()
    # Cadeira em outro socket, servidor dentro de serviço protegido (poller).
    cadeira = frota.sessao("pavan-alerta", 200, cadeira=True, scope="app.slice/tmux-spawn-b.scope")
    frota.m.amostrar()
    linux.agora[1] = 1800
    frota.m.amostrar()
    terminais = [i for i in frota.m.abertos()["itens"][:-1] if i["grupo"] == "terminal"]
    assert [(i["rotulo"], i["dono"], i["memoria_mb"], i["parado_s"], i["cpu_pct"])
            for i in terminais] == [("Pavan", "Pavan", 7, 1800, 0), ("Pavan · cadeira", "Pavan", 7, 1800, 0)]
    assert {i["id"] for i in terminais} == {principal.id, cadeira.id}
    assert all(i["acao_rotulo"] and not i["pede_confirmacao"] for i in terminais)
    assert frota.m.tela() == {"em_uso": None, "ultimo_uso_s": None}


def test_frota_cpu_compartilhada_nao_duplica_e_conta_threads(linux, frota, monkeypatch):
    monkeypatch.setattr(os, "cpu_count", lambda: 4)
    frota.sessao()
    frota.sessao("pavan-alerta", 200, cadeira=True, scope="app.slice/tmux-spawn-b.scope")
    frota.m.amostrar()
    # stat do processo agrega threads; schedstat da principal continua zero.
    ticks = os.sysconf("SC_CLK_TCK")
    for pid, segundos in ((100, 0.3), (102, 1.2), (202, 2.4)):
        arquivo = linux.m.proc / str(pid) / "stat"
        prefixo, dados = arquivo.read_text().rsplit(")", 1)
        campos = dados.split()
        campos[11] = str(round(segundos * ticks))
        arquivo.write_text(prefixo + ") " + " ".join(campos))
    total(linux, ocupado=48, ocioso=1072)
    linux.agora[1] = 3
    frota.m.amostrar()
    leitura = frota.m.abertos()
    terminais = [i for i in leitura["itens"] if i["grupo"] == "terminal"]
    assert [i["cpu_pct"] for i in terminais] == [10, 20]
    assert all(i["parado_s"] == 0 for i in terminais)
    assert sum(i["cpu_pct"] for i in leitura["itens"]) == 40
    assert leitura["itens"][-1]["cpu_pct"] == 7.5


def test_frota_pid_que_muda_de_dono_nao_transfere_cpu_da_vida(linux, frota, monkeypatch):
    monkeypatch.setattr(os, "cpu_count", lambda: 4)
    sessao = frota.sessao()
    linux.processo(500, args=("worker",))
    linux.scope("app.slice/worker.scope", 500)
    arquivo = linux.m.proc / "500/stat"
    prefixo, dados = arquivo.read_text().rsplit(")", 1)
    campos = dados.split()
    campos[11] = str(3600 * os.sysconf("SC_CLK_TCK"))
    arquivo.write_text(prefixo + ") " + " ".join(campos))
    frota.m.amostrar()
    # O mesmo PID/starttime passa a ser descendente do pane.
    campos[1] = "101"
    arquivo.write_text(prefixo + ") " + " ".join(campos))
    linux.agora[1] = 3
    total(linux, ocupado=0, ocioso=1120)
    frota.m.amostrar()
    assert frota.m.cpu(sessao.id) is None
    assert frota.m.parado(sessao.id) is None
    linux.agora[1] = 6
    total(linux, ocupado=0, ocioso=1240)
    frota.m.amostrar()
    assert frota.m.cpu(sessao.id) == 0
    assert frota.m.parado(sessao.id) == 3
    assert frota.m.abertos()["itens"][-1]["cpu_pct"] == 0


@pytest.mark.parametrize("ident,nome", [("pavan", "Pavan"), ("daniel", "Daniel"), ("sobral", "Sobral"),
    ("vinicius", "Vinicius"), ("barsi", "Barsi"), ("felipe", "Felipe"), ("caseiro", "Caseiro"),
    ("miga", "Miga"), ("canario", "Canário")])
def test_frota_rotula_cada_agente_pelo_cadastro(frota, ident, nome):
    sessao = frota.sessao(ident)
    assert frota.m.rotulo(sessao, {}) == (nome, nome)


@pytest.mark.parametrize("nome,args", [
    ("system.slice/docker.service", ("dockerd",)),
    ("system.slice/docker-123.scope", ("node", "n8n")),
    ("system.slice/supabase.service", ("postgres",)),
    ("system.slice/evolution.service", ("node",)),
    ("system.slice/ssh.service", ("sshd",)),
    ("system.slice/tailscaled.service", ("tailscaled",)),
    ("system.slice/cron.service", ("cron",)),
    ("app.slice/cockpit-api.service", ("python", "-m", "uvicorn", "main:app")),
    ("app.slice/cockpit-v2.service", ("next-server",)),
    ("app.slice/cockpit-maquina.service", ("python", "painel.py")),
    ("app.slice/vigia-fluyt-ponte.service", ("bash",)),
    ("app.slice/poller.service", ("bun",)),
    ("borges.slice/borges-frota.slice/run-u999.scope", ("claude",)),
    ("app.slice/tmux-spawn-desconhecido.scope", ("claude",)),
])
def test_frota_protege_infra_e_orfaos_sem_executor(linux, frota, nome, args):
    linux.processo(10, args=args)
    linux.scope(nome, 10)
    item = frota.m.abertos()["itens"][:-1][0]
    assert item["grupo"] == "protegido" and item["acao_rotulo"] is None
    falha(403, frota.m.fechar, item["id"])


def test_frota_cgroup_compartilhado_e_servico_filho_nao_viram_alvo(linux, frota):
    frota.sessao()
    # Servidor de Canário herdou o scope de Pavan: não pode cair junto.
    linux.processo(300, ppid=102, args=("tmux",))
    linux.processo(301, ppid=300, args=("claude",))
    linux.processo(400, ppid=102, args=("bun", "poller"))
    linux.scope("borges.slice/borges-frota.slice/run-u5465.scope", 102, 103, 300, 301)
    linux.scope("app.slice/poller.service", 400)
    sessao = next(s for s in frota.m.scopes() if s.principal.pid == 101)
    assert {p.pid for p in sessao.processos} == {101, 102, 103}
    assert {p.pid for s in frota.m.scopes() if frota.m.classificar(s, {}) == "protegido"
            for p in s.processos} == {100, 300, 301, 400}


def test_frota_fechar_usa_executor_falso_somente_sessao_e_pidfds(linux, frota, monkeypatch):
    sessao = frota.sessao()
    sinais, comandos, fechados = [], [], []
    monkeypatch.setattr(os, "pidfd_open", lambda pid: pid + 1000)
    fechar_original = os.close
    monkeypatch.setattr(os, "close", lambda fd: fechados.append(fd) if fd >= 1000 else fechar_original(fd))

    def sinalizar(fd, sig):
        assert sig == signal.SIGTERM
        sinais.append(fd - 1000)
        shutil.rmtree(linux.m.proc / str(fd - 1000))

    def executar(cmd, **kwargs):
        comandos.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    frota.m.executar = executar
    monkeypatch.setattr(signal, "pidfd_send_signal", sinalizar)
    assert frota.m.fechar(sessao.id) == {"liberou_mb": 7}
    assert sinais == [103, 102, 101]
    assert fechados == [1101, 1102, 1103]
    assert comandos == [["tmux", "-S", str(frota.m.sockets / "borges-pavan"), "kill-session", "-t", "$0"]]
    assert frota.m.processo(100) is not None  # Servidor e serviço seguem intactos.


def test_frota_revalida_pid_e_sessao_antes_de_efeito(linux, frota, monkeypatch):
    sessao = frota.sessao()
    fechados = []

    def abrir(pid):
        linux.processo(pid, inicio=99999)
        return 500

    monkeypatch.setattr(os, "pidfd_open", abrir)
    monkeypatch.setattr(os, "close", fechados.append)
    falha(409, frota.m.fechar, sessao.id)
    assert fechados == [500]
    falha(404, frota.m.fechar, sessao.id)


def test_frota_falha_de_inventario_so_deixa_protegidos(linux, frota):
    frota.sessao()
    frota.inventario.clear()
    assert all(i["grupo"] == "protegido" for i in frota.m.abertos()["itens"][:-1])


def test_frota_inventario_exige_socket_cadastro_e_alvo_exato(linux, frota, monkeypatch, tmp_path):
    from frota import MaquinasFrota
    m = frota.m
    m.sockets = tmp_path / "sockets"
    m.sockets.mkdir()
    sock = socket.socket(socket.AF_UNIX)
    sock.bind(str(m.sockets / "borges-pavan"))
    comandos = []

    def executar(cmd, **kwargs):
        comandos.append(cmd)
        assert cmd[3:6] == ["list-panes", "-a", "-F"]
        return subprocess.CompletedProcess(cmd, 0,
            "100\tpavan\t$0\t101\n100\tpavan__revisao\t$1\t201\n"
            "100\tservico\t$2\t301\n100\tpavan\tnao-exato\t401\n", "")

    m.executar = executar
    try:
        inventario = list(MaquinasFrota._inventario(m))
        assert [(v[1], v[2], v[3], v[4], v[5]) for v in inventario] == [
            (100, "$0", "pavan", False, {101}), (100, "$1", "pavan", True, {201})]
        assert len(comandos) == 1
    finally:
        sock.close()


def test_http_vps_lista_e_recusa_protegido_sem_sinal(http_painel, linux, frota, monkeypatch):
    frota.sessao()
    monkeypatch.setattr(http_painel.painel, "MAQUINAS", frota.m)
    monkeypatch.setitem(http_painel.painel.CONFIG, "frota_vps", True)
    assert http_painel("GET", "/api/maquina/abertos", chave=False)[0] == 401
    status, corpo = http_painel("GET", "/api/maquina/abertos")
    assert status == 200
    assert {i["grupo"] for i in corpo["itens"]} == {"terminal", "protegido"}
    protegido = next(i for i in corpo["itens"] if i["grupo"] == "protegido")
    assert http_painel("POST", "/api/maquina/fechar", json.dumps({"id": protegido["id"]}))[0] == 403
    headers = {"Origin": "http://" + http_painel.autoridade,
               "Content-Type": "application/x-www-form-urlencoded"}
    assert http_painel("POST", "/api/acao", "agente=pavan&acao=desligar", headers=headers)[0] == 403


def test_frota_supervisor_ativo_nao_e_parado(linux, frota):
    frota.sessao()
    shutil.rmtree(linux.m.cgroup / "app.slice/servico-100.service")
    linux.scope("system.slice/borges-clawd@pavan.service", 100)
    assert all(i["grupo"] == "protegido" for i in frota.m.abertos()["itens"][:-1])


def test_frota_sessao_desaparece_entre_validacoes_sem_efeito(linux, frota, monkeypatch):
    sessao = frota.sessao()
    fechados = []
    def abrir(pid):
        frota.inventario.clear()
        return pid + 1000
    monkeypatch.setattr(os, "pidfd_open", abrir)
    monkeypatch.setattr(os, "close", fechados.append)
    falha(404, frota.m.fechar, sessao.id)
    assert fechados == [1101, 1102, 1103]


def test_frota_nao_fecha_sessao_com_parentesco_incorreto(linux, frota):
    frota.sessao()
    linux.processo(101, ppid=999, args=("bash",))
    assert all(i["grupo"] == "protegido" for i in frota.m.abertos()["itens"][:-1])


def test_frota_fechar_timeout_nao_escala_para_kill(linux, frota, monkeypatch):
    sessao = frota.sessao()
    sinais, fechados = [], []
    monkeypatch.setattr(os, "pidfd_open", lambda pid: pid + 1000)
    monkeypatch.setattr(os, "close", fechados.append)
    monkeypatch.setattr(signal, "pidfd_send_signal", lambda fd, sig: sinais.append((fd, sig)))
    frota.m.executar = lambda cmd, **kwargs: subprocess.CompletedProcess(cmd, 0, "", "")
    falha(409, frota.m.fechar, sessao.id)
    assert sinais == [(1103, signal.SIGTERM), (1102, signal.SIGTERM), (1101, signal.SIGTERM)]
    assert fechados == [1101, 1102, 1103]


def test_frota_rotulo_container_usa_nome_sem_ler_env(linux, frota):
    linux.processo(10, args=("postgres",))
    linux.scope("system.slice/docker-abc123.scope", 10)
    chamadas = []
    def executar(cmd, **kwargs):
        chamadas.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, "abc123\tsupabase-db\n", "")
    frota.m.executar = executar
    for _ in range(2):
        item = frota.m.abertos()["itens"][:-1][0]
        assert (item["rotulo"], item["grupo"], item["acao_rotulo"]) == ("Container supabase-db", "protegido", None)
    assert len(chamadas) == 1


def test_frota_root_e_container_medidos_por_cgroup_sem_smaps(linux, frota):
    for pid, nome, mb in ((700, 'system.slice/docker-abc.scope', 276), (800, 'system.slice/root.service', 133)):
        linux.processo(pid, args=('root-worker',))
        pasta = linux.scope(nome, pid)
        (pasta / 'memory.stat').write_text(f'anon {mb * 2**20}\nshmem 0\nfile 900000000\n')
        (linux.m.proc / str(pid) / 'smaps_rollup').unlink()
    leitura = frota.m.abertos()
    assert [i['memoria_mb'] for i in leitura['itens']] == [276, 133, 3591]
    assert sum(i['memoria_mb'] for i in leitura['itens']) == leitura['memoria_mb'] == 4000


def test_frota_recorte_nao_reconta_ram_de_sessao_no_protegido(linux, frota):
    frota.sessao()
    linux.processo(500, args=('worker',), pss=3072)
    linux.scope('borges.slice/borges-frota.slice/run-u5465.scope', 102, 103, 500)
    itens = frota.m.abertos()['itens']
    protegido = next(i for i in itens if i['rotulo'] == 'Run u5465')
    sessao = next(i for i in itens if i['grupo'] == 'terminal')
    assert protegido['memoria_mb'] == 3
    assert sessao['memoria_mb'] == 7


@pytest.mark.parametrize('recorte', [False, True])
def test_memoria_indisponivel_e_null_sem_soma_parcial(linux, frota, recorte):
    if recorte:
        frota.sessao()
        (linux.m.proc / '102/smaps_rollup').unlink()
        leitura = frota.m.abertos()
        item = next(i for i in leitura['itens'] if i['grupo'] == 'terminal')
    else:
        linux.processo(10)
        pasta = linux.scope('app.slice/a.scope', 10)
        (pasta / 'memory.stat').unlink()
        leitura = linux.m.abertos()
        item = leitura['itens'][0]
    assert item['memoria_mb'] is None
    assert leitura['itens'][-1]['memoria_mb'] is None


@pytest.mark.parametrize('fora_de_user', [False, True])
def test_chrome_agrega_filhos_por_parentesco_ram_cpu_atividade_e_residual(linux, monkeypatch, fora_de_user):
    monkeypatch.setattr(os, 'cpu_count', lambda: 4)
    pasta = linux.chrome(100, 'teste', porta=0)
    linux.processo(110, ppid=100, args=('chrome', '--type=zygote'), pss=20 * 1024)
    linux.processo(120, ppid=110, args=('chrome', '--type=renderer'), pss=100 * 1024)
    linux.processo(130, ppid=100, args=('chrome', '--type=gpu-process'), pss=30 * 1024)
    # Um Chrome alheio com o mesmo texto de perfil NÃO é filho.
    linux.processo(900, args=('chrome', '--type=renderer', f'--user-data-dir={linux.m.home}/.config/ze-chrome-teste'), pss=10 * 1024)
    if not fora_de_user:
        linux.processo(800, args=('sleep',), pss=5 * 1024)
        linux.scope('app.slice/lancador.scope', 110, 120, 130, 800)
    linux.m.amostrar()
    linux.agora[1] = 1800
    linux.m.amostrar()
    browser = next(s for s in linux.m.scopes() if s.principal.pid == 100)
    assert {p.pid for p in browser.processos} == {100, 110, 120, 130}
    assert linux.m.parado(browser.id) == 1800
    monkeypatch.setattr(maquinas.shutil, 'disk_usage', lambda _: shutil._ntuple_diskusage(100, 50, 50))
    assert linux.m.resumo(0, None)['parados_30min'] == 1
    # Só o renderer trabalha: a atividade do principal sozinho diria parado.
    arq = linux.m.proc / '120/stat'
    prefixo, dados = arq.read_text().rsplit(')', 1)
    campos = dados.split()
    campos[11] = str(round(1.2 * os.sysconf('SC_CLK_TCK')))
    arq.write_text(prefixo + ') ' + ' '.join(campos))
    linux.agora[1] = 1803
    total(linux, ocupado=48, ocioso=1072)
    linux.m.amostrar()
    leitura = linux.m.abertos()
    item = next(i for i in leitura['itens'] if i['grupo'] == 'agente')
    assert item['memoria_mb'] == 151
    assert item['cpu_pct'] == 10
    assert item['parado_s'] == 0
    assert item['acao_rotulo'] == 'Fechar Chrome do Teste'
    assert linux.m.resumo(40, None)['parados_30min'] == 0
    assert leitura['itens'][-1]['memoria_mb'] == (3849 if fora_de_user else 3844)
    assert leitura['itens'][-1]['cpu_pct'] == 30
    if not fora_de_user:
        protegido = next(i for i in leitura['itens'] if i['rotulo'] == 'Lancador')
        assert protegido['memoria_mb'] == 5 and protegido['cpu_pct'] == 0


def test_chrome_nao_desprotege_unidade_de_infra_ou_captura_outro_browser(linux):
    linux.chrome(100, 'teste', porta=0)
    linux.processo(110, ppid=100, args=('chrome', '--user-data-dir=~/.config/ze-chrome-outro'))
    linux.scope('app.slice/outro.scope', 110)
    assert len(linux.m.scopes()) == 2
    linux.chrome(200, 'teste', porta=0, nome='app.slice/cockpit-protegido.scope')
    linux.processo(210, ppid=200, args=('chrome', '--type=renderer'))
    assert all(210 not in {p.pid for p in s.processos} for s in linux.m.scopes())


@pytest.mark.parametrize('filho_fecha', [False, True])
def test_chrome_fechar_so_confirma_depois_dos_filhos_e_libera_ram_inteira(linux, sinal_simulado, monkeypatch, filho_fecha):
    pasta = linux.chrome(100, 'teste', porta=0)
    linux.processo(110, ppid=100, args=('chrome', '--type=renderer'), pss=20 * 1024)
    item_id = linux.m.scopes()[0].id
    assert linux.m.resumo(0, None)['parados_30min'] is None

    def sinal(fd, sig):
        assert sig == signal.SIGTERM
        shutil.rmtree(pasta)
        shutil.rmtree(linux.m.proc / '100')
        if filho_fecha:
            shutil.rmtree(linux.m.proc / '110')

    monkeypatch.setattr(signal, 'pidfd_send_signal', sinal)
    monkeypatch.setattr(maquinas.time, 'sleep', lambda n: linux.agora.__setitem__(1, linux.agora[1] + n))
    if filho_fecha:
        assert linux.m.fechar(item_id) == {'liberou_mb': 21}
    else:
        falha(409, linux.m.fechar, item_id)
        assert (linux.m.proc / '110').exists()
