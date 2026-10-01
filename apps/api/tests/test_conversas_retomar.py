# ruff: noqa: F811 — `bancada` e `palco` vêm importadas e entram como parâmetro
"""F6 de `docs/conversas/PLANO.md` — `POST /{id}/retomar`.

A bancada e o agente falso são os da F5 (`test_conversas_nova`). Por cima,
uma **linha falsa**: desligar, ligar com `--resume`/`--continue` e o estado da
largada (subindo, diálogo, pronta). O banco fica parado na conversa de antes,
como o watcher fica até a retomada ganhar mensagem.
"""
from __future__ import annotations

import os
import sqlite3
import time
from types import SimpleNamespace

import pytest
from test_conversas_lista import (  # noqa: F401 — `bancada` é fixture
    ID_CUSTOM,
    ID_NOME,
    ID_PROMPT,
    bancada,
)
from test_conversas_nova import palco  # noqa: F401 — fixture

from routers import conversas as conversas_router
from services import conversas as conversas_service
from services import operacao_conversa as operacao
from services import tmux_driver

ID_DE_FORA = "99999999-9999-4999-8999-999999999999"


class LinhaFalsa:
    """A sessão tmux do Pavan do ponto de vista do desligar/ligar."""

    def __init__(self, palco) -> None:
        self.palco = palco
        self.pasta = palco.bancada.pasta
        self.boots: list[str | None] = []
        self.desligamentos = 0
        self.escapes = 0
        self.conversa: str | None = ID_CUSTOM
        #: Exceção do boot com `--resume` (falha no boot).
        self.falha_resume: Exception | None = None
        self.falha_continue: Exception | None = None
        #: Escapes que o diálogo de retomada pede para sair; `None` = sem diálogo.
        self.dialogo: int | None = None
        #: Mais recente da pasta no instante de cada `--continue`.
        self.recente_no_continue: list[str | None] = []
        self.ordem: list[str] = []

    def _tocar(self, session_id: str) -> None:
        agora = time.time() + 5
        os.utime(self.pasta / f"{session_id}.jsonl", (agora, agora))

    async def shutdown_agent(self, sessao: str) -> dict:
        assert sessao == "pavan"
        self.ordem.append(f"desligar:{operacao.estado('pavan').fase}")
        self.desligamentos += 1
        # A conversa que rodava acabou de ser escrita (a resposta do estacionar).
        if self.conversa:
            agora = time.time()
            os.utime(self.pasta / f"{self.conversa}.jsonl", (agora, agora))
        self.palco.bancada.vivas.discard("pavan")
        self.palco.bancada.processos.pop("pavan", None)
        return {"attempted": True, "sessao_encerrada": True, "scopes_parados": []}

    async def boot_agent(self, sessao: str, resume_session_id: str | None = None) -> dict:
        assert sessao == "pavan"
        self.boots.append(resume_session_id)
        if resume_session_id is None:
            self.recente_no_continue.append(conversas_service.mais_recente(self.pasta))
            if self.falha_continue:
                raise self.falha_continue
            self.conversa = conversas_service.mais_recente(self.pasta)
        else:
            if self.falha_resume:
                raise self.falha_resume
            self._tocar(resume_session_id)
            self.conversa = resume_session_id
            # O argv do Claude guarda o `--resume`; a largada é agora.
            self.palco.bancada.processos["pavan"] = (resume_session_id, time.time())
        self.palco.bancada.vivas.add("pavan")
        return {"attempted": True, "confirmed": True}

    async def estado_da_largada(self, sessao: str) -> str:
        if "pavan" not in self.palco.bancada.vivas:
            return "ausente"
        if self.dialogo is not None and self.boots[-1] and self.escapes < self.dialogo:
            return "dialogo"
        return "pronta"

    async def send_named_key(self, sessao: str, tecla: str) -> bool:
        assert tecla == "Escape"
        self.escapes += 1
        return True


@pytest.fixture
def linha(palco, monkeypatch):
    falsa = LinhaFalsa(palco)
    for nome in ("shutdown_agent", "boot_agent", "estado_da_largada", "send_named_key"):
        monkeypatch.setattr(tmux_driver, nome, getattr(falsa, nome))
    monkeypatch.setattr(
        conversas_router.desligamento_deliberado, "marcar",
        lambda sessao: falsa.ordem.append(f"marcar:{sessao}"),
    )
    monkeypatch.setattr(
        conversas_router.desligamento_deliberado, "desmarcar",
        lambda sessao: falsa.ordem.append(f"desmarcar:{sessao}"),
    )
    return SimpleNamespace(falsa=falsa, cliente=palco.cliente, agente=palco.agente, palco=palco)


