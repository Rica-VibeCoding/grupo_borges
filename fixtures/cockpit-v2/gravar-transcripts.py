#!/usr/bin/env python3
"""Grava transcripts SSE reais do cockpit atual como contrato de paridade.

Passo 1 da ordem aprovada em docs/cockpit-v2-fusao.md. Não toca o apps/web:
consome o mesmo endpoint que o front consome, de fora.
"""
import json
import os
import sys
import time
import urllib.request

API = "http://127.0.0.1:8000"
DEST = "/home/clawd/repos/grupo_borges/fixtures/cockpit-v2/transcripts"
LIMIT = 400          # teto por agente — replay é o histórico inteiro se deixar solto
LIVE_S = 20          # segundos de live depois do replay-end


def grava(slug: str) -> dict:
    """Consome o SSE e grava eventos crus, um JSON por linha."""
    url = f"{API}/api/agents/{slug}/messages/stream?limit={LIMIT}"
    caminho = os.path.join(DEST, f"{slug}.sse.jsonl")
    resumo = {"slug": slug, "eventos": {}, "familias": {}, "bytes": 0}
    t0 = time.time()
    replay_terminou = False

    req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    with urllib.request.urlopen(req, timeout=30) as r, open(caminho, "w") as f:
        evento = None
        for linha_bytes in r:
            linha = linha_bytes.decode("utf-8", "replace").rstrip("\n")
            if linha.startswith("event:"):
                evento = linha[6:].strip()
                continue
            if not linha.startswith("data:"):
                continue
            bruto = linha[5:].strip()
            resumo["bytes"] += len(bruto)
            resumo["eventos"][evento] = resumo["eventos"].get(evento, 0) + 1
            try:
                payload = json.loads(bruto)
            except json.JSONDecodeError:
                payload = {"_nao_json": bruto[:200]}
            f.write(json.dumps({"event": evento, "data": payload}, ensure_ascii=False) + "\n")

            if evento == "message" and isinstance(payload, dict):
                # a família é o que o classificador do front precisa distinguir
                fam = payload.get("kind") or payload.get("type") or payload.get("role") or "?"
                resumo["familias"][str(fam)] = resumo["familias"].get(str(fam), 0) + 1
            if evento == "replay-end":
                replay_terminou = True
                resumo["replay_end"] = payload
            if replay_terminou and time.time() - t0 > LIVE_S:
                break
            if time.time() - t0 > 90:
                resumo["cortado_por_timeout"] = True
                break
    resumo["arquivo"] = caminho
    resumo["replay_terminou"] = replay_terminou
    return resumo


def main() -> int:
    os.makedirs(DEST, exist_ok=True)
    slugs = sys.argv[1:] or ["pavan", "daniel", "miga", "tara", "hiro"]
    todos = []
    for slug in slugs:
        try:
            r = grava(slug)
        except Exception as e:  # agente sem sessão JSONL, 404, etc
            r = {"slug": slug, "erro": f"{type(e).__name__}: {e}"}
        todos.append(r)
        print(json.dumps(r, ensure_ascii=False))
    with open(os.path.join(DEST, "_inventario.json"), "w") as f:
        json.dump(todos, f, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
