"""DS-54 — testes para `POST /api/tasks/{task_id}/images`.

Cobre: 404 task inexistente, 422 mime inválido, 422 tamanho, 422 excesso de arquivos,
201 caminho feliz (arquivo salvo + DB atualizado + resposta correta).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db.store import GrupoBorgesDB
from routers import tasks as tasks_router

DANIEL = {
    "slug": "daniel",
    "name": "Daniel Singh",
    "role": "developer",
    "emoji": "DS",
    "tmux_session": "daniel",
    "workspace_path": "/tmp/daniel",
    "cli_default": "claude_code",
    "model_default": "sonnet",
    "capabilities": [],
    "can_review": [],
}


def _build_app(tmp_path: Path) -> FastAPI:
    db = GrupoBorgesDB(str(tmp_path / "grupo_borges.db"))
    db._apply_schema()
    db._sync_agents([DANIEL])
    app = FastAPI()
    app.state.db = db
    app.state.agents_config = {"agents": [DANIEL]}
    app.include_router(tasks_router.router, prefix="/api/tasks")
    return app


def _create_task(client: TestClient) -> str:
    resp = client.post(
        "/api/tasks",
        json={"title": "Teste DS-54", "assignee": "daniel"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_upload_404_task_not_found(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        resp = client.post(
            "/api/tasks/nao-existe/images",
            files={"files": ("foto.png", b"\x89PNG\r\n", "image/png")},
        )
        assert resp.status_code == 404


def test_upload_422_invalid_mime(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        task_id = _create_task(client)
        resp = client.post(
            f"/api/tasks/{task_id}/images",
            files={"files": ("doc.pdf", b"%PDF", "application/pdf")},
        )
        assert resp.status_code == 422
        assert "content-type" in resp.json()["detail"].lower()


def test_upload_422_file_too_large(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    big = b"x" * (10 * 1024 * 1024 + 1)
    with TestClient(app) as client:
        task_id = _create_task(client)
        resp = client.post(
            f"/api/tasks/{task_id}/images",
            files={"files": ("large.png", big, "image/png")},
        )
        assert resp.status_code == 422
        assert "10 MB" in resp.json()["detail"]


def test_upload_422_too_many_files(tmp_path: Path) -> None:
    app = _build_app(tmp_path)
    with TestClient(app) as client:
        task_id = _create_task(client)
        files = [("files", (f"img{i}.png", b"\x89PNG", "image/png")) for i in range(6)]
        resp = client.post(f"/api/tasks/{task_id}/images", files=files)
        assert resp.status_code == 422
        assert "máximo" in resp.json()["detail"].lower()


def test_upload_happy_path(tmp_path: Path) -> None:
    """Caminho feliz: arquivo salvo no disco, DB atualizado, resposta correta."""
    # Redireciona o diretório de uploads pro tmp_path do teste
    import routers.tasks as rt
    original_base = rt._UPLOADS_BASE
    rt._UPLOADS_BASE = tmp_path / "uploads" / "tasks"

    try:
        app = _build_app(tmp_path)
        fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

        with TestClient(app) as client:
            task_id = _create_task(client)
            resp = client.post(
                f"/api/tasks/{task_id}/images",
                files={"files": ("screenshot.png", fake_png, "image/png")},
            )
            assert resp.status_code == 201, resp.text
            body = resp.json()
            assert body["task_id"] == task_id
            assert len(body["uploaded"]) == 1

            item = body["uploaded"][0]
            assert item["url"].startswith(f"/uploads/tasks/{task_id}/")
            assert item["url"].endswith(".png")
            assert item["filename"] == "screenshot.png"
            assert item["size"] == len(fake_png)

            # Arquivo existe no disco
            disk_path = tmp_path / "uploads" / "tasks" / task_id / Path(item["url"]).name
            assert disk_path.exists()
            assert disk_path.read_bytes() == fake_png

            # DB foi atualizado
            task_resp = client.get(f"/api/tasks/{task_id}")
            assert task_resp.status_code == 200
            task = task_resp.json()
            assert isinstance(task["image_urls"], list)
            assert item["url"] in task["image_urls"]
    finally:
        rt._UPLOADS_BASE = original_base


def test_upload_appends_not_replaces(tmp_path: Path) -> None:
    """Dois uploads consecutivos acumulam URLs (append, não substitui)."""
    import routers.tasks as rt
    original_base = rt._UPLOADS_BASE
    rt._UPLOADS_BASE = tmp_path / "uploads" / "tasks"

    try:
        app = _build_app(tmp_path)
        fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50

        with TestClient(app) as client:
            task_id = _create_task(client)

            r1 = client.post(
                f"/api/tasks/{task_id}/images",
                files={"files": ("a.png", fake_png, "image/png")},
            )
            r2 = client.post(
                f"/api/tasks/{task_id}/images",
                files={"files": ("b.png", fake_png, "image/png")},
            )
            assert r1.status_code == 201
            assert r2.status_code == 201

            task = client.get(f"/api/tasks/{task_id}").json()
            assert len(task["image_urls"]) == 2
    finally:
        rt._UPLOADS_BASE = original_base