async def _retomar(linha, session_id: str, **corpo):
    return await linha.cliente.post(
        f"/api/agents/pavan/conversas/{session_id}/retomar", json=corpo
    )


def _retomada_em(bancada, session_id: str) -> int | None:
    with sqlite3.connect(bancada.db.db_path) as conn:
        linha = conn.execute(
            "SELECT retomada_em FROM conversa_meta WHERE slug = 'pavan' AND session_id = ?",
            (session_id,),
        ).fetchone()
    return linha[0] if linha else None


# ---------- caminho feliz ----------


async def test_retomar_estaciona_derruba_e_sobe_com_resume(linha) -> None:
    falsa, agente = linha.falsa, linha.agente
    r = await _retomar(linha, ID_PROMPT)
    assert r.status_code == 200, r.text
    assert (r.json()["fase"], r.json()["nota"]) == ("pronta", True)

    pedido, = agente.enviados  # só o pedido de estacionar: nada de /clear
    assert pedido.startswith("[cockpit] Vou fechar esta conversa e retomar")
    assert falsa.boots == [ID_PROMPT]
    assert falsa.ordem == ["marcar:pavan", "desligar:religando", "desmarcar:pavan"]
    assert agente.passos == ["pedido:estacionando"]
    assert _retomada_em(linha.palco.bancada, ID_PROMPT) is not None
    # A nota foi para a conversa que saiu.
    corpo = (await linha.cliente.get("/api/agents/pavan/conversas")).json()
    itens = {c["id"]: c for c in corpo["conversas"]}
    assert itens[ID_CUSTOM]["titulo"] == "Feed enxuto"
    # O banco ainda aponta a de antes; a lista já mostra a retomada como atual,
    # e a que saiu (escrita agora) não fica 🔒 por 2 min.
    assert itens[ID_PROMPT]["atual"] is True
    assert (itens[ID_CUSTOM]["atual"], itens[ID_CUSTOM]["bloqueada"]) == (False, False)


async def test_a_b_a_seguidos(linha) -> None:
    assert (await _retomar(linha, ID_PROMPT)).status_code == 200
    linha.agente.resposta = {"titulo": "Prompt antigo", "nota": "segunda volta"}
    r = await _retomar(linha, ID_CUSTOM)
    assert r.status_code == 200, r.text
    assert linha.falsa.boots == [ID_PROMPT, ID_CUSTOM]
    itens = {
        c["id"]: c
        for c in (await linha.cliente.get("/api/agents/pavan/conversas?curtas=1")).json()[
            "conversas"
        ]
    }
    # O segundo estacionar gravou na B, não na A que o banco ainda aponta.
    assert itens[ID_PROMPT]["titulo"] == "Prompt antigo"
    assert itens[ID_CUSTOM]["atual"] is True


async def test_agente_desligado_sobe_direto_sem_estacionar(linha) -> None:
    linha.palco.bancada.vivas.discard("pavan")
    r = await _retomar(linha, ID_PROMPT)
    assert r.status_code == 200, r.text
    assert linha.agente.enviados == []
    assert linha.falsa.boots == [ID_PROMPT]


# ---------- F7b: a atual depois de um restart da API ----------


def _envelhecer(bancada, session_id: str, idade_s: float) -> None:
    quando = time.time() - idade_s
    os.utime(bancada.pasta / f"{session_id}.jsonl", (quando, quando))


async def _itens(linha) -> dict[str, dict]:
    corpo = (await linha.cliente.get("/api/agents/pavan/conversas?curtas=1")).json()
    return {c["id"]: c for c in corpo["conversas"]}


async def test_restart_da_api_apos_retomar_a_atual_vem_do_resume(linha) -> None:
    """O caso da VPS em 01/10: A → B, restart, banco ainda em A, sem mensagem em B."""
    bancada = linha.palco.bancada
    assert (await _retomar(linha, ID_PROMPT)).status_code == 200
    operacao.esquecer("pavan")  # o restart: a troca em memória some
    assert bancada.atuais["pavan"] == ID_CUSTOM  # o banco não viu mensagem em B

    itens = await _itens(linha)
    assert itens[ID_PROMPT]["atual"] is True
    # A foi escrita por esta linha antes de sair: nem atual, nem 🔒.
    assert (itens[ID_CUSTOM]["atual"], itens[ID_CUSTOM]["bloqueada"]) == (False, False)

    r = await _retomar(linha, ID_CUSTOM)
    assert r.status_code == 200, r.text
    assert linha.falsa.boots == [ID_PROMPT, ID_CUSTOM]


