"""O custo do `/api/fleet` (28/09): voo único, tela só de quem está no ar, um
subprocesso por captura e a sparkline que não reconta hora fechada.

Cada teste segura uma metade do conserto — a conta que caiu — sem soltar a
outra: a resposta continua a mesma que era."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from db.store import GrupoBorgesDB
from routers import fleet as fleet_router
from services import tmux_driver
from services.voo_unico import VooUnico

AGENTES = [
    {
        "slug": slug,
        "name": slug,
        "role": "executor",
        "emoji": "X",
        "tmux_session": slug,
        "workspace_path": f"/tmp/{slug}",
        "cli_default": "claude_code",
        "model_default": "opus",
        "capabilities": [],
        "can_review": [],
    }
    for slug in ("daniel", "tara")
]


# ----- voo único --------------------------------------------------------------


def test_chamadas_simultaneas_esperam_a_mesma_execucao() -> None:
    execucoes = 0

    async def leitura() -> int:
        nonlocal execucoes
        execucoes += 1
        await asyncio.sleep(0.05)
        return execucoes

    async def cenario() -> list[int]:
        voo: VooUnico[int] = VooUnico(idade_maxima_s=1.0)
        return await asyncio.gather(*(voo.executa("k", leitura) for _ in range(6)))

    assert asyncio.run(cenario()) == [1] * 6
    assert execucoes == 1


def test_leitura_terminada_nao_e_servida_de_novo() -> None:
    """Sem cache depois do voo: quem chega depois lê o estado de agora."""
    execucoes = 0

    async def leitura() -> int:
        nonlocal execucoes
        execucoes += 1
        return execucoes

    async def cenario() -> tuple[int, int]:
        voo: VooUnico[int] = VooUnico(idade_maxima_s=10.0)
        return await voo.executa("k", leitura), await voo.executa("k", leitura)

    assert asyncio.run(cenario()) == (1, 2)


def test_voo_velho_demais_nao_leva_carona() -> None:
    """Leitura que começou antes do evento não pode responder a releitura
    disparada por ele — o card voltaria pro estado anterior."""
    execucoes = 0

    async def leitura() -> int:
        nonlocal execucoes
        execucoes += 1
        minha = execucoes
        await asyncio.sleep(0.1)
        return minha

    async def cenario() -> tuple[int, int]:
        voo: VooUnico[int] = VooUnico(idade_maxima_s=0.02)
        primeira = asyncio.ensure_future(voo.executa("k", leitura))
        await asyncio.sleep(0.05)
        segunda = await voo.executa("k", leitura)
        return await primeira, segunda

    assert asyncio.run(cenario()) == (1, 2)


def test_erro_chega_a_todos_e_a_proxima_chamada_tenta_de_novo() -> None:
    tentativas = 0

    async def leitura() -> str:
        nonlocal tentativas
        tentativas += 1
        await asyncio.sleep(0.01)
        if tentativas == 1:
            raise RuntimeError("tmux caiu")
        return "ok"

    async def cenario() -> tuple[list[object], str]:
        voo: VooUnico[str] = VooUnico(idade_maxima_s=1.0)
        juntas = await asyncio.gather(
            voo.executa("k", leitura), voo.executa("k", leitura), return_exceptions=True
        )
        return juntas, await voo.executa("k", leitura)

    juntas, depois = asyncio.run(cenario())
    assert all(isinstance(r, RuntimeError) for r in juntas)
    assert depois == "ok"
    assert tentativas == 2


def test_fleet_simultaneo_monta_um_snapshot_so(tmp_path: Path, monkeypatch) -> None:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents(AGENTES)
    inventarios = 0

    async def inventario() -> tmux_driver.TmuxSessionInventory:
        nonlocal inventarios
        inventarios += 1
        await asyncio.sleep(0.05)
        return tmux_driver.TmuxSessionInventory({"daniel"}, {"daniel"})

    async def captura(_sessao: str) -> str:
        return "❯ "

    monkeypatch.setattr(fleet_router.tmux_driver, "list_session_inventory", inventario)
    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", captura)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=db)))

    async def cenario() -> list[dict]:
        return await asyncio.gather(
            *(fleet_router.get_fleet(request, sparkline_hours=24) for _ in range(3))
        )

    respostas = asyncio.run(cenario())
    assert inventarios == 1
    assert all(r is respostas[0] for r in respostas)
    assert [a["slug"] for a in respostas[0]["agents"]] == ["daniel", "tara"]


# ----- tela só de quem está no ar --------------------------------------------


def test_sessao_fora_do_inventario_nao_vai_ao_tmux(monkeypatch) -> None:
    capturadas: list[str] = []

    async def captura(sessao: str) -> str:
        capturadas.append(sessao)
        return "Opus 4.8 - 01:00 - [█░░] 5%"

    monkeypatch.setattr(fleet_router.tmux_driver, "capture_pane_excerpt", captura)
    agentes = [
        {"slug": "daniel", "tmux_session": "daniel"},
        {"slug": "tara", "tmux_session": "tara"},
    ]
    asyncio.run(fleet_router._hydrate_pane_excerpts(agentes, {"daniel"}))

    assert capturadas == ["daniel"]
    assert agentes[0]["pane_excerpt"].startswith("Opus 4.8")
    assert agentes[0]["pane_session_started_at"] is not None
    # Ausente = exatamente o que o `has_session` falso devolvia antes.
    assert agentes[1]["pane_excerpt"] is None
    assert agentes[1]["pergunta_motor"] is None
    assert agentes[1]["pane_session_started_at"] is None


# ----- um subprocesso por captura ---------------------------------------------


class _Servidor:
    def __init__(self, respostas: dict[str | None, SimpleNamespace], chamadas: list):
        self._respostas = respostas
        self._chamadas = chamadas

    def __call__(self, socket_name: str | None = None) -> "_Servidor":
        servidor = _Servidor(self._respostas, self._chamadas)
        servidor.socket_name = socket_name
        return servidor

    def cmd(self, *args: str, target: str | None = None) -> SimpleNamespace:
        self._chamadas.append((self.socket_name, args[0], target))
        return self._respostas[self.socket_name]


def _captura(monkeypatch, respostas: dict) -> tuple[str | None, list]:
    chamadas: list = []
    monkeypatch.setattr(tmux_driver, "_TMUX_SOCKET_TEMPLATE", "borges-{session}")
    monkeypatch.setattr(tmux_driver.libtmux, "Server", _Servidor(respostas, chamadas))
    excerpt = tmux_driver._capture_pane_excerpt_sync("tara", line_limit=12, max_chars=1200)
    return excerpt, chamadas


def test_captura_e_um_comando_so_no_socket_da_sessao(monkeypatch) -> None:
    excerpt, chamadas = _captura(
        monkeypatch,
        {"borges-tara": SimpleNamespace(returncode=0, stdout=["\x1b[1mOi\x1b[0m", ""])},
    )
    assert excerpt == "Oi"
    assert chamadas == [("borges-tara", "capture-pane", "=tara:")]


def test_captura_cai_no_server_default_como_o_server_for(monkeypatch) -> None:
    excerpt, chamadas = _captura(
        monkeypatch,
        {
            "borges-tara": SimpleNamespace(returncode=1, stdout=[], stderr=["no server"]),
            None: SimpleNamespace(returncode=0, stdout=["subsessão"]),
        },
    )
    assert excerpt == "subsessão"
    assert [c[0] for c in chamadas] == ["borges-tara", None]


def test_captura_de_sessao_ausente_e_none(monkeypatch) -> None:
    falha = SimpleNamespace(returncode=1, stdout=[], stderr=["can't find session: tara"])
    excerpt, _ = _captura(monkeypatch, {"borges-tara": falha, None: falha})
    assert excerpt is None


# ----- sparkline: hora fechada não se reconta ---------------------------------


def _db_com_evento(tmp_path: Path, created_at: int) -> GrupoBorgesDB:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents(AGENTES)
    with db._connect() as conn, conn:
        conn.execute(
            "INSERT INTO task_events (agent_slug, kind, payload, created_at)"
            " VALUES ('daniel', 'jsonl:assistant', ?, ?)",
            ('{"message": {"usage": {"input_tokens": 7, "output_tokens": 3}}}', created_at),
        )
    return db


def test_validade_vencida_reconta_so_a_hora_corrente(tmp_path: Path) -> None:
    agora = int(time.time())
    db = _db_com_evento(tmp_path, agora - 3600)

    db._fleet_snapshot(24, {"daniel"}, {"daniel"})
    fechadas = db._sparkline_fechadas
    assert fechadas is not None
    db._sparkline_cache = None  # a validade de 30 s venceu
    snapshot = db._fleet_snapshot(24, {"daniel"}, {"daniel"})

    assert db._sparkline_fechadas is fechadas
    daniel = next(a for a in snapshot["agents"] if a["slug"] == "daniel")
    assert sum(b["tokens"] for b in daniel["sparkline"]) == 10


def test_evento_da_hora_corrente_entra_mesmo_com_as_fechadas_em_cache(
    tmp_path: Path,
) -> None:
    db = _db_com_evento(tmp_path, int(time.time()) - 3600)
    db._fleet_snapshot(24, {"daniel"}, {"daniel"})
    db._insert_task_event(
        "jsonl:assistant",
        task_id=None,
        agent_slug="daniel",
        instance_id=None,
        payload={"message": {"usage": {"input_tokens": 1, "output_tokens": 1}}},
        raw_jsonl=None,
    )
    db._sparkline_cache = None

    snapshot = db._fleet_snapshot(24, {"daniel"}, {"daniel"})
    daniel = next(a for a in snapshot["agents"] if a["slug"] == "daniel")
    assert daniel["sparkline"][-1]["count"] == 1
    assert sum(b["tokens"] for b in daniel["sparkline"]) == 12


def test_virada_da_hora_reconta_as_fechadas(tmp_path: Path) -> None:
    db = _db_com_evento(tmp_path, int(time.time()) - 3600)
    db._fleet_snapshot(24, {"daniel"}, {"daniel"})
    since, _hora, contagem, tokens = db._sparkline_fechadas
    db._sparkline_fechadas = (since, 0, contagem, tokens)
    db._sparkline_cache = None

    db._fleet_snapshot(24, {"daniel"}, {"daniel"})
    assert db._sparkline_fechadas[1] != 0


@pytest.fixture(autouse=True)
def _sem_socket_do_ambiente(monkeypatch) -> None:
    monkeypatch.setattr(tmux_driver, "_TMUX_SOCKET_TEMPLATE", "")
