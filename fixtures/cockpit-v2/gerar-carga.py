#!/usr/bin/env python3
"""Gera carga determinística para o gate numérico do cockpit v2.

A carga entra pelo mesmo caminho da produção: JSONL → watcher → banco → SSE.
O único acesso de escrita ao banco é o reset restrito ao agente-canário, pois
o backend não expõe endpoint para apagar eventos de benchmark.
"""
import argparse
import json
import os
import random
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED_PADRAO = 20260730
SLUG_PADRAO = "canario"
HISTORICO = 1_000
STREAM_HZ = 50
STREAM_SEGUNDOS = 60
LIMITE_REPLAY_SSE = 500  # teto vigente no endpoint canônico
AGENTES_REAIS = {
    "pavan", "vinicius", "felipe", "barsi", "daniel", "lucas", "miga", "hiro",
}
RAIZ = Path(__file__).resolve().parent
FAMILIAS = RAIZ / "familias"
WORKSPACE_CANARIO = RAIZ / "canario"
API_PADRAO = "http://127.0.0.1:8000"


def argumentos() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Injeta a carga controlada do gate cockpit v2 no canário."
    )
    parser.add_argument("--seed", type=int, default=SEED_PADRAO)
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--slug", default=SLUG_PADRAO)
    parser.add_argument("--api", default=os.environ.get("GB_API_URL", API_PADRAO))
    parser.add_argument(
        "--sse-base-url",
        default=os.environ.get("GB_PUBLIC_API_URL"),
        help="Base pública exibida no relatório; por padrão usa --api.",
    )
    return parser.parse_args()


def aborta_slug_inseguro(slug: str) -> None:
    if slug in AGENTES_REAIS:
        raise SystemExit(
            f"ABORTADO: {slug!r} é agente real; carga só pode ir para um canário."
        )
    if slug != SLUG_PADRAO:
        raise SystemExit(
            f"ABORTADO: slug dedicado exigido é {SLUG_PADRAO!r}, recebido {slug!r}."
        )


def banco_configurado() -> Path:
    env_path = RAIZ.parents[1] / "apps" / "api" / ".env"
    valor = None
    if env_path.exists():
        for linha in env_path.read_text(encoding="utf-8").splitlines():
            if linha.startswith("GB_DB_PATH="):
                valor = linha.partition("=")[2].strip()
                break
    valor = os.environ.get("GB_DB_PATH", valor)
    api_dir = RAIZ.parents[1] / "apps" / "api"
    caminho = Path(valor or "data/grupo_borges.db")
    return caminho if caminho.is_absolute() else api_dir / caminho


def confirma_canario(api: str, slug: str) -> None:
    url = f"{api.rstrip('/')}/api/agents/{slug}"
    try:
        with urllib.request.urlopen(url, timeout=5) as resposta:
            agente = json.load(resposta)
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        raise SystemExit(f"API indisponível ou canário não registrado em {url}: {exc}")
    workspace = Path(str(agente.get("workspace_path", ""))).resolve()
    if workspace != WORKSPACE_CANARIO.resolve():
        raise SystemExit(
            "ABORTADO: workspace do canário diverge do diretório sintético: "
            f"{workspace}"
        )


def limpa_canario(db_path: Path, slug: str) -> int:
    if not db_path.is_file():
        raise SystemExit(f"Banco do cockpit não encontrado: {db_path}")
    with sqlite3.connect(db_path, timeout=5) as conn:
        conn.execute("PRAGMA busy_timeout=5000")
        antes = conn.execute(
            "SELECT COUNT(*) FROM task_events WHERE agent_slug = ?", (slug,)
        ).fetchone()[0]
        conn.execute("DELETE FROM task_events WHERE agent_slug = ?", (slug,))
        conn.execute(
            """
            UPDATE agent_state
            SET jsonl_path = NULL, last_seen = NULL, lifecycle_status = NULL,
                lifecycle_detail = NULL, lifecycle_event = NULL,
                lifecycle_updated_at = NULL
            WHERE slug = ?
            """,
            (slug,),
        )
    return int(antes)


def carrega_familias() -> tuple[list[dict], list[int]]:
    indice = json.loads((FAMILIAS / "_indice.json").read_text(encoding="utf-8"))
    eventos = []
    pesos = []
    for familia, ocorrencias in indice["ocorrencias"].items():
        caminho = FAMILIAS / f"{familia}.json"
        fixture = json.loads(caminho.read_text(encoding="utf-8"))
        eventos.append(fixture["evento"])
        pesos.append(int(ocorrencias))
    if len(eventos) != int(indice["total_familias"]):
        raise SystemExit("Índice de famílias diverge dos fixtures disponíveis.")
    return eventos, pesos