async def test_resume_velho_perde_para_conversa_escrita_depois_da_largada(linha) -> None:
    """Trocou por dentro (`/clear`, `/resume`): o argv ficou, a conversa não."""
    bancada = linha.palco.bancada
    _envelhecer(bancada, ID_PROMPT, 600)
    _envelhecer(bancada, ID_CUSTOM, 10)
    bancada.processos["pavan"] = (ID_PROMPT, time.time() - 300)
    itens = await _itens(linha)
    assert itens[ID_CUSTOM]["atual"] is True
    assert itens[ID_PROMPT]["atual"] is False
    assert (await _retomar(linha, ID_CUSTOM)).status_code == 409


async def test_resume_de_conversa_que_nao_mora_na_pasta_nao_vale(linha) -> None:
    linha.palco.bancada.processos["pavan"] = (ID_DE_FORA, time.time())
    assert (await _itens(linha))[ID_CUSTOM]["atual"] is True


async def test_resume_de_outra_linha_viva_trava_a_conversa(linha) -> None:
    bancada = linha.palco.bancada
    _envelhecer(bancada, ID_PROMPT, 600)
    bancada.processos["daniel"] = (ID_PROMPT, time.time() - 300)
    # A pasta do Daniel não é a do Pavan: o `--resume` dele não vale lá.
    assert (await _itens(linha))[ID_PROMPT]["bloqueada"] is False


def test_atual_pelo_processo(tmp_path) -> None:
    for sid in (ID_CUSTOM, ID_PROMPT):
        (tmp_path / f"{sid}.jsonl").write_text("{}\n")
    _envelhecer(SimpleNamespace(pasta=tmp_path), ID_CUSTOM, 100)
    agora = time.time()
    f = conversas_service.atual_pelo_processo
    assert f(tmp_path, ID_CUSTOM, None) == ID_CUSTOM
    assert f(None, ID_CUSTOM, (ID_PROMPT, agora)) == ID_CUSTOM
    assert f(tmp_path, ID_CUSTOM, (ID_PROMPT, agora - 50)) == ID_PROMPT
    assert f(tmp_path, ID_CUSTOM, (ID_PROMPT, agora - 200)) == ID_CUSTOM
    assert f(tmp_path, None, (ID_PROMPT, agora)) == ID_PROMPT
    # A do banco sumiu da pasta (lixeira): fica o `--resume`.
    assert f(tmp_path, ID_NOME, (ID_PROMPT, agora)) == ID_PROMPT


def test_resume_do_pane_le_argv_e_largada_do_proc() -> None:
    import subprocess
    import sys

    def processo(*args: str) -> subprocess.Popen:
        return subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)", *args],
        )

    bons = processo("claude", "--model", "opus", "--resume", ID_PROMPT)
    sem_resume = processo("claude", "--continue")
    lixo = processo("claude", "--resume", "../x")
    outro = processo("vim", "--resume", ID_PROMPT)
    try:
        time.sleep(0.2)
        achado = tmux_driver._resume_do_pane(bons.pid)
        assert achado is not None and achado[0] == ID_PROMPT
        assert abs(achado[1] - time.time()) < 5
        for p in (sem_resume, lixo, outro):
            assert tmux_driver._resume_do_pane(p.pid) is None
    finally:
        for p in (bons, sem_resume, lixo, outro):
            p.kill()
            p.wait()


# ---------- validação ----------


@pytest.mark.parametrize("session_id", [ID_DE_FORA, "..%2F..%2Fsegredo", "nao-e-uuid"])
async def test_conversa_que_nao_e_deste_agente_e_404(linha, session_id: str) -> None:
    r = await _retomar(linha, session_id)
    assert r.status_code == 404
    assert linha.falsa.boots == [] and linha.agente.enviados == []


async def test_a_propria_atual_e_409(linha) -> None:
    r = await _retomar(linha, ID_CUSTOM)
    assert r.status_code == 409 and "atual" in r.json()["detail"]
    assert operacao.estado("pavan") is None


