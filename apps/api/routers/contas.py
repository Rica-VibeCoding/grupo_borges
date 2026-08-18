"""GET/POST /api/contas — qual conta Claude a máquina usa, e a troca dela.

A conta é **da máquina**, não da sessão: as 7 sessões da frota rodam sob o mesmo
usuário Linux e dividem um `~/.claude/.credentials.json`. Trocar aqui troca pra
todo mundo — não existe "trocar a conta deste agente".

## Duas fontes, não uma

Quem autentica é o `.credentials.json`. Quem a pílula do painel MOSTRA é o
`oauthAccount` do `~/.claude.json` (ver `agents.py:_ler_conta_claude`). Escrever
só a credencial deixa a tela afirmando a conta antiga — por isso a troca mexe
nos dois arquivos.

## O que a chave do `setup-token` carrega

Só o escopo `user:inference` — `/api/oauth/profile` responde vazio pra ela. Daí
a identidade da conta vir do header `anthropic-organization-id` de uma inferência
mínima, e não do endpoint de perfil. A mesma resposta traz a cota nos headers
`anthropic-ratelimit-unified-*`, então uma chamada por conta resolve as duas
perguntas.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_SECRETS_DIR = Path.home() / ".claude" / "secrets"
_CREDENTIALS_PATH = Path.home() / ".claude" / ".credentials.json"
_CLAUDE_CONFIG_PATH = Path.home() / ".claude.json"

# `cc-oauth-token-<id>-<data>.txt`. O sufixo `.INVALIDO...` marca os arquivos de
# 16/08 que guardavam o código intermediário do callback, não a chave.
_ARQUIVO_RE = re.compile(r"^cc-oauth-token-(?P<id>[a-z0-9]+)-(?P<data>\d{4}-\d{2}-\d{2})\.txt$")

# O e-mail não sai da chave (falta o escopo de perfil), então vem daqui. Conta
# nova sem entrada aparece com o próprio id no lugar do e-mail.
_EMAIL_POR_ID = {
    "woodpro": "woodpromais@gmail.com",
    "incasa": "ricardo.incasa@gmail.com",
}

_API_URL = "https://api.anthropic.com/v1/messages"
_CACHE_TTL_S = 60


class ContaAtiva(BaseModel):
    email: str | None = None
    display_name: str | None = None


class ContaDisponivel(BaseModel):
    id: str
    email: str | None = None
    rotulo: str
    cota_5h: float | None = None
    cota_7d: float | None = None


class ContasResposta(BaseModel):
    ativa: ContaAtiva | None = None
    contas: list[ContaDisponivel]


class TrocaPedido(BaseModel):
    conta_id: str


class TrocaResposta(BaseModel):
    ok: bool
    ativa: ContaAtiva


def _chaves_disponiveis(secrets_dir: Path | None = None) -> dict[str, Path]:
    """Id da conta → arquivo de chave mais recente dela.

    O diretório é resolvido em tempo de chamada, não no default do parâmetro:
    default de função é avaliado na importação, e um teste que redireciona
    `_SECRETS_DIR` continuaria lendo o diretório de chaves de verdade.
    """
    secrets_dir = secrets_dir if secrets_dir is not None else _SECRETS_DIR
    encontradas: dict[str, tuple[str, Path]] = {}
    try:
        arquivos = sorted(secrets_dir.iterdir())
    except OSError:
        return {}
    for arquivo in arquivos:
        casou = _ARQUIVO_RE.match(arquivo.name)
        if casou is None:
            continue
        conta_id, data = casou.group("id"), casou.group("data")
        anterior = encontradas.get(conta_id)
        if anterior is None or data > anterior[0]:
            encontradas[conta_id] = (data, arquivo)
    return {conta_id: par[1] for conta_id, par in encontradas.items()}


def _sondar(chave: str) -> tuple[float | None, float | None]:
    """Inferência mínima só pelos headers: cota das duas janelas.

    O corpo da resposta é descartado — o que interessa vem no cabeçalho. Uma
    conta que já estourou o limite responde 429 e ainda assim carrega a cota,
    então o erro não vira exceção aqui.
    """
    resposta = httpx.post(
        _API_URL,
        headers={
            "authorization": f"Bearer {chave}",
            "anthropic-beta": "oauth-2025-04-20",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 4,
            "system": "You are Claude Code, Anthropic's official CLI for Claude.",
            "messages": [{"role": "user", "content": "oi"}],
        },
        timeout=20.0,
    )
    return (
        _fracao(resposta.headers.get("anthropic-ratelimit-unified-5h-utilization")),
        _fracao(resposta.headers.get("anthropic-ratelimit-unified-7d-utilization")),
    )


def _fracao(bruto: str | None) -> float | None:
    if bruto is None:
        return None
    try:
        return float(bruto)
    except ValueError:
        return None


def _ler_conta_ativa() -> ContaAtiva | None:
    try:
        with _CLAUDE_CONFIG_PATH.open(encoding="utf-8") as handle:
            oauth = json.load(handle).get("oauthAccount")
    except (OSError, ValueError):
        return None
    if not isinstance(oauth, dict):
        return None
    email = oauth.get("emailAddress")
    display = oauth.get("displayName")
    if not isinstance(email, str) and not isinstance(display, str):
        return None
    return ContaAtiva(
        email=email if isinstance(email, str) else None,
        display_name=display if isinstance(display, str) else None,
    )


_cota_cache: dict[str, tuple[float, tuple[float | None, float | None]]] = {}


def _cota_com_cache(conta_id: str, chave: str) -> tuple[float | None, float | None]:
    agora = time.monotonic()
    guardado = _cota_cache.get(conta_id)
    if guardado is not None and agora - guardado[0] < _CACHE_TTL_S:
        return guardado[1]
    try:
        cota = _sondar(chave)
    except httpx.HTTPError:
        # Sem rede a lista ainda serve: as contas aparecem, só sem número.
        return (None, None)
    _cota_cache[conta_id] = (agora, cota)
    return cota


def _escrever_atomico(caminho: Path, conteudo: str) -> None:
    """Grava por arquivo temporário + rename.

    O `.credentials.json` é lido pelos 7 agentes vivos; um arquivo truncado no
    meio da escrita derruba a frota inteira. O rename é atômico no mesmo sistema
    de arquivos, então ou vale o conteúdo velho ou vale o novo.
    """
    temporario = caminho.with_suffix(caminho.suffix + ".tmp")
    temporario.write_text(conteudo, encoding="utf-8")
    os.chmod(temporario, 0o600)
    os.replace(temporario, caminho)


@router.get("", response_model=ContasResposta)
def listar_contas() -> ContasResposta:
    contas = []
    for conta_id, arquivo in sorted(_chaves_disponiveis().items()):
        try:
            chave = arquivo.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        cota_5h, cota_7d = _cota_com_cache(conta_id, chave)
        contas.append(
            ContaDisponivel(
                id=conta_id,
                email=_EMAIL_POR_ID.get(conta_id),
                rotulo=_EMAIL_POR_ID.get(conta_id, conta_id),
                cota_5h=cota_5h,
                cota_7d=cota_7d,
            )
        )
    return ContasResposta(ativa=_ler_conta_ativa(), contas=contas)


@router.post("/ativa", response_model=TrocaResposta)
def trocar_conta(pedido: TrocaPedido) -> TrocaResposta:
    arquivo = _chaves_disponiveis().get(pedido.conta_id)
    if arquivo is None:
        raise HTTPException(status_code=404, detail=f"conta desconhecida: {pedido.conta_id}")

    try:
        chave = arquivo.read_text(encoding="utf-8").strip()
    except OSError as erro:
        raise HTTPException(status_code=409, detail=f"chave ilegível: {erro}") from erro

    # A chave é exercitada ANTES de encostar na credencial da frota: trocar por
    # uma chave morta deixaria os 7 agentes sem login no próximo restart.
    try:
        resposta = httpx.post(
            _API_URL,
            headers={
                "authorization": f"Bearer {chave}",
                "anthropic-beta": "oauth-2025-04-20",
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 4,
                "system": "You are Claude Code, Anthropic's official CLI for Claude.",
                "messages": [{"role": "user", "content": "oi"}],
            },
            timeout=20.0,
        )
    except httpx.HTTPError as erro:
        raise HTTPException(status_code=409, detail=f"não deu pra validar a chave: {erro}") from erro

    if resposta.status_code == 401:
        raise HTTPException(status_code=409, detail="a chave dessa conta não autentica mais")

    email = _EMAIL_POR_ID.get(pedido.conta_id)
    agora = int(time.time())

    try:
        atual = json.loads(_CREDENTIALS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        atual = {}
    _CREDENTIALS_PATH.with_name(f".credentials.json.bak-{agora}").write_text(
        json.dumps(atual), encoding="utf-8"
    )

    # A chave do `setup-token` vale um ano e não vem com par de renovação: sem
    # `refreshToken`, o prazo é o do próprio token.
    expira_em_ms = (agora + 360 * 86400) * 1000
    _escrever_atomico(
        _CREDENTIALS_PATH,
        json.dumps(
            {
                "claudeAiOauth": {
                    "accessToken": chave,
                    "refreshToken": "",
                    "expiresAt": expira_em_ms,
                    "refreshTokenExpiresAt": expira_em_ms,
                    "scopes": ["user:inference"],
                    "subscriptionType": atual.get("claudeAiOauth", {}).get(
                        "subscriptionType", "max"
                    ),
                }
            }
        ),
    )

    # Sem isto a pílula do painel continua anunciando a conta anterior.
    try:
        config = json.loads(_CLAUDE_CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        config = None
    if isinstance(config, dict):
        oauth = config.get("oauthAccount")
        config["oauthAccount"] = {
            **(oauth if isinstance(oauth, dict) else {}),
            "emailAddress": email or pedido.conta_id,
            "displayName": email or pedido.conta_id,
        }
        _escrever_atomico(_CLAUDE_CONFIG_PATH, json.dumps(config))

    _cota_cache.pop(pedido.conta_id, None)
    return TrocaResposta(
        ok=True,
        ativa=_ler_conta_ativa() or ContaAtiva(email=email, display_name=email),
    )
