"""`X-Content-Type-Options: nosniff` em tudo que sai da API.

Existe por causa de uma segunda porta: `uploads/agents/<slug>/` é servido tanto
por `GET /api/agents/{slug}/file/{filename}` — que declara mime por tabela
fechada e já mandava `nosniff` — quanto pelo `app.mount("/uploads", StaticFiles)`,
que usa `guess_type` e não aceita header extra. O mount não pode sumir enquanto
o cockpit v1 renderizar imagem a partir de `/uploads/agents/`, então a garantia
sobe pro middleware, onde vale para as duas portas.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def test_health_tem_nosniff():
    """Rota comum: o middleware é global, não por router."""
    resposta = client.get("/health")
    assert resposta.status_code == 200
    assert resposta.headers["X-Content-Type-Options"] == "nosniff"


def test_mount_estatico_tem_nosniff():
    """O caso que motivou o middleware.

    `StaticFiles` responde sem passar por rota nenhuma, e é ele que serve
    arquivo vindo de upload — o lugar onde o navegador adivinhar o tipo custa
    caro. Um teste que só olhasse `/health` passaria com o mount desprotegido.

    O header de identidade é obrigatório aqui: o mount fica ATRÁS do
    `tailscale_identity`, e essa é a razão de o mount não ser um buraco aberto.
    """
    base = Path(main.__file__).resolve().parent / "uploads" / "_teste_nosniff"
    base.mkdir(parents=True, exist_ok=True)
    alvo = base / "amostra.png"
    alvo.write_bytes(b"\x89PNG\r\n\x1a\n")
    try:
        resposta = client.get(
            "/uploads/_teste_nosniff/amostra.png",
            headers={"Tailscale-User-Login": "teste@exemplo"},
        )
        assert resposta.status_code == 200
        assert resposta.headers["X-Content-Type-Options"] == "nosniff"
    finally:
        alvo.unlink(missing_ok=True)
        base.rmdir()


def test_resposta_de_401_tambem_tem_nosniff():
    """Prova que o middleware é o mais EXTERNO da pilha.

    Se ele estivesse por dentro do `tailscale_identity`, a recusa sairia sem o
    header — e a ordem da pilha voltaria a ser algo que ninguém confere.
    """
    resposta = client.get("/uploads/qualquer.png")
    assert resposta.status_code == 401
    assert resposta.headers["X-Content-Type-Options"] == "nosniff"
