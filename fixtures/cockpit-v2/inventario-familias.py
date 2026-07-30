#!/usr/bin/env python3
"""Inventaria as famílias de payload nos transcripts gravados.

Saída = a matriz payload→renderer que o DATA-CONTRACT.md precisa: cada tipo de
bloco, cada tool pelo nome, e a forma do tool_result (texto, imagem, estruturado).
"""
import collections
import glob
import json
import os

DEST = "/home/clawd/repos/grupo_borges/fixtures/cockpit-v2/transcripts"

blocos = collections.Counter()
tools = collections.Counter()
result_formas = collections.Counter()
content_tipos = collections.Counter()
exemplo_de = {}


def anota(chave, obj):
    if chave not in exemplo_de:
        exemplo_de[chave] = obj


for caminho in sorted(glob.glob(os.path.join(DEST, "*.sse.jsonl"))):
    with open(caminho) as f:
        for linha in f:
            e = json.loads(linha)
            if e["event"] != "message":
                continue
            d = e["data"]
            msg = d.get("message") or {}
            content = msg.get("content")

            if isinstance(content, str):
                content_tipos["string"] += 1
            elif isinstance(content, list):
                content_tipos["lista"] += 1
                for b in content:
                    if not isinstance(b, dict):
                        content_tipos[f"bloco_{type(b).__name__}"] += 1
                        continue
                    t = b.get("type", "?")
                    blocos[t] += 1
                    anota(f"bloco:{t}", b)
                    if t == "tool_use":
                        tools[b.get("name", "?")] += 1
                        anota(f"tool:{b.get('name')}", b)
            else:
                content_tipos[f"content_{type(content).__name__}"] += 1

            tur = d.get("tool_use_result")
            if tur is not None:
                if isinstance(tur, dict):
                    forma = "dict:" + ",".join(sorted(tur.keys())[:6])
                elif isinstance(tur, list):
                    forma = "list"
                else:
                    forma = type(tur).__name__
                result_formas[forma] += 1
                anota(f"result:{forma}", tur)

print("== tipos de content ==")
for k, v in content_tipos.most_common():
    print(f"  {k}: {v}")
print("== blocos ==")
for k, v in blocos.most_common():
    print(f"  {k}: {v}")
print("== tools (nome) ==")
for k, v in tools.most_common():
    print(f"  {k}: {v}")
print("== formas de tool_use_result ==")
for k, v in result_formas.most_common(25):
    print(f"  {k}: {v}")

with open(os.path.join(DEST, "_familias.json"), "w") as f:
    json.dump(
        {
            "content_tipos": content_tipos,
            "blocos": blocos,
            "tools": tools,
            "result_formas": result_formas,
        },
        f,
        ensure_ascii=False,
        indent=2,
    )
