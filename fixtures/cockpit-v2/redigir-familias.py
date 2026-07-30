#!/usr/bin/env python3
"""Gera fixtures de família a partir dos transcripts reais, com conteúdo redigido.

Por que redigir: os transcripts crus têm 22 MB de conversa real do Rica (processo
judicial, credenciais citadas, dados de cliente). O que o contrato de paridade
precisa é a ESTRUTURA — chaves, tipos, aninhamento —, não o texto. Então o texto
vira placeholder do mesmo tamanho e a forma fica intacta.

Um exemplar por família: tipo de bloco, tool pelo nome, forma de tool_use_result.
"""
import collections
import glob
import json
import os

ORIG = "/home/clawd/repos/grupo_borges/fixtures/cockpit-v2/transcripts"
DEST = "/home/clawd/repos/grupo_borges/fixtures/cockpit-v2/familias"
LIMITE_STR = 80  # acima disso, redige preservando o tamanho declarado


# Chaves cujo valor é sempre segredo ou identificador opaco, independente do tamanho.
CHAVES_SENSIVEIS = {
    "file_id", "attachment_file_id", "token", "access_token", "refresh_token",
    "key", "api_key", "apikey", "secret", "password", "passwd", "senha",
    "authorization", "cookie", "session_token", "bearer",
}


def _opaca(s: str) -> bool:
    """String longa sem espaço com mistura de caixa e dígito = id/token, não prosa.

    Deixa passar nome de tool (`mcp__plugin_telegram_telegram__reply`: minúsculo,
    sem dígito) e pega file_id do Telegram, que vazou na primeira auditoria.
    """
    if len(s) < 40 or " " in s or "/" in s:
        return False
    return (any(c.isupper() for c in s)
            and any(c.islower() for c in s)
            and any(c.isdigit() for c in s))


def redige(v, prof=0):
    """Substitui conteúdo textual por placeholder, preservando estrutura e tamanho."""
    if prof > 12:
        return "<profundo>"
    if isinstance(v, str):
        if _opaca(v):
            return f"<id opaco redigido · {len(v)} chars>"
        if len(v) <= LIMITE_STR:
            # strings curtas são quase sempre estruturais (nomes, tipos, flags)
            return v
        return f"<texto redigido · {len(v)} chars>"
    if isinstance(v, dict):
        return {
            k: (f"<valor de chave sensível redigido · {len(str(x))} chars>"
                if k.lower() in CHAVES_SENSIVEIS else redige(x, prof + 1))
            for k, x in v.items()
        }
    if isinstance(v, list):
        # preserva o comprimento na anotação, mas guarda no máximo 3 itens
        corte = [redige(x, prof + 1) for x in v[:3]]
        if len(v) > 3:
            corte.append(f"<+{len(v) - 3} itens do mesmo formato>")
        return corte
    return v


def main() -> int:
    os.makedirs(DEST, exist_ok=True)
    familias = {}
    contagem = collections.Counter()

    for caminho in sorted(glob.glob(os.path.join(ORIG, "*.sse.jsonl"))):
        with open(caminho) as f:
            for linha in f:
                e = json.loads(linha)
                if e["event"] != "message":
                    continue
                d = e["data"]
                msg = d.get("message") or {}
                content = msg.get("content")

                if content is None:
                    chave = "borda__content_none"
                elif isinstance(content, str):
                    chave = "borda__content_string"
                else:
                    chave = None

                if chave:
                    contagem[chave] += 1
                    familias.setdefault(chave, redige(d))
                    continue

                for b in content if isinstance(content, list) else []:
                    if not isinstance(b, dict):
                        continue
                    t = b.get("type", "desconhecido")
                    if t == "tool_use":
                        k = f"tool__{b.get('name', '?')}"
                    else:
                        k = f"bloco__{t}"
                    contagem[k] += 1
                    if k not in familias:
                        familias[k] = redige(d)

                tur = d.get("tool_use_result")
                if isinstance(tur, dict):
                    k = "result__" + "_".join(sorted(tur.keys())[:5])
                    contagem[k] += 1
                    if k not in familias:
                        familias[k] = redige(d)

    for k, ex in sorted(familias.items()):
        with open(os.path.join(DEST, f"{k}.json"), "w") as f:
            json.dump({"familia": k, "ocorrencias": contagem[k], "evento": ex},
                      f, ensure_ascii=False, indent=2)

    resumo = {k: contagem[k] for k in sorted(familias)}
    with open(os.path.join(DEST, "_indice.json"), "w") as f:
        json.dump({"total_familias": len(familias), "ocorrencias": resumo},
                  f, ensure_ascii=False, indent=2)
    print(f"{len(familias)} famílias gravadas em {DEST}")
    for k in sorted(familias):
        print(f"  {k}: {contagem[k]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