def uuid_deterministico(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def timestamp_deterministico(seed: int, numero: int) -> str:
    """Relógio lógico: 20 ms por evento, estável entre execuções."""
    inicio = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(
        seconds=seed % 86_400
    )
    instante = inicio + timedelta(milliseconds=numero * 20)
    return instante.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def converte_evento(
    molde: dict,
    *,
    rng: random.Random,
    seed: int,
    numero: int,
    session_id: str,
    parent_uuid: str | None,
) -> dict:
    identificador = uuid_deterministico(rng)
    return {
        "type": molde.get("kind") or "assistant",
        "uuid": identificador,
        "parentUuid": parent_uuid,
        "sessionId": session_id,
        "isSidechain": False,
        "userType": molde.get("user_type"),
        "timestamp": timestamp_deterministico(seed, numero),
        "message": molde.get("message"),
        "agentId": None,
        "toolUseResult": molde.get("tool_use_result"),
    }


def evento_chunk(
    *,
    rng: random.Random,
    seed: int,
    session_id: str,
    parent_uuid: str | None,
    numero: int,
) -> dict:
    identificador = uuid_deterministico(rng)
    palavras = ("processando", "comparando", "renderizando", "medindo", "validando")
    texto = f"{palavras[numero % len(palavras)]} chunk {numero:04d} "
    return {
        "type": "assistant",
        "uuid": identificador,
        "parentUuid": parent_uuid,
        "sessionId": session_id,
        "isSidechain": False,
        "userType": "external",
        "timestamp": timestamp_deterministico(seed, HISTORICO + numero),
        "message": {
            "role": "assistant",
            "content": [{"type": "text", "text": texto}],
            "stop_reason": None,
        },
        "agentId": None,
        "toolUseResult": None,
    }


def grava_linha(arquivo, evento: dict) -> None:
    arquivo.write(json.dumps(evento, ensure_ascii=False, separators=(",", ":")) + "\n")
    arquivo.flush()


def espera_ingestao(
    db_path: Path,
    slug: str,
    session_id: str,
    esperado: int,
    timeout: float = 30,
) -> int:
    limite = time.monotonic() + timeout
    ultimo = 0
    while time.monotonic() < limite:
        with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5) as conn:
            ultimo = conn.execute(
                """
                SELECT COUNT(*) FROM task_events
                WHERE agent_slug = ?
                  AND json_valid(payload) = 1
                  AND json_extract(payload, '$.sessionId') = ?
                """,
                (slug, session_id),
            ).fetchone()[0]
        if ultimo >= esperado:
            return int(ultimo)
        time.sleep(0.05)
    raise SystemExit(
        f"Watcher não confirmou a ingestão: {ultimo}/{esperado} eventos após {timeout:.0f}s."
    )


def main() -> int:
    args = argumentos()
    aborta_slug_inseguro(args.slug)
    confirma_canario(args.api, args.slug)
    db_path = banco_configurado()
    removidos = limpa_canario(db_path, args.slug) if args.reset else 0

    rng = random.Random(args.seed)
    moldes, pesos = carrega_familias()
    session_id = uuid_deterministico(rng)
    projects_dir = Path(
        os.environ.get("GB_CLAUDE_PROJECTS_DIR", str(Path.home() / ".claude" / "projects"))
    )
    encoded = "".join(c if c.isalnum() or c == "-" else "-" for c in str(WORKSPACE_CANARIO))
    jsonl_dir = projects_dir / encoded
    jsonl_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = jsonl_dir / f"{session_id}.jsonl"
    if jsonl_path.exists() and not args.reset:
        raise SystemExit(
            f"Carga da seed {args.seed} já existe; use --reset para substituí-la."
        )
    if jsonl_path.exists():
        jsonl_path.unlink()
    jsonl_path.touch()
    # O watcher ignora Change.added; separa a criação do primeiro append para
    # garantir um Change.modified mesmo quando o watchfiles agrupa notificações.
    time.sleep(0.3)

    base_sse = (args.sse_base_url or args.api).rstrip("/")
    sse = (
        f"{base_sse}/api/agents/{args.slug}/messages/stream"
        f"?sessionId={session_id}&limit={LIMITE_REPLAY_SSE}"
    )

    parent_uuid = None
    with jsonl_path.open("a", encoding="utf-8", buffering=1) as arquivo:
        for numero in range(HISTORICO):
            molde = rng.choices(moldes, weights=pesos, k=1)[0]
            evento = converte_evento(
                molde,
                rng=rng,
                seed=args.seed,
                numero=numero,
                session_id=session_id,
                parent_uuid=parent_uuid,
            )
            grava_linha(arquivo, evento)
            parent_uuid = evento["uuid"]

        espera_ingestao(db_path, args.slug, session_id, HISTORICO)
        print(f"SSE (abra antes da fase stream): {sse}", flush=True)

        total_stream = STREAM_HZ * STREAM_SEGUNDOS
        inicio = time.monotonic()
        for numero in range(1, total_stream + 1):
            alvo = inicio + numero / STREAM_HZ
            atraso = alvo - time.monotonic()
            if atraso > 0:
                time.sleep(atraso)
            evento = evento_chunk(
                rng=rng,
                seed=args.seed,
                session_id=session_id,
                parent_uuid=parent_uuid,
                numero=numero,
            )
            grava_linha(arquivo, evento)
            parent_uuid = evento["uuid"]

    total_ingerido = espera_ingestao(
        db_path, args.slug, session_id, HISTORICO + total_stream
    )
    duracao_real = time.monotonic() - inicio

    if args.reset:
        print(f"Reset: {removidos} eventos anteriores removidos do canário")
    print(f"Fase histórico: {HISTORICO} eventos ingeridos")
    print(f"Fase stream: {total_stream} eventos ingeridos em {duracao_real:.3f}s")
    print(f"Taxa real alcançada: {total_stream / duracao_real:.2f} eventos/s")
    print(f"Total confirmado no banco: {total_ingerido} eventos")
    print(f"SSE: {sse}")
    print(
        "AVISO: o endpoint limita replay a 500; sem alterar apps/api, "
        "não há como pré-carregar 1.000 mensagens no painel via SSE."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
