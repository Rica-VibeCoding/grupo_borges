#!/usr/bin/env python3
"""Replay com API real, sem gravar banco, logs Jev ou mover arquivos."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/api"))

from config import get_settings
from faxina_contexto import permitted, read_decisions
from faxina_jev import evaluate
from services.faxina import ZE_CLAUDE_ROOT

SINCE = 1794052800  # Corte solicitado pelo Rica para 07/11/2026.


def replay_items(rows: list[dict], repo: Path, since: int) -> tuple[list[dict], int]:
    selected, excluded = [], 0
    for row in rows:
        if row["decidido_em"] < since:
            continue
        if not permitted(repo, row["caminho"]):
            excluded += 1
            continue
        item = row.copy()
        item["citado_em"] = json.loads(item["citado_em"]) if isinstance(item["citado_em"], str) else item["citado_em"]
        # Manter zera dias_parado. Restaurar a idade na criação, sem mostrar o
        # status/decisão do alvo no pedido; conteúdo arquivado usa o destino real.
        item["dias_parado"] = max(0, (item["criado_em"] - max(
            item.get("ultima_leitura") or 0, item.get("ultimo_commit") or item["criado_em"])) // 86400)
        if row["status"] == "arquivado" and row.get("arquivado_para"):
            item["conteudo_caminho"] = row["arquivado_para"]
        selected.append(item)
    return selected, excluded


def agreement(items: list[dict], verdicts: dict) -> dict:
    matrix = {status: dict.fromkeys(("arquivar", "manter", "duplica", "sem_parecer"), 0)
              for status in ("arquivado", "mantido")}
    for item in items:
        verdict = verdicts.get(item["caminho"], {}).get("jev_veredito") or "sem_parecer"
        matrix[item["status"]][verdict] += 1
    correct = matrix["arquivado"]["arquivar"] + matrix["mantido"]["manter"]
    return {"acertos": correct, "total": len(items),
            "percentual": round(100 * correct / len(items), 2) if items else None,
            "matriz_rica_por_jev": matrix}


def disagreements(items: list[dict], verdicts: dict) -> list[dict]:
    errors = []
    for item in items:
        verdict = verdicts.get(item["caminho"], {})
        expected = "arquivar" if item["status"] == "arquivado" else "manter"
        if verdict.get("jev_veredito") != expected:
            errors.append({"id": item["id"], "caminho": item["caminho"],
                           "rica": expected, **verdict})
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path(get_settings().db_path))
    parser.add_argument("--repo", type=Path, default=ZE_CLAUDE_ROOT)
    parser.add_argument("--desde", type=int, default=SINCE)
    parser.add_argument("--sem-exemplos", action="store_true",
                        help="Desliga decisões passadas do Rica; mantém os demais sinais e critérios.")
    args = parser.parse_args()
    repo = args.repo.resolve()
    rows = read_decisions(args.db)
    items, excluded = replay_items(rows, repo, args.desde)
    before = {item["caminho"]: {"jev_veredito": item["jev_veredito"]} for item in items}
    after, usage = evaluate(items, repo=repo, db_path=args.db, log_results=False,
                            include_examples=not args.sem_exemplos)
    print(json.dumps({"desde": args.desde, "somente_leitura": True,
                      "excluidos_seguranca": excluded,
                      "exemplos_habilitados": not args.sem_exemplos,
                      "por_status": dict(Counter(item["status"] for item in items)),
                      "antes": agreement(items, before), "depois": agreement(items, after),
                      "cartoes": [{"id": item["id"], "caminho": item["caminho"],
                                   "rica": item["status"]} for item in items],
                      "erros": disagreements(items, after),
                      "jev_uso": usage}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