async def test_conversa_aberta_em_outra_linha_e_409(linha) -> None:
    linha.palco.bancada.atuais["daniel"] = ID_PROMPT
    r = await _retomar(linha, ID_PROMPT)
    assert (r.status_code, r.json()["detail"]) == (409, "Conversa aberta na linha daniel")
    assert linha.falsa.boots == []


async def test_conversa_escrita_ha_pouco_fora_daqui_e_409(linha) -> None:
    agora = time.time()
    os.utime(linha.palco.bancada.pasta / f"{ID_NOME}.jsonl", (agora, agora))
    r = await _retomar(linha, ID_NOME)
    assert r.status_code == 409 and "2 min" in r.json()["detail"]


async def test_ocupado_sem_forcar_e_409_sem_mexer_em_nada(linha) -> None:
    linha.agente.ocupado = True
    r = await _retomar(linha, ID_PROMPT)
    assert (r.status_code, r.json()["detail"]) == (409, "ocupado")
    assert linha.agente.enviados == [] and linha.falsa.desligamentos == 0


async def test_ocupado_com_forcar_interrompe_e_segue_sem_nota(linha) -> None:
    linha.agente.ocupado = True
    r = await _retomar(linha, ID_PROMPT, forcar=True)
    assert r.status_code == 200, r.text
    assert r.json()["nota"] is False
    assert linha.agente.interrupcoes == 1 and linha.agente.enviados == []
    assert linha.falsa.boots == [ID_PROMPT]


async def test_motor_nao_cc_nao_retoma(linha) -> None:
    r = await linha.cliente.post(f"/api/agents/hiro/conversas/{ID_PROMPT}/retomar", json={})
    assert (r.status_code, r.json()["detail"]) == (409, "motor_sem_conversas")


# ---------- falha no boot ----------


async def test_boot_que_falha_volta_com_continue_na_anterior_e_erro_legivel(linha) -> None:
    falsa = linha.falsa
    falsa.falha_resume = ValueError("o boot foi recusado: unit travada")
    r = await _retomar(linha, ID_PROMPT)
    assert r.status_code == 502
    corpo = r.json()
    assert corpo["fase"] == "erro"
    assert "não consegui retomar" in corpo["detalhe"]
    assert "unit travada" in corpo["detalhe"]
    assert "voltou na conversa anterior" in corpo["detalhe"]
    assert falsa.boots == [ID_PROMPT, None]
    # O `--continue` pegou a de antes: o JSONL dela foi tocado para ser o mais recente.
    assert falsa.recente_no_continue == [ID_CUSTOM]
    assert "pavan" in linha.palco.bancada.vivas
    assert falsa.ordem[-1] == "desmarcar:pavan"
    # Erro não prende: a próxima entra.
    falsa.falha_resume = None
    assert (await _retomar(linha, ID_PROMPT)).status_code == 200


async def test_boot_e_volta_que_falham_dizem_que_a_linha_ficou_no_chao(linha) -> None:
    linha.falsa.falha_resume = ValueError("x")
    linha.falsa.falha_continue = ValueError("y")
    r = await _retomar(linha, ID_PROMPT)
    assert r.status_code == 502
    assert "ligue o agente pelo botão Ligar" in r.json()["detalhe"]
    # O carimbo de desligado de propósito sai mesmo assim: o vigia pode religar.
    assert linha.falsa.ordem[-1] == "desmarcar:pavan"


async def test_linha_que_sobe_em_outra_conversa_e_erro(linha, monkeypatch) -> None:
    monkeypatch.setattr(conversas_service, "mais_recente", lambda _p: ID_NOME)
    r = await _retomar(linha, ID_PROMPT)
    assert r.status_code == 502
    assert "não na conversa pedida" in r.json()["detalhe"]


# ---------- diálogo de retomada ----------


async def test_dialogo_detectado_leva_escape_e_a_linha_fica_pronta(linha) -> None:
    linha.falsa.dialogo = 1
    r = await _retomar(linha, ID_PROMPT)
    assert r.status_code == 200, r.text
    assert linha.falsa.escapes == 1
    assert linha.falsa.boots == [ID_PROMPT]


async def test_dialogo_que_nao_sai_vira_erro_e_a_linha_volta(linha) -> None:
    linha.falsa.dialogo = 99
    r = await _retomar(linha, ID_PROMPT)
    assert r.status_code == 502
    assert "diálogo de retomada" in r.json()["detalhe"]
    assert linha.falsa.escapes == operacao.ESCAPES_NO_DIALOGO
    assert linha.falsa.boots == [ID_PROMPT, None]


