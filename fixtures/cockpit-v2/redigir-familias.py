#!/usr/bin/env python3
"""Gera fixtures de família a partir dos transcripts reais, com conteúdo redigido.

Por que redigir: os transcripts crus têm 22 MB de conversa real do Rica (processo
judicial, credenciais citadas, dados de cliente). O que o contrato de paridade
precisa é a ESTRUTURA — chaves, tipos, aninhamento —, não o texto. Então o texto
vira placeholder do mesmo tamanho e a forma fica intacta.

Um exemplar por família: tipo de bloco, tool pelo nome, forma de tool_use_result.
"""
import argparse
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


def _redige_string_com_linhas(s: str) -> str:
    """Redige prosa preservando a quantidade de linhas, nunca o conteúdo."""
    normalizada = s.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
    linhas = 0 if not normalizada.strip() else len(normalizada.split("\n"))
    if linhas <= 1:
        return f"<texto redigido · {len(s)} chars>"
    cabecalho = f"<texto redigido · {len(s)} chars · {linhas} linhas>"
    return "\n".join([cabecalho, *(["<linha redigida>"] * (linhas - 1))])


def redige(v, prof=0, preservar_linhas_thinking=False):
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
                if k.lower() in CHAVES_SENSIVEIS
                else _redige_string_com_linhas(x)
                if (
                    preservar_linhas_thinking
                    and k == "thinking"
                    and isinstance(x, str)
                    and len(x) > LIMITE_STR
                )
                else redige(x, prof + 1, preservar_linhas_thinking))
            for k, x in v.items()
        }
    if isinstance(v, list):
        # preserva o comprimento na anotação, mas guarda no máximo 3 itens
        corte = [redige(x, prof + 1, preservar_linhas_thinking) for x in v[:3]]
        if len(v) > 3:
            corte.append(f"<+{len(v) - 3} itens do mesmo formato>")
        return corte
    return v


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Gera um exemplar redigido por família de payload.",
    )
    parser.add_argument(
        "--preferir-thinking-com-conteudo",
        action="store_true",
        help=(
            "troca apenas o representante de bloco__thinking pelo primeiro "
            "exemplar com texto; sem a flag, preserva a escolha histórica do primeiro"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    os.makedirs(DEST, exist_ok=True)
    familias = {}
    contagem = collections.Counter()
    thinking_com_conteudo_escolhido = False

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
                        if k == "bloco__thinking":
                            thinking_com_conteudo_escolhido = bool(
                                isinstance(b.get("thinking"), str)
                                and b["thinking"].strip()
                            )
                    elif (
                        args.preferir_thinking_com_conteudo
                        and k == "bloco__thinking"
                        and not thinking_com_conteudo_escolhido
                        and isinstance(b.get("thinking"), str)
                        and b["thinking"].strip()
                    ):
                        # Não altera contagem nem família: corrige apenas o exemplar.
                        # O primeiro evento histórico tem assinatura, mas thinking
                        # vazio; ele não exercita o renderer desta família.
                        familias[k] = redige(d, preservar_linhas_thinking=True)
                        thinking_com_conteudo_escolhido = True

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
