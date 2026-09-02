"""O watcher do feed não pode morrer calado quando o banco nega uma escrita.

Em 01/09 o feed do cockpit parou às 21:00 e só voltou às 22:19, no restart do
serviço. Os agentes respondiam no terminal e a API devolvia 200 em tudo — só o
feed estava mudo, porque `_run` capturava a exceção, logava e **saía do laço**
`awatch`. Um `sqlite3.OperationalError: database is locked` transitório matou o
watcher de vez; nada religa, e nada na API acusa que ele não existe mais.

O lock em si é inevitável: `busy_timeout` é uma espera com prazo, e a poda que
roda de madrugada segura lock exclusivo pra fazer `VACUUM`. A régua aqui não é
"nunca dá erro" — é "o erro não é terminal".
"""
from __future__ import annotations

import asyncio
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orchestrator.jsonl_watcher import JsonlWatcher, encoded_cwd


class DBQueNegaQuandoMandam:
    """Nega a escrita como o sqlite nega, na hora em que o teste mandar."""

    def __init__(self) -> None:
        self.negar_proxima = False
        self.gravados: list[str] = []
        self.negadas = 0

    async def insert_task_event(self, *, kind: str, **_):
        if self.negar_proxima:
            self.negar_proxima = False
            self.negadas += 1
            raise sqlite3.OperationalError("database is locked")
        self.gravados.append(kind)
        return len(self.gravados)

    def __getattr__(self, _nome):
        async def _noop(*_args, **_kwargs):
            return None

        return _noop


async def _esperar(condicao, prazo: float = 10.0) -> bool:
    """`awatch` acorda por inotify — sondar é mais honesto que dormir um fixo."""
    loop = asyncio.get_running_loop()
    limite = loop.time() + prazo
    while loop.time() < limite:
        if condicao():
            return True
        await asyncio.sleep(0.05)
    return False


def _linha(uuid: str) -> str:
    return f'{{"type": "assistant", "uuid": "{uuid}", "message": {{"role": "assistant"}}}}\n'


@pytest.fixture
async def bancada(tmp_path: Path):
    """Entrega um watcher JÁ PROVADO vivo — bancada que não checa a pré-condição
    passa verde sem exercitar nada, e era exatamente esse o risco deste teste."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    projects = tmp_path / "projects"
    (projects / encoded_cwd(str(workspace))).mkdir(parents=True)
    jsonl = projects / encoded_cwd(str(workspace)) / "sessao.jsonl"
    jsonl.write_text("")

    db = DBQueNegaQuandoMandam()
    watcher = JsonlWatcher(
        claude_projects_dir=str(projects),
        agents=[{"slug": "daniel", "workspace_path": str(workspace)}],
        db=db,
    )
    await watcher.start()

    def escrever(uuid: str) -> None:
        with jsonl.open("a") as f:
            f.write(_linha(uuid))
            f.flush()

    # `awatch` só enxerga o que for escrito DEPOIS de o inotify subir, e o mesmo
    # vale a cada religamento. Em produção isso não é problema: agente
    # respondendo escreve em fluxo. Aqui o fluxo tem que ser imitado.
    async def escrever_ate_chegar(uuid: str, tentativas: int = 100) -> bool:
        for n in range(tentativas):
            escrever(f"{uuid}-{n}")
            if await _esperar(lambda: db.gravados, prazo=0.2):
                return True
        return False

    assert await escrever_ate_chegar("aquecimento"), "bancada não pegou nem o caminho feliz"
    db.gravados.clear()

    yield db, escrever, escrever_ate_chegar
    await watcher.stop()


async def test_erro_transitorio_no_banco_nao_mata_o_feed(bancada):
    """Metade 1 da régua: o watcher se recupera sozinho e volta a gravar."""
    db, escrever, escrever_ate_chegar = bancada

    db.negar_proxima = True
    escrever("evento-que-esbarra-no-lock")
    assert await _esperar(lambda: db.negadas == 1), "o teste não chegou a exercitar o erro"

    # O lock passou. Uma mensagem NOVA tem que chegar ao banco.
    assert await escrever_ate_chegar("evento-depois-do-lock"), (
        "watcher morreu no primeiro erro — feed mudo até o restart do serviço"
    )


async def test_watcher_para_quando_mandam_parar(bancada):
    """A supervisão não pode transformar `stop()` em laço que ignora o pedido."""
    db, escrever, _ = bancada
    db.negar_proxima = True
    escrever("evento-que-esbarra-no-lock")
    assert await _esperar(lambda: db.negadas == 1)
    # o `stop()` do fixture é quem prova; sem timeout ele penduraria a suíte
