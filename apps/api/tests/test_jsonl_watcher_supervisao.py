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

from orchestrator.jsonl_watcher import (
    _TENTATIVAS_POR_LINHA,
    JsonlWatcher,
    encoded_cwd,
)


class DBQueNegaQuandoMandam:
    """Nega a escrita como o sqlite nega, na hora em que o teste mandar."""

    def __init__(self) -> None:
        self.negar_proxima = False
        self.uuid_venenoso: str | None = None
        self.gravados: list[str] = []
        self.uuids: list[str | None] = []
        self.negadas = 0

    async def insert_task_event(self, *, kind: str, payload=None, **_):
        uuid = (payload or {}).get("uuid")
        venenosa = self.uuid_venenoso is not None and uuid == self.uuid_venenoso
        if self.negar_proxima or venenosa:
            self.negar_proxima = False
            self.negadas += 1
            raise sqlite3.OperationalError("database is locked")
        self.gravados.append(kind)
        self.uuids.append((payload or {}).get("uuid"))
        return len(self.gravados)

    def envenenar(self, uuid: str) -> None:
        """Linha que falha SEMPRE: o erro não é o lock passando, é defeito nela."""
        self.uuid_venenoso = uuid

    def __getattr__(self, nome):
        # Sem esta guarda, um atributo de estado escrito errado vira coroutine
        # truthy e o teste mente em silêncio — aconteceu ao escrever este arquivo.
        if nome.startswith("_"):
            raise AttributeError(nome)

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
    db.uuids.clear()

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


async def test_a_linha_que_esbarrou_no_lock_nao_se_perde(bancada):
    """A outra metade: religar não basta se o evento da rajada não volta.

    `_process_jsonl` marcava o arquivo inteiro como lido ANTES de gravar, então a
    rajada que falhou virava buraco definitivo — nem o religamento nem o restart
    do serviço voltam nela, porque `_prepopulate_offsets` assume `st_size` no
    boot. Foi por isso que o restart de 01/09 às 22:19 não recuperou a hora e
    dezenove que faltava no feed.
    """
    db, escrever, escrever_ate_chegar = bancada

    db.negar_proxima = True
    escrever("perdida-no-lock")
    assert await _esperar(lambda: db.negadas == 1), "o teste não chegou a exercitar o erro"

    assert await escrever_ate_chegar("depois-do-lock"), "watcher não voltou a gravar"
    assert any(u and "perdida-no-lock" in u for u in db.uuids), (
        f"a linha que esbarrou no lock não voltou — buraco permanente. gravadas: {db.uuids}"
    )


async def test_linha_que_falha_sempre_nao_trava_o_feed_atras_dela(bancada):
    """Retentar pra sempre troca "perde um evento" por "perde o feed inteiro".

    Cada religamento só reprocessa quando o arquivo recebe escrita nova — que é
    o que um agente respondendo faz o tempo todo. O teste imita esse fluxo.
    """
    db, escrever, _ = bancada

    db.envenenar("linha-venenosa")
    escrever("linha-venenosa")

    # fluxo contínuo, como agente ativo: é ele que provoca o reprocessamento
    async def _fluxo():
        for n in range(400):
            escrever(f"depois-da-venenosa-{n}")
            await asyncio.sleep(0.1)

    tarefa = asyncio.create_task(_fluxo())
    try:
        assert await _esperar(lambda: db.negadas >= _TENTATIVAS_POR_LINHA, prazo=45.0), (
            f"desistiu cedo demais: {db.negadas} tentativas"
        )
        assert await _esperar(lambda: db.gravados, prazo=45.0), (
            "o feed ficou preso atrás de uma linha só"
        )
    finally:
        tarefa.cancel()
