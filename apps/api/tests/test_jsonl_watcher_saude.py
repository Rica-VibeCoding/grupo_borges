"""JsonlWatcher.health() — sem isso, o buraco de 01/09 se repete calado.

Em 01/09 o feed ficou mudo por 1h19: a task do watcher seguia viva (o laço de
religar não tinha nascido ainda), a API respondia 200 o tempo todo, e nada
acusava. `health()` cruza duas coisas: a task não terminou E o laço
`_observar` está de fato girando. As três metades da régua:

(a) watcher morto ou travado (laço não volta) → `alive` é False
(b) watcher são, feed seguindo → `alive` é True
(c) watcher são, frota INTEIRA ociosa (sem evento de arquivo) → `alive`
    continua True — heartbeat prova "laço girando", não "chegou dado"
    (achado do Pavan, 27/09: sem isso a régua vira alarme falso toda
    madrugada e ninguém mais lê o alarme de verdade).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import orchestrator.jsonl_watcher as jsonl_watcher_module
from orchestrator.jsonl_watcher import JsonlWatcher, encoded_cwd


class DBQueSoGrava:
    """DB fake mínimo — este teste não olha pro que foi gravado, só se o watcher
    seguiu processando (o que já basta pra mexer em `_last_progress_ms`)."""

    async def insert_task_event(self, *, kind, payload=None, **_):
        return 1

    def __getattr__(self, nome):
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
async def watcher_vivo(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    projects = tmp_path / "projects"
    (projects / encoded_cwd(str(workspace))).mkdir(parents=True)
    jsonl = projects / encoded_cwd(str(workspace)) / "sessao.jsonl"
    jsonl.write_text("")

    watcher = JsonlWatcher(
        claude_projects_dir=str(projects),
        agents=[{"slug": "daniel", "workspace_path": str(workspace)}],
        db=DBQueSoGrava(),
    )
    await watcher.start()

    def escrever(uuid: str) -> None:
        with jsonl.open("a") as f:
            f.write(_linha(uuid))
            f.flush()

    yield watcher, escrever
    await watcher.stop()


async def test_watcher_sao_com_feed_seguindo_fica_vivo(watcher_vivo):
    """Metade (b): watcher processando eventos normalmente diz vivo."""
    watcher, escrever = watcher_vivo

    saude_no_boot = watcher.health()
    assert saude_no_boot["alive"] is True, "watcher recém-subido, sem progresso ainda, já deveria valer como vivo"
    assert saude_no_boot["started_at_ms"] is not None

    escrever("evento-1")
    assert await _esperar(lambda: watcher.health()["last_progress_ms"] is not None), (
        "o feed seguiu igual e o heartbeat de progresso não andou"
    )
    saude = watcher.health()
    assert saude["alive"] is True


async def test_watcher_parado_acusa_doente(watcher_vivo):
    """Metade (a), caso 1: task morta não pode passar por são."""
    watcher, _ = watcher_vivo
    await watcher.stop()
    assert watcher.health()["alive"] is False


async def test_watcher_travado_sem_progresso_acusa_doente(watcher_vivo, monkeypatch):
    """Metade (a), caso 2: task viva mas o laço não volta — não vale teste que
    só passa porque a task foi desligada. Aqui a task segue rodando; o que
    falta é o `async for` de `_observar` dar mais uma volta, exatamente o
    cenário do laço de religar preso em 01/09."""
    watcher, escrever = watcher_vivo
    escrever("evento-1")
    assert await _esperar(lambda: watcher.health()["last_progress_ms"] is not None)

    # Task ainda viva — só encurtamos o prazo de "sem progresso recente" pra
    # não esperar 180s reais no teste.
    monkeypatch.setattr(jsonl_watcher_module, "_SAUDE_SEM_PROGRESSO_SEGUNDOS", 0)
    saude = watcher.health()
    assert watcher._task is not None and not watcher._task.done(), "pré-condição: task tem que seguir viva"
    assert saude["alive"] is False, "task viva sem o laço voltar tem que acusar doente"


async def test_watcher_sao_com_frota_ociosa_nao_acusa_doente(tmp_path: Path, monkeypatch):
    """Metade (c): sem NENHUM evento de arquivo por mais que o prazo de
    staleness, o watcher são continua `alive=True` — o heartbeat vem da volta
    do laço (`yield_on_timeout`), não de dado chegando. Timeout e prazo
    encurtados só para o teste não esperar minutos reais."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    projects = tmp_path / "projects"
    (projects / encoded_cwd(str(workspace))).mkdir(parents=True)
    (projects / encoded_cwd(str(workspace)) / "sessao.jsonl").write_text("")

    monkeypatch.setattr(jsonl_watcher_module, "_RUST_TIMEOUT_SEGUNDOS", 0.05)
    monkeypatch.setattr(jsonl_watcher_module, "_SAUDE_SEM_PROGRESSO_SEGUNDOS", 1)

    watcher = JsonlWatcher(
        claude_projects_dir=str(projects),
        agents=[{"slug": "daniel", "workspace_path": str(workspace)}],
        db=DBQueSoGrava(),
    )
    await watcher.start()
    try:
        # Muito além do prazo de staleness (1s), sem escrever nada no jsonl.
        await asyncio.sleep(1.5)
        saude = watcher.health()
        assert saude["last_progress_ms"] is not None, "o laço não deu nenhuma volta"
        assert saude["alive"] is True, "frota ociosa virou doente por falta de EVENTO, não de laço parado"
    finally:
        await watcher.stop()
