from pathlib import Path
import sys

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services import kimi_catalog as catalog


@pytest.fixture(autouse=True)
def cache_limpo(monkeypatch):
    monkeypatch.setattr(catalog, "_cache", catalog._Cache())


def payload():
    return {"data": [
        {"id": "k3", "display_name": "Kimi K3", "context_length": 1048576},
        {"id": "k3-256k", "display_name": "Kimi K3 256K", "context_length": 262144},
        {"id": "kimi-for-coding", "display_name": "Kimi for Coding"},
        {"id": "kimi-for-coding-highspeed", "display_name": "Kimi for Coding Highspeed"},
    ]}


def test_parser_preserva_quatro_ids_e_rotulos():
    modelos = catalog.parsear(payload())
    assert len(modelos) == 4
    assert modelos[1] == catalog.Modelo("k3-256k", "Kimi K3 256K", 262144)


@pytest.mark.parametrize("data", [None, [], {}, {"data": [None]}, {"data": [{"id": "k3"}]},
    {"data": [{"id": "k3", "display_name": "K3", "context_length": True}]},
    {"data": [{"id": "", "display_name": "K3"}]}])
def test_parser_falha_fechado(data):
    assert catalog.parsear(data) == ()


def test_auth_timeout_e_cache(monkeypatch):
    chamadas = []
    def get(url, **kwargs):
        chamadas.append((url, kwargs))
        return httpx.Response(200, json=payload(), request=httpx.Request("GET", url))
    monkeypatch.setattr(catalog.httpx, "get", get)
    modelos = catalog.listar_modelos("credencial-teste")
    assert len(modelos) == 4
    assert catalog.listar_modelos("credencial-teste") == modelos
    assert chamadas == [(catalog._MODELS_URL, {
        "headers": {"x-api-key": "credencial-teste", "Accept": "application/json"},
        "timeout": catalog._TIMEOUT_SECONDS,
    })]


def test_falha_preserva_ultimo_bom_e_validade_curta(monkeypatch):
    monkeypatch.setattr(catalog.time, "monotonic", lambda: 1000)
    monkeypatch.setattr(catalog, "_ler_catalogo", lambda key: catalog.parsear(payload()))
    modelos = catalog.listar_modelos("teste")
    monkeypatch.setattr(catalog, "_ler_catalogo", lambda key: ())
    assert catalog.listar_modelos("teste", forcar=True) == modelos
    assert catalog._cache.expira_em == 1000 + catalog._FAILURE_TTL_SECONDS


def test_falha_inicial_nao_inventa_modelos(monkeypatch):
    chamadas = []
    def get(*args, **kwargs):
        chamadas.append(1)
        raise httpx.ConnectError("indisponível")
    monkeypatch.setattr(catalog.httpx, "get", get)
    assert catalog.listar_modelos("teste") == ()
    assert catalog.listar_modelos("teste") == ()
    assert len(chamadas) == 1


def test_sem_credencial_nao_faz_requisicao(monkeypatch):
    def get(*args, **kwargs):
        pytest.fail("requisição sem credencial")
    monkeypatch.setattr(catalog.httpx, "get", get)
    assert catalog.listar_modelos() == ()
