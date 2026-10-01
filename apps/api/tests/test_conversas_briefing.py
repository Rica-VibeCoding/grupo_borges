# ruff: noqa: F811 — `bancada` vem importada e entra como parâmetro
"""F7 de `docs/conversas/PLANO.md` — arquivos da conversa, `pendencia` e briefing.

Um repositório git de verdade em `tmp_path`, com histórico datado: o commit
inicial é de 3 h atrás e a conversa parou há 1 h, então só o que veio depois
dela entra no briefing. A conversa é um JSONL escrito à mão no formato medido
no Omarchy (CC 2.1.284): caminho relativo ao cwd no `file-history-snapshot`,
absoluto no `input` do `Write`/`Edit`.
"""
from __future__ import annotations

import json
import os
import socket
import sqlite3
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_conversas_lista import PAVAN, _get, _por_id, bancada  # noqa: F401

from services import briefing_retorno
from services import conversas as conversas_service

ID_OBRA = "77777777-7777-4777-8777-777777777777"
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "briefing-retorno.sh"
_HORA = 3600


def _git(repo: Path, *args: str, quando: float | None = None) -> None:
    env = {**os.environ, "GIT_AUTHOR_NAME": "Teste", "GIT_AUTHOR_EMAIL": "t@t",
           "GIT_COMMITTER_NAME": "Teste", "GIT_COMMITTER_EMAIL": "t@t"}
    if quando is not None:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = f"@{int(quando)} +0000"
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=env)


def _linha(tipo: str, **campos) -> str:
    return json.dumps({"type": tipo, **campos}, separators=(",", ":"))


def _mensagem(tipo: str, **campos) -> str:
    """Como o CC grava: `parentUuid` na frente, `type` no meio da linha."""
    return json.dumps({"parentUuid": None, "isSidechain": False, **campos, "type": tipo},
                      separators=(",", ":"))


def _usuario(texto: str, cwd: Path) -> str:
    return _mensagem("user", cwd=str(cwd), message={"role": "user", "content": texto})


def _snapshot(*caminhos: str) -> str:
    backups = {c: {"backupFileName": "abc@v2", "version": 2, "backupTime": "x",
                   "realParentDir": "x"} for c in caminhos}
    return _linha("file-history-snapshot", messageId="m",
                  snapshot={"messageId": "m", "trackedFileBackups": backups},
                  isSnapshotUpdate=False)


def _ferramenta(nome: str, **entrada) -> str:
    return _mensagem("assistant", message={
        "role": "assistant",
        "content": [{"type": "tool_use", "id": "t", "name": nome, "input": entrada}],
    })


