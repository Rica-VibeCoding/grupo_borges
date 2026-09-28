"""gzip da API: comprime JSON inteiro, nunca stream nem arquivo (28/09)."""
from __future__ import annotations

import asyncio
import gzip

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.testclient import TestClient
from sse_starlette import EventSourceResponse

from services.compressao import GZipCorpoInteiro

GRANDE = {"agents": [{"slug": f"a{i}", "pane_excerpt": "Opus 4.8 - 01:00 " * 20} for i in range(30)]}


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(GZipCorpoInteiro)

    # Mesmo desenho do main.py: um `@app.middleware("http")` por FORA do gzip,
    # que re-emite o corpo em pedaços.
    @app.middleware("http")
    async def por_fora(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        return response

    @app.get("/json")
    async def json_grande():
        return GRANDE

    @app.get("/json-pequeno")
    async def json_pequeno():
        return {"ok": True}

    @app.get("/sse")
    async def sse():
        async def eventos():
            for i in range(3):
                yield {"event": "tick", "data": "x" * 400}
                await asyncio.sleep(0)

        return EventSourceResponse(eventos())

    @app.get("/stream-texto")
    async def stream_texto():
        async def pedacos():
            for _ in range(3):
                yield "y" * 1000

        return StreamingResponse(pedacos(), media_type="text/plain")

    @app.get("/foto")
    async def foto():
        return Response(content=b"\x89PNG" + b"\0" * 5000, media_type="image/png")

    @app.get("/parcial")
    async def parcial():
        return PlainTextResponse(
            "z" * 5000, status_code=206, headers={"Content-Range": "bytes 0-4999/9000"}
        )

    @app.get("/ja-comprimido")
    async def ja_comprimido():
        corpo = gzip.compress(b"w" * 5000)
        return Response(corpo, media_type="application/json", headers={"Content-Encoding": "gzip"})

    return app


def _get(client: TestClient, path: str, encoding: str = "gzip, deflate, br"):
    return client.get(path, headers={"Accept-Encoding": encoding})


def test_json_grande_sai_comprimido_e_intacto() -> None:
    with TestClient(_app()) as client:
        resposta = _get(client, "/json")
    assert resposta.headers["content-encoding"] == "gzip"
    assert "Accept-Encoding" in resposta.headers["vary"]
    assert int(resposta.headers["content-length"]) < 2000
    assert resposta.json() == GRANDE  # o cliente descomprime
    assert resposta.headers["x-content-type-options"] == "nosniff"


def test_sem_accept_encoding_nao_comprime() -> None:
    with TestClient(_app()) as client:
        resposta = _get(client, "/json", encoding="identity")
    assert "content-encoding" not in resposta.headers
    assert resposta.json() == GRANDE


def test_corpo_pequeno_nao_comprime() -> None:
    with TestClient(_app()) as client:
        resposta = _get(client, "/json-pequeno")
    assert "content-encoding" not in resposta.headers


def test_sse_passa_intocado() -> None:
    with TestClient(_app()) as client:
        resposta = _get(client, "/sse")
    assert resposta.headers["content-type"].startswith("text/event-stream")
    assert "content-encoding" not in resposta.headers
    assert resposta.text.count("event: tick") == 3


def test_stream_de_texto_passa_intocado() -> None:
    """Stream não se comprime nem sendo texto: gzip segura pedaço no buffer."""
    with TestClient(_app()) as client:
        resposta = _get(client, "/stream-texto")
    assert "content-encoding" not in resposta.headers
    assert resposta.text == "y" * 3000


def test_arquivo_binario_nao_comprime() -> None:
    with TestClient(_app()) as client:
        resposta = _get(client, "/foto")
    assert "content-encoding" not in resposta.headers
    assert resposta.content.startswith(b"\x89PNG")


def test_resposta_parcial_nao_comprime() -> None:
    with TestClient(_app()) as client:
        resposta = _get(client, "/parcial")
    assert "content-encoding" not in resposta.headers
    assert resposta.headers["content-range"] == "bytes 0-4999/9000"


def test_nao_comprime_por_cima_de_quem_ja_comprimiu() -> None:
    with TestClient(_app()) as client:
        resposta = _get(client, "/ja-comprimido")
    assert resposta.headers["content-encoding"] == "gzip"
    assert resposta.content == b"w" * 5000  # uma camada só


def test_main_registra_o_gzip_por_dentro_dos_middlewares_http() -> None:
    import main

    classes = [m.cls for m in main.app.user_middleware]
    # `user_middleware[0]` é o mais externo; o gzip tem de ser o último.
    assert classes[-1] is GZipCorpoInteiro
