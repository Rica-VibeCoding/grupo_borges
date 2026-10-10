"""Opt-in local conserva flags e nunca chama o supervisor da VPS."""
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from services import tmux_driver as driver
from services.workspace_paths import validate_workspace


def test_default_continua_sem_lancador(monkeypatch):
    monkeypatch.delenv("COCKPIT_LANCADOR", raising=False)
    assert not driver.local_launcher_enabled()


def test_lancador_recebe_argv_sem_shell(monkeypatch, tmp_path):
    launcher = tmp_path / "agente.sh"
    launcher.touch()
    monkeypatch.setenv("COCKPIT_LANCADOR", str(launcher))
    sid = "11111111-1111-4111-8111-111111111111"
    with patch.object(driver.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
        driver._call_local_launcher("teste", "relancar", sid)
    assert run.call_args.args[0] == [str(launcher), "relancar", "teste", "--resume", sid]
    assert "shell" not in run.call_args.kwargs
    with patch.object(driver.subprocess, "run") as run:
        with pytest.raises(ValueError):
            driver._call_local_launcher("teste", "ligar", "../../outra")
        run.assert_not_called()


def test_desligar_local_nao_para_unit_da_vps(monkeypatch):
    monkeypatch.setenv("COCKPIT_LANCADOR", "/opt/agente.sh")
    with (patch.object(driver, "_call_local_launcher") as call,
          patch.object(driver, "_server_for", return_value=SimpleNamespace(has_session=lambda _: False)),
          patch.object(driver, "_stop_frota_unit") as stop):
        assert driver._shutdown_agent_sync("teste")["sessao_encerrada"]
    call.assert_called_once_with("teste", "desligar")
    stop.assert_not_called()


def test_boot_local_idempotente_nao_desliga(monkeypatch):
    monkeypatch.setenv("COCKPIT_LANCADOR", "/opt/agente.sh")
    with (patch.object(driver, "_local_launch_sync", return_value={"confirmed": True}) as call,
          patch.object(driver, "_shutdown_agent_sync") as stop):
        assert driver._boot_agent_sync("teste")["confirmed"]
    call.assert_called_once_with("teste", "ligar", None)
    stop.assert_not_called()


def test_cerca_de_workspace_default_config_e_symlink(monkeypatch, tmp_path):
    monkeypatch.setenv("GB_ALLOWED_WORKSPACE_ROOTS", "")
    root = tmp_path / "default"
    root.mkdir()
    assert validate_workspace(str(root / "repo"), root) == root / "repo"
    with pytest.raises(ValueError):
        validate_workspace(str(tmp_path / "outro"), root)
    allowed = tmp_path / "permitido"
    allowed.mkdir()
    monkeypatch.setenv("GB_ALLOWED_WORKSPACE_ROOTS", str(allowed))
    assert validate_workspace(str(allowed), root) == allowed
    (allowed / "fuga").symlink_to(root, target_is_directory=True)
    with pytest.raises(ValueError):
        validate_workspace(str(allowed / "fuga"), root)


def test_lancador_conserva_flags_na_retoma_e_na_nova(tmp_path):
    # Carrega a cópia versionada com config isolada, sem ler/mexer na frota real.
    import importlib.util
    import shutil

    source = Path(__file__).resolve().parents[3] / "scripts/cockpit-local/agentes.py"
    shutil.copy(source, tmp_path / "agentes.py")
    config = dict(ip_tailscale="100.64.0.1", porta=8787, janela_tokens=200000,
                  claude="/bin/true", path="/usr/bin",
                  agentes=[dict(id="teste", nome="Teste", socket="cockpit-teste", sessao="teste",
                                cwd=str(tmp_path), state_dir=str(tmp_path / "estado"), boot=False,
                                flags=["--model", "claude-opus-5-5", "--effort", "medium",
                                       "--settings", str(tmp_path / "settings.json"),
                                       "--mcp-config", str(tmp_path / "mcp.json")])])
    (tmp_path / "agentes.json").write_text(json.dumps(config))
    spec = importlib.util.spec_from_file_location("launcher_test", tmp_path / "agentes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ESTADO = tmp_path / "salvo"
    module.PROJETOS = tmp_path / "projects"
    sid = "11111111-1111-4111-8111-111111111111"
    project = module.PROJETOS / module.re.sub(r"[^a-zA-Z0-9]", "-", str(tmp_path))
    project.mkdir(parents=True)
    (project / (sid + ".jsonl")).touch()
    a = module.AGENTES["teste"]
    for nova, resume in [(False, sid), (True, None)]:
        with (patch.object(module, "ligado", side_effect=[False, False, True]),
              patch.object(module.shutil, "which", return_value="/usr/bin/true"),
              patch.object(module, "rodar", return_value=subprocess.CompletedProcess([], 0)) as run):
            module.ligar(a, resume=resume, nova=nova)
        argv = run.call_args.args[0]
        for flag, value in [("--model", "claude-opus-5-5"), ("--effort", "medium"),
                            ("--settings", str(tmp_path / "settings.json")),
                            ("--mcp-config", str(tmp_path / "mcp.json"))]:
            assert argv[argv.index(flag) + 1] == value
        assert not any(v.startswith("TELEGRAM_STATE_DIR=") for v in argv)
        assert module.ambiente(a)["TELEGRAM_STATE_DIR"] == a["state_dir"]
        assert "--channels" in argv
        assert argv[argv.index("--channels") + 1] == "plugin:telegram@claude-plugins-official"
        assert ("--resume" in argv) != nova
        if resume:
            assert argv[argv.index("--resume") + 1] == sid
        else:
            assert "--session-id" in argv


@pytest.fixture
def launcher_env(tmp_path):
    import importlib.util
    import shutil

    source = Path(__file__).resolve().parents[3] / "scripts/cockpit-local/agentes.py"
    shutil.copy(source, tmp_path / "agentes.py")
    config = dict(ip_tailscale="100.64.0.1", porta=8787, janela_tokens=1000000,
                  claude="/bin/true", path="/usr/bin",
                  agentes=[dict(id="teste", nome="Teste", socket="cockpit-teste", sessao="teste",
                                cwd=str(tmp_path), boot=False, flags=[])])
    (tmp_path / "agentes.json").write_text(json.dumps(config))
    spec = importlib.util.spec_from_file_location("launcher_env_test", tmp_path / "agentes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ESTADO = tmp_path / "salvo"
    return module, module.AGENTES["teste"]


def test_env_privado_literal_apenas_no_execve(launcher_env, tmp_path, monkeypatch):
    module, a = launcher_env
    segredo = "credencial-ficticia-$(sem-execucao)"
    arquivo = tmp_path / "motor.env"
    arquivo.write_text(f"# motor\nANTHROPIC_API_KEY={segredo}\nANTHROPIC_MODEL=deepseek[1m]\n")
    arquivo.chmod(0o600)
    a.update(env_arquivo=str(arquivo), env_remover=["ANTHROPIC_AUTH_TOKEN"])
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "token-ficticio-herdado")
    monkeypatch.setenv("TELEGRAM_STATE_DIR", "/estado/herdado")
    with (patch.object(module, "ligado", side_effect=[False, False, True]),
          patch.object(module.shutil, "which", return_value="/usr/bin/true"),
          patch.object(module, "rodar", return_value=subprocess.CompletedProcess([], 0)) as run):
        module.ligar(a)
    argv = run.call_args.args[0]
    assert segredo not in " ".join(argv)
    assert "--channels" not in argv
    monkeypatch.setattr(module.sys, "argv", ["agentes.py", "--exec", "teste", "--model", "deepseek"])
    with patch.object(module.os, "execve") as execute:
        module.main()
    executable, claude_argv, env = execute.call_args.args
    assert executable == "/bin/true"
    assert claude_argv == ["/bin/true", "--model", "deepseek"]
    assert env["ANTHROPIC_API_KEY"] == segredo
    assert "ANTHROPIC_AUTH_TOKEN" not in env
    assert "TELEGRAM_STATE_DIR" not in env
    assert env["PATH"] == "/usr/bin"
    assert segredo not in " ".join(claude_argv)


@pytest.mark.parametrize("invalido", ["modo", "symlink", "nome", "nul", "encoding", "ausente", "diretorio"])
def test_env_invalido_recusa_antes_de_criar_tmux(launcher_env, tmp_path, invalido):
    module, a = launcher_env
    arquivo = tmp_path / "motor.env"
    segredo = "credencial-ficticia-nao-publicavel"
    arquivo.write_text(f"API_KEY={segredo}\n")
    arquivo.chmod(0o600)
    if invalido == "modo":
        arquivo.chmod(0o644)
    elif invalido == "symlink":
        link = tmp_path / "link.env"
        link.symlink_to(arquivo)
        arquivo = link
    elif invalido in {"nome", "nul"}:
        arquivo.write_text(f"{segredo}\n" if invalido == "nome" else f"KEY={segredo}\0\n")
    elif invalido == "encoding":
        arquivo.write_bytes(b"KEY=\xff" + segredo.encode() + b"\n")
    elif invalido == "ausente":
        arquivo.unlink()
    elif invalido == "diretorio":
        arquivo = tmp_path
    a["env_arquivo"] = str(arquivo)
    with (patch.object(module, "ligado", return_value=False),
          patch.object(module.shutil, "which", return_value="/usr/bin/true"),
          patch.object(module, "rodar") as run):
        with pytest.raises((ValueError, OSError)) as error:
            module.ligar(a)
    run.assert_not_called()
    assert segredo not in str(error.value)


def test_sem_env_arquivo_preserva_ambiente_e_state_dir_opcional(launcher_env, monkeypatch):
    module, a = launcher_env
    monkeypatch.setenv("CUSTOM_TEST", "valor-herdado")
    env = module.ambiente(a)
    assert env["CUSTOM_TEST"] == "valor-herdado"
    assert "TELEGRAM_STATE_DIR" not in env
    a["state_dir"] = "/canal/existente"
    assert module.ambiente(a)["TELEGRAM_STATE_DIR"] == "/canal/existente"


@pytest.mark.parametrize("local", [False, True])
async def test_troca_longa_retorna_202_sem_cancelar_operacao(monkeypatch, local):
    import asyncio
    from unittest.mock import AsyncMock

    from routers import conversas
    from services import operacao_conversa as operacao

    if local:
        monkeypatch.setenv("COCKPIT_LANCADOR", "/opt/agente.sh")
    else:
        monkeypatch.delenv("COCKPIT_LANCADOR", raising=False)
    slug = "teste-resposta-local"
    operacao.esquecer(slug)
    op = operacao.comecar(slug)
    continuar = asyncio.Event()

    async def concluir():
        await continuar.wait()
        operacao.avancar(op, "pronta")

    tarefa = asyncio.create_task(concluir())
    try:
        with patch.object(conversas.asyncio, "wait_for", AsyncMock(side_effect=TimeoutError)) as wait:
            resposta = await conversas._responder(slug, op, tarefa)
        assert resposta.status_code == 202
        assert not tarefa.cancelled() and not tarefa.done()
        assert wait.call_args.kwargs["timeout"] == (
            operacao.TETO_RESPOSTA_LOCAL_S if local else operacao.TETO_RESPOSTA_S
        )
        continuar.set()
        await tarefa
        resposta_final = await conversas._responder(slug, op, tarefa)
        assert resposta_final.fase == "pronta"
    finally:
        continuar.set()
        await tarefa
        operacao.esquecer(slug)


def test_painel_ignora_modelo_e_uso_sinteticos(launcher_env, tmp_path):
    module, _ = launcher_env
    arquivo = tmp_path / "conversa.jsonl"
    arquivo.write_text("\n".join(json.dumps(dict(message=m)) for m in [
        dict(model="deepseek-v4.1-flash", usage=dict(input_tokens=261, cache_read_input_tokens=56576)),
        dict(model="<synthetic>", usage=dict(input_tokens=0, output_tokens=0)),
    ]))
    with patch.object(module, "arquivo_sessao", return_value=arquivo):
        assert module.contexto("teste") == (56837, "deepseek-v4.1-flash")


@pytest.mark.parametrize("mesma_sessao", [False, True])
def test_painel_tem_modelo_antes_do_primeiro_turno_so_da_sessao_viva(launcher_env, mesma_sessao):
    module, a = launcher_env
    sid = "11111111-1111-4111-8111-111111111111"
    result = subprocess.CompletedProcess([], 0, stdout="%0\t321\t0\n")
    telemetria = dict(session_id=sid if mesma_sessao else "outra", model=dict(id="deepseek-v4.1-flash[1m]"))
    with (patch.object(module, "tmux", return_value=result),
          patch.object(module, "processo_claude", return_value=(321, dict(sessionId=sid, status="idle"))),
          patch.object(module, "idade_processo", return_value=1),
          patch.object(module, "contexto", return_value=(None, None)),
          patch.object(module, "json_ler", return_value=telemetria)):
        e = module.estado(a)
    assert e["modelo"] == ("deepseek-v4.1-flash[1m]" if mesma_sessao else None)