@pytest.fixture
def obra(bancada, tmp_path: Path):
    """Repo com 4 arquivos commitados há 3 h; a conversa parou há 1 h.

    Ela editou `editado.py` (snapshot, relativo), criou `criado.py` no último
    turno (só no `Write`), mexeu em `via_bash.py` só por Bash e leu `lido.py`.
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    for nome in ("editado.py", "via_bash.py", "lido.py", "intocado.py"):
        (repo / nome).write_text("v1\n")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "inicial", quando=time.time() - 3 * _HORA)

    jsonl = bancada.pasta / f"{ID_OBRA}.jsonl"
    linhas = [
        _usuario("arruma o editado", repo),
        _ferramenta("Edit", file_path=str(repo / "editado.py"), old_string="v1", new_string="v2"),
        _ferramenta("Read", file_path=str(repo / "lido.py")),
        _usuario("agora cria o outro", repo),
        _snapshot("editado.py"),
        _ferramenta("Write", file_path=str(repo / "criado.py"), content="novo\n"),
        _ferramenta("Bash", command=f"echo x >> {repo / 'via_bash.py'}"),
        _usuario("valeu", repo),
    ]
    jsonl.write_text("\n".join(linhas) + "\n")
    parou = time.time() - _HORA
    for nome in ("editado.py", "via_bash.py", "lido.py", "intocado.py"):
        os.utime(repo / nome, (parou - 60, parou - 60))
    os.utime(jsonl, (parou, parou))
    briefing_retorno._status.clear()
    briefing_retorno._raizes.clear()
    bancada.repo, bancada.jsonl, bancada.parou = repo, jsonl, parou
    return bancada


def _marcar_retomada(bancada, session_id: str, *, ha_s: float = 5, atividade: float | None) -> None:
    agora = time.time()
    with sqlite3.connect(bancada.db.db_path) as conn:
        conn.execute(
            "INSERT INTO conversa_meta (slug, session_id, retomada_em, atividade_em) "
            "VALUES ('pavan', ?, ?, ?) ON CONFLICT(slug, session_id) DO UPDATE SET "
            "retomada_em = excluded.retomada_em, atividade_em = excluded.atividade_em",
            (session_id, int((agora - ha_s) * 1000),
             int(atividade * 1000) if atividade else None),
        )


def _briefing(bancada, session_id: str = ID_OBRA, slug: str = "pavan") -> str:
    with TestClient(bancada.app) as client:
        r = client.get(f"/api/agents/{slug}/conversas/{session_id}/briefing")
    assert r.status_code == 200, r.text
    return r.json()["briefing"]


# ---------- quais arquivos a conversa mexeu ----------


def test_arquivos_vem_do_snapshot_e_das_edicoes_nao_do_bash_nem_da_leitura(obra) -> None:
    st = obra.jsonl.stat()
    arquivos = conversas_service.arquivos_de(obra.jsonl, st, cwd_padrao=None)
    repo = obra.repo
    # `editado.py` mora relativo no snapshot e resolve no cwd da conversa;
    # `criado.py` foi escrito no último turno, que nenhum snapshot cobre.
    assert arquivos == [str(repo / "criado.py"), str(repo / "editado.py")]


def test_limitacao_arquivo_mexido_so_por_bash_nao_aparece(obra) -> None:
    """Limitação conhecida: o JSONL não diz que caminho um comando de shell tocou."""
    (obra.repo / "via_bash.py").write_text("mudou por sed\n")
    arquivos = conversas_service.arquivos_de(obra.jsonl, obra.jsonl.stat(), cwd_padrao=None)
    assert str(obra.repo / "via_bash.py") not in arquivos


def test_releitura_incremental_soma_arquivos_sem_mexer_no_cache_antigo(obra) -> None:
    st = obra.jsonl.stat()
    antes = conversas_service.arquivos_de(obra.jsonl, st, cwd_padrao=None)
    with obra.jsonl.open("a") as f:
        f.write(_ferramenta("Edit", file_path=str(obra.repo / "intocado.py")) + "\n")
    depois = conversas_service.arquivos_de(obra.jsonl, obra.jsonl.stat(), cwd_padrao=None)
    assert set(depois) - set(antes) == {str(obra.repo / "intocado.py")}
    assert str(obra.repo / "intocado.py") not in antes


# ---------- pendência (⚠️ na lista) ----------


def test_pendencia_conta_arquivo_sujo_da_conversa_e_filtra_a_lista(obra) -> None:
    parou = obra.parou
    (obra.repo / "editado.py").write_text("v2\n")
    (obra.repo / "criado.py").write_text("novo\n")
    for nome in ("editado.py", "criado.py"):
        os.utime(obra.repo / nome, (parou - 10, parou - 10))
    (obra.repo / "intocado.py").write_text("sujo, mas não é dela\n")

    corpo = _get(obra, curtas=1)
    itens = _por_id(corpo)
    assert itens[ID_OBRA]["pendencia"] == 2
    # As fixtures da F2 não mexeram em arquivo nenhum de repositório.
    assert {c["pendencia"] for i, c in itens.items() if i != ID_OBRA} == {0}
    so_pendentes = _get(obra, curtas=1, filtro="pendencia")["conversas"]
    assert [c["id"] for c in so_pendentes] == [ID_OBRA]


def test_pendencia_nao_conta_arquivo_que_outra_conversa_mexeu_depois(obra) -> None:
    (obra.repo / "editado.py").write_text("outro agente mexeu depois\n")  # mtime = agora
    assert _por_id(_get(obra, curtas=1))[ID_OBRA]["pendencia"] == 0


def test_repo_limpo_da_pendencia_zero(obra) -> None:
    assert _por_id(_get(obra, curtas=1))[ID_OBRA]["pendencia"] == 0


# ---------- GET /{id}/briefing ----------


def test_briefing_lista_commits_desde_a_parada_e_o_que_segue_sem_commit(obra) -> None:
    repo = obra.repo
    (repo / "editado.py").write_text("v3\n")
    _git(repo, "commit", "-qam", "feat: mexe no editado depois da conversa")
    (repo / "intocado.py").write_text("v2\n")
    _git(repo, "commit", "-qam", "chore: arquivo que a conversa nunca tocou")
    (repo / "criado.py").write_text("novo\n")
    _marcar_retomada(obra, ID_OBRA, atividade=obra.parou)

    texto = _briefing(obra)
    assert "feat: mexe no editado depois da conversa" in texto
    assert "arquivo que a conversa nunca tocou" not in texto
    assert "inicial" not in texto  # commit de antes da parada
    assert f"{repo.name} criado.py (??)" in texto
    assert len(texto.splitlines()) <= briefing_retorno.LINHAS_MAX


def test_briefing_de_repo_sem_mudanca_vem_vazio(obra) -> None:
    _marcar_retomada(obra, ID_OBRA, atividade=obra.parou)
    assert _briefing(obra) == ""


def test_continue_comum_sem_marca_de_retomada_nao_recebe_briefing(obra) -> None:
    (obra.repo / "editado.py").write_text("v2\n")
    assert _briefing(obra) == ""


def test_marca_e_gasta_numa_vez_e_vence_em_10_min(obra) -> None:
    (obra.repo / "editado.py").write_text("v2\n")
    _marcar_retomada(obra, ID_OBRA, atividade=obra.parou)
    assert "editado.py" in _briefing(obra)
    assert _briefing(obra) == ""  # a segunda largada (um --continue depois) não recebe

    _marcar_retomada(obra, ID_OBRA, ha_s=11 * 60, atividade=obra.parou)
    assert _briefing(obra) == ""


def test_retomar_de_novo_rearma_a_marca(obra) -> None:
    (obra.repo / "editado.py").write_text("v2\n")
    _marcar_retomada(obra, ID_OBRA, ha_s=60, atividade=obra.parou)
    assert _briefing(obra) != ""
    _marcar_retomada(obra, ID_OBRA, ha_s=-1, atividade=obra.parou)
    assert _briefing(obra) != ""


def test_briefing_aceita_a_sessao_tmux_no_lugar_do_slug(obra) -> None:
    obra.db._sync_agents([{**PAVAN, "tmux_session": "pavan-linha"}])
    (obra.repo / "editado.py").write_text("v2\n")
    _marcar_retomada(obra, ID_OBRA, atividade=obra.parou)
    assert "editado.py" in _briefing(obra, slug="pavan-linha")


def test_briefing_de_conversa_de_outro_agente_e_404(obra) -> None:
    with TestClient(obra.app) as client:
        r = client.get(f"/api/agents/daniel/conversas/{ID_OBRA}/briefing")
    assert r.status_code == 404


def test_briefing_corta_em_25_linhas(obra) -> None:
    repo = obra.repo
    linhas = [_usuario("muitos", repo)]
    for i in range(30):
        (repo / f"novo_{i:02}.py").write_text("x\n")
        linhas.append(_ferramenta("Write", file_path=str(repo / f"novo_{i:02}.py")))
    for i in range(15):
        (repo / "editado.py").write_text(f"v{i}\n")
        _git(repo, "commit", "-qam", f"commit {i}")
    with obra.jsonl.open("a") as f:
        f.write("\n".join(linhas) + "\n")
    _marcar_retomada(obra, ID_OBRA, atividade=obra.parou)

    texto = _briefing(obra)
    assert len(texto.splitlines()) <= briefing_retorno.LINHAS_MAX
    assert "… e mais" in texto


# ---------- scripts/briefing-retorno.sh ----------


def _rodar_script(tmp_path: Path, api: str, *, source: str = "resume") -> tuple[str, float]:
    bin_falso = tmp_path / "bin"
    bin_falso.mkdir(exist_ok=True)
    tmux = bin_falso / "tmux"
    tmux.write_text("#!/bin/sh\necho pavan\n")
    tmux.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_falso}:{os.environ['PATH']}",
           "TMUX": "/tmp/falso,1,0", "COCKPIT_API_URL": api}
    entrada = json.dumps({"session_id": ID_OBRA, "source": source, "cwd": "/x"})
    inicio = time.monotonic()
    feito = subprocess.run([str(SCRIPT)], input=entrada, capture_output=True, text=True,
                           env=env, timeout=10)
    assert feito.returncode == 0
    return feito.stdout, time.monotonic() - inicio


class _ApiFalsa(BaseHTTPRequestHandler):
    resposta: dict = {}
    pedidos: list[tuple[str, str | None]] = []
    atraso = 0.0

    def do_GET(self) -> None:  # noqa: N802 — nome do http.server
        _ApiFalsa.pedidos.append((self.path, self.headers.get("Tailscale-User-Login")))
        time.sleep(_ApiFalsa.atraso)
        corpo = json.dumps(_ApiFalsa.resposta).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(corpo)

    def log_message(self, *args) -> None:
        pass


@pytest.fixture
def api_falsa():
    servidor = HTTPServer(("127.0.0.1", 0), _ApiFalsa)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    _ApiFalsa.pedidos, _ApiFalsa.atraso = [], 0.0
    yield f"http://127.0.0.1:{servidor.server_address[1]}"
    servidor.shutdown()


def test_script_devolve_additional_context(tmp_path, api_falsa) -> None:
    _ApiFalsa.resposta = {"briefing": "Briefing de retorno: linha 1\nlinha 2"}
    saida, _ = _rodar_script(tmp_path, api_falsa)
    assert json.loads(saida) == {"hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": "Briefing de retorno: linha 1\nlinha 2",
    }}
    assert _ApiFalsa.pedidos == [
        (f"/api/agents/pavan/conversas/{ID_OBRA}/briefing", "agente-pavan")
    ]


def test_script_calado_com_briefing_vazio_e_fora_do_resume(tmp_path, api_falsa) -> None:
    _ApiFalsa.resposta = {"briefing": ""}
    assert _rodar_script(tmp_path, api_falsa)[0] == ""
    _ApiFalsa.resposta = {"briefing": "algo"}
    assert _rodar_script(tmp_path, api_falsa, source="startup")[0] == ""


def test_script_calado_em_ate_3_s_com_a_api_fora(tmp_path) -> None:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        porta = s.getsockname()[1]
    saida, levou = _rodar_script(tmp_path, f"http://127.0.0.1:{porta}")
    assert (saida, levou < 3) == ("", True)


def test_script_calado_em_ate_3_s_com_a_api_pendurada(tmp_path, api_falsa) -> None:
    _ApiFalsa.resposta, _ApiFalsa.atraso = {"briefing": "tarde demais"}, 3.5
    saida, levou = _rodar_script(tmp_path, api_falsa)
    assert (saida, levou < 3) == ("", True)
