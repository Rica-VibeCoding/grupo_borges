"""Atribuição e fechamento de Codex sem capturar o scope compartilhado."""
import os
import shutil
import signal

import pytest

from test_maquinas import linux, frota, total, falha


CG = "borges.slice/borges-frota.slice/run-u5465.scope"


def codex(linux, *, ppid=1, pid=500, nome=CG):
    linux.processo(pid, ppid=ppid, args=("node", "/home/clawd/.local/bin/codex", "exec", "teste"), pss=1024)
    linux.processo(pid + 1, ppid=pid, args=("/vendor/bin/codex", "exec", "teste"), pss=2048)
    linux.processo(pid + 2, ppid=pid + 1, args=("worker",), pss=4096)
    arquivo = linux.m.cgroup / nome / "cgroup.procs"
    antigos = [int(v) for v in arquivo.read_text().split()] if arquivo.exists() else []
    linux.scope(nome, *antigos, pid, pid + 1, pid + 2)


def test_codex_orfao_tem_ram_cpu_proprias_e_some(linux, frota, monkeypatch):
    monkeypatch.setattr(os, "cpu_count", lambda: 4)
    frota.sessao()
    antes = frota.m.abertos()
    codex(linux)
    frota.m.amostrar()
    stat = linux.m.proc / "501/stat"
    prefixo, dados = stat.read_text().rsplit(")", 1)
    campos = dados.split()
    campos[11] = str(2 * os.sysconf("SC_CLK_TCK"))
    stat.write_text(prefixo + ") " + " ".join(campos))
    total(linux, ocupado=80, ocioso=1720)
    linux.agora[1] = 4
    frota.m.amostrar()
    leitura = frota.m.abertos()
    cadeira = next(i for i in leitura["itens"] if i["rotulo"] == "Pavan · Codex")
    assert (cadeira["grupo"], cadeira["dono"], cadeira["memoria_mb"], cadeira["cpu_pct"]) == ("terminal", "Pavan", 7, 12.5)
    assert next(i for i in leitura["itens"] if i["rotulo"] == "Pavan")["memoria_mb"] == 7
    assert antes["itens"][-1]["memoria_mb"] - leitura["itens"][-1]["memoria_mb"] == 7
    for pid in (500, 501, 502):
        shutil.rmtree(linux.m.proc / str(pid))
    assert not any(i["rotulo"].endswith(" · Codex") for i in frota.m.abertos()["itens"])


@pytest.mark.parametrize("ppid", [1, 102])
def test_codex_nao_duplica_launcher_nativo_nem_sessao(linux, frota, ppid):
    frota.sessao()
    codex(linux, ppid=ppid)
    scopes = frota.m.scopes()
    cadeira = next(s for s in scopes if frota.m.rotulo(s, {})[0] == "Pavan · Codex")
    assert {p.pid for p in cadeira.processos} == {500, 501, 502}
    pids = [p.pid for s in scopes for p in s.processos]
    assert len(pids) == len(set(pids))
    # A identidade não muda quando o launcher perde seu pai.
    linux.processo(500, ppid=1, args=("node", "/home/clawd/.local/bin/codex", "exec", "teste"))
    assert cadeira.id in {s.id for s in frota.m.scopes()}


def test_codex_scope_ambiguo_exige_parentesco(linux, frota):
    frota.sessao()
    frota.sessao("daniel", 200, scope="app.slice/tmux-spawn-b.scope")
    codex(linux)
    assert not any(i["rotulo"].endswith(" · Codex") for i in frota.m.abertos()["itens"])
    codex(linux, ppid=102, pid=600)
    cadeira = next(s for s in frota.m.scopes() if frota.m.rotulo(s, {})[0] == "Pavan · Codex")
    assert {p.pid for p in cadeira.processos} == {600, 601, 602}


@pytest.mark.parametrize("nome", ["app.slice/outro.scope", "system.slice/worker.service"])
def test_codex_sem_dono_ou_em_servico_fica_protegido(linux, frota, nome):
    frota.sessao()
    codex(linux, nome=nome)
    assert not any(i["rotulo"].endswith(" · Codex") for i in frota.m.abertos()["itens"])


@pytest.mark.parametrize("args", [("codex", "app-server"), ("codex", "login"), ("bash", "-c", "codex exec teste"), ("python", "codex", "exec")])
def test_codex_so_exec_e_executavel_explicito(linux, frota, args):
    frota.sessao()
    codex(linux)
    linux.processo(500, args=args)
    linux.processo(501, ppid=500, args=("worker",))
    assert not any(i["rotulo"].endswith(" · Codex") for i in frota.m.abertos()["itens"])


def test_fechar_codex_so_sinaliza_cadeira(linux, frota, monkeypatch):
    frota.sessao()
    codex(linux)
    cadeira = next(s for s in frota.m.scopes() if frota.m.rotulo(s, {})[0] == "Pavan · Codex")
    sinais = []
    monkeypatch.setattr(os, "pidfd_open", lambda pid: pid + 1000)
    fechar_original = os.close
    monkeypatch.setattr(os, "close", lambda fd: None if fd >= 1000 else fechar_original(fd))
    def sinalizar(fd, sig):
        assert sig == signal.SIGTERM
        sinais.append(fd - 1000)
        shutil.rmtree(linux.m.proc / str(fd - 1000))
    monkeypatch.setattr(signal, "pidfd_send_signal", sinalizar)
    assert frota.m.fechar(cadeira.id) == {"liberou_mb": 7}
    assert sinais == [502, 501, 500]
    assert frota.m.processo(102) is not None
    assert frota.m.processo(100) is not None


def test_fechar_codex_recusa_pid_reciclado(linux, frota, monkeypatch):
    frota.sessao()
    codex(linux)
    cadeira = next(s for s in frota.m.scopes() if frota.m.rotulo(s, {})[0] == "Pavan · Codex")
    def abrir(pid):
        linux.processo(pid, inicio=99999)
        return 1500
    monkeypatch.setattr(os, "pidfd_open", abrir)
    monkeypatch.setattr(os, "close", lambda fd: None)
    falha(409, frota.m.fechar, cadeira.id)