# ---------- driver ----------


def test_flags_de_largada() -> None:
    assert tmux_driver._flags_de_largada(None) == "--continue"
    assert tmux_driver._flags_de_largada(ID_PROMPT) == f"--resume {ID_PROMPT}"
    for ruim in ("../x", f"{ID_PROMPT} --dangerously", "", ID_PROMPT + "\n"):
        with pytest.raises(ValueError):
            tmux_driver._flags_de_largada(ruim)


class _PaneFalso:
    def __init__(self, comando: str, texto: str) -> None:
        self.pane_current_command = comando
        self._texto = texto

    def capture_pane(self, **_kw) -> list[str]:
        return self._texto.splitlines()


def _servidor_com(pane) -> SimpleNamespace:
    sessao = SimpleNamespace(active_pane=pane)
    return SimpleNamespace(
        has_session=lambda _n: pane is not None,
        sessions=SimpleNamespace(get=lambda **_kw: sessao),
    )


@pytest.mark.parametrize(
    ("comando", "texto", "caixa", "esperado"),
    [
        ("claude", "This session is 3h old\n❯ 1. Resume from summary\n  2. Resume full session as-is",
         "unknown", "dialogo"),
        ("claude", "Resume this conversation?\n❯ 1. Resume\n  2. Start a new conversation",
         "unknown", "dialogo"),
        # O texto do diálogo no histórico não engana: caixa vazia é pronta.
        ("claude", "a F6 fala de 'Resume full session as-is'", "empty", "pronta"),
        ("claude", "carregando…", "unknown", "subindo"),
        ("bash", "", "empty", "subindo"),
    ],
)
def test_estado_da_largada(monkeypatch, comando, texto, caixa, esperado) -> None:
    pane = _PaneFalso(comando, texto)
    monkeypatch.setattr(tmux_driver, "_server_for", lambda _n: _servidor_com(pane))
    monkeypatch.setattr(
        tmux_driver, "_capture_input_snapshot",
        lambda _p: tmux_driver._PaneInputSnapshot(caixa, ""),
    )
    assert tmux_driver._estado_da_largada_sync("pavan") == esperado


def test_estado_da_largada_sem_sessao(monkeypatch) -> None:
    monkeypatch.setattr(tmux_driver, "_server_for", lambda _n: _servidor_com(None))
    assert tmux_driver._estado_da_largada_sync("pavan") == "ausente"


# ---------- F12: as deixadas, não só a última ----------

ID_A, ID_B, ID_C = (f"{d * 8}-{d * 4}-4{d * 3}-8{d * 3}-{d * 12}" for d in "abc")


def test_a_b_c_a_deixada_duas_trocas_atras_nao_trava() -> None:
    """A → B → C: a A, escrita há segundos por esta linha, não é 🔒 (F11)."""
    operacao.esquecer("pavan")
    operacao.registrar_troca("pavan", ID_A, ID_B)
    operacao.registrar_troca("pavan", ID_B, ID_C)
    deixadas = operacao.deixadas("pavan")
    assert deixadas == {ID_A, ID_B}
    recente = SimpleNamespace(st_mtime=time.time() - 5)
    for sid in (ID_A, ID_B):
        assert conversas_service.trava(
            sid, recente, atual=ID_C, atuais_de_outras={}, agora=time.time(), deixadas=deixadas
        ) == (False, None)
    # Escrita recente de conversa que esta linha não deixou segue 🔒.
    assert conversas_service.trava(
        ID_DE_FORA, recente, atual=ID_C, atuais_de_outras={}, agora=time.time(),
        deixadas=deixadas,
    ) == (True, None)
    operacao.esquecer("pavan")


def test_deixada_que_volta_a_ser_atual_sai_da_lista_e_a_velha_vence(monkeypatch) -> None:
    operacao.esquecer("pavan")
    agora = [1_000_000.0]
    monkeypatch.setattr(operacao.time, "time", lambda: agora[0])
    operacao.registrar_troca("pavan", ID_A, ID_B)
    operacao.registrar_troca("pavan", ID_B, ID_A)  # A voltou: não é mais deixada
    assert operacao.deixadas("pavan") == {ID_B}
    agora[0] += operacao.MEMORIA_DEIXADA_S
    assert operacao.deixadas("pavan") == frozenset()
    operacao.esquecer("pavan")
