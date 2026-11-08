"""Trava da sessão aberta por fora do cockpit (agentes.py)."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid

import pytest

PASTA = Path(__file__).resolve().parent
HEX = "0123456789abcdef0123456789abcdef"


@pytest.fixture
def g(tmp_path, monkeypatch):
    config = dict(ip_tailscale="100.64.0.1", porta=8787, janela_tokens=200000,
                  claude="/bin/true", path="/usr/bin:/bin",
                  agentes=[dict(id="canario", nome="Canário", socket="canario-" + uuid.uuid4().hex[:8],
                                sessao="canario", boot=False, cwd=str(tmp_path), flags=[],
                                state_dir=str(tmp_path / "tg"))])
    arquivo = tmp_path / "agentes.json"
    arquivo.write_text(json.dumps(config))
    monkeypatch.setenv("COCKPIT_MAQUINA_CONFIG", str(arquivo))
    spec = importlib.util.spec_from_file_location("agentes_teste", PASTA / "agentes.py")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    modulo.ESTADO = tmp_path / "estado"
    modulo.PROC = tmp_path / "proc"
    return modulo


def processo(g, pid, cgroup, argv):
    pasta = g.PROC / str(pid)
    pasta.mkdir(parents=True)
    (pasta / "cgroup").write_text("0::/user.slice/user@1000.service/app.slice/" + cgroup + "\n")
    (pasta / "cmdline").write_bytes(b"\0".join(os.fsencode(v) for v in argv) + b"\0")


class Tmux:
    """Servidor tmux de mentira: registra chamadas e responde has-session/display-message."""

    def __init__(self, pid=None):
        self.pid, self.chamadas = pid, []

    def __call__(self, a, *args):
        self.chamadas.append(args)
        if self.pid is None:
            return subprocess.CompletedProcess(args, 1, "", "no server")
        if args[0] == "display-message":
            return subprocess.CompletedProcess(args, 0, f"{self.pid}\n", "")
        if args[0] == "list-panes":
            return subprocess.CompletedProcess(args, 0, "%0\t999999\t0\n", "")
        return subprocess.CompletedProcess(args, 0, "", "")


MANUAL = ["tmux", "-L", "canario", "new-session", "-d", "-s", "canario", "bash", "-c", "exec claude"]


def test_sem_sessao_nao_e_de_ninguem(g, monkeypatch):
    monkeypatch.setattr(g, "tmux", Tmux(None))
    assert g.do_cockpit(g.AGENTES["canario"]) is None


def test_scope_do_cockpit_e_do_cockpit(g, monkeypatch):
    processo(g, 10, f"cockpit-tmux-canario-{HEX}.scope", MANUAL)
    monkeypatch.setattr(g, "tmux", Tmux(10))
    assert g.do_cockpit(g.AGENTES["canario"]) is True


def test_lancador_do_cockpit_na_linha_de_comando_e_do_cockpit(g, monkeypatch):
    argv = ["/usr/bin/tmux", "-L", "canario", "new-session", "/usr/bin/python3",
            str(g.PASTA / "agentes.py"), "--exec", "canario", "--channels", "plugin:telegram@x"]
    processo(g, 11, "tmux-spawn-abc.scope", argv)
    monkeypatch.setattr(g, "tmux", Tmux(11))
    assert g.do_cockpit(g.AGENTES["canario"]) is True


@pytest.mark.parametrize("cgroup", ["tmux-spawn-0d47e8e5.scope",
                                    f"cockpit-tmux-fluytpos-{HEX}.scope",
                                    "cockpit-tmux-canario-xyz.scope"])
def test_tmux_aberto_a_mao_e_de_fora(g, monkeypatch, cgroup):
    processo(g, 12, cgroup, MANUAL)
    monkeypatch.setattr(g, "tmux", Tmux(12))
    assert g.do_cockpit(g.AGENTES["canario"]) is False


def test_sem_leitura_do_processo_conta_como_de_fora(g, monkeypatch):
    monkeypatch.setattr(g, "tmux", Tmux(13))  # /proc/13 não existe
    assert g.do_cockpit(g.AGENTES["canario"]) is False


def test_ligar_recusa_sessao_de_fora_sem_subir_nada(g, monkeypatch):
    processo(g, 14, "tmux-spawn-abc.scope", MANUAL)
    falso = Tmux(14)
    monkeypatch.setattr(g, "tmux", falso)
    monkeypatch.setattr(g, "rodar", lambda *a, **k: pytest.fail("não deveria chamar systemd-run"))
    with pytest.raises(ValueError, match="por fora do cockpit"):
        g.ligar(g.AGENTES["canario"])
    assert not any(c[0] in {"new-session", "kill-session", "send-keys"} for c in falso.chamadas)


def test_ligar_com_sessao_do_cockpit_segue_ja_no_ar(g, monkeypatch):
    processo(g, 15, f"cockpit-tmux-canario-{HEX}.scope", MANUAL)
    monkeypatch.setattr(g, "tmux", Tmux(15))
    assert g.ligar(g.AGENTES["canario"]) == "já no ar"


@pytest.mark.parametrize("acao", ["desligar", "relancar"])
def test_desligar_e_relancar_nao_matam_sessao_de_fora(g, monkeypatch, acao):
    processo(g, 16, "tmux-spawn-abc.scope", MANUAL)
    falso = Tmux(16)
    monkeypatch.setattr(g, "tmux", falso)
    with pytest.raises(ValueError, match="por fora do cockpit"):
        getattr(g, acao)(g.AGENTES["canario"])
    assert not any(c[0] in {"kill-session", "send-keys"} for c in falso.chamadas)


def test_enviar_recusa_sessao_de_fora(g, monkeypatch):
    processo(g, 17, "tmux-spawn-abc.scope", MANUAL)
    falso = Tmux(17)
    monkeypatch.setattr(g, "tmux", falso)
    with pytest.raises(ValueError, match="por fora do cockpit"):
        g.enviar(g.AGENTES["canario"], "compactar", forcar=True)
    assert not any(c[0] == "send-keys" for c in falso.chamadas)


def test_estado_marca_fora_e_nao_troca_a_conversa_salva(g, monkeypatch):
    processo(g, 18, "tmux-spawn-abc.scope", MANUAL)
    monkeypatch.setattr(g, "tmux", Tmux(18))
    monkeypatch.setattr(g, "processo_claude", lambda pid: (4242, {"sessionId": "conversa-manual", "status": "idle"}))
    monkeypatch.setattr(g, "idade_processo", lambda pid: 5)
    e = g.estado(g.AGENTES["canario"], detalhar=False)
    assert e["ligado"] is True and e["fora"] is True
    assert not (g.ESTADO / "canario.session").exists()


def test_estado_do_cockpit_nao_e_fora_e_grava_a_conversa(g, monkeypatch):
    processo(g, 19, f"cockpit-tmux-canario-{HEX}.scope", MANUAL)
    monkeypatch.setattr(g, "tmux", Tmux(19))
    monkeypatch.setattr(g, "processo_claude", lambda pid: (4242, {"sessionId": "conversa-boa", "status": "idle"}))
    monkeypatch.setattr(g, "idade_processo", lambda pid: 5)
    e = g.estado(g.AGENTES["canario"], detalhar=False)
    assert e["fora"] is False
    assert (g.ESTADO / "canario.session").read_text().strip() == "conversa-boa"


def test_estado_desligado_nao_e_fora(g, monkeypatch):
    monkeypatch.setattr(g, "tmux", Tmux(None))
    e = g.estado(g.AGENTES["canario"], detalhar=False)
    assert e["ligado"] is False and e["fora"] is False


@pytest.mark.skipif(not shutil.which("tmux"), reason="sem tmux")
def test_tmux_real_aberto_a_mao_e_de_fora(g, monkeypatch):
    # Servidor tmux de verdade, num socket descartável, como o canario foi aberto.
    monkeypatch.setattr(g, "PROC", Path("/proc"))
    a = g.AGENTES["canario"]
    subprocess.run(["tmux", "-L", a["socket"], "-f", "/dev/null", "new-session", "-d", "-s", a["sessao"],
                    "sleep", "30"], check=True, timeout=10)
    try:
        assert g.do_cockpit(a) is False
        with pytest.raises(ValueError, match="por fora do cockpit"):
            g.ligar(a)
        assert g.ligado(a)  # a trava não derruba a sessão
    finally:
        subprocess.run(["tmux", "-L", a["socket"], "kill-server"], timeout=10)
