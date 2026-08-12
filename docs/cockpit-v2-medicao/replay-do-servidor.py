"""Quanto do replay é servidor: tempo até o primeiro byte e até o `replay-end`.

Separa a metade servidor da metade cliente sem depender do browser. O que sobrar
depois disto é do cliente (parse, classificação, render).

Uso: python3 mede-replay.py <slug> [repeticoes] [limit]
"""

import sys
import time
import urllib.request

slug = sys.argv[1] if len(sys.argv) > 1 else "daniel"
reps = int(sys.argv[2]) if len(sys.argv) > 2 else 4
limite = sys.argv[3] if len(sys.argv) > 3 else "300"

URL = (
    f"http://127.0.0.1:3008/api/agents/{slug}/messages/stream"
    f"?limit={limite}&maxResultChars=32000&recentes=1"
)

print(f"== {URL}")
for i in range(reps):
    t0 = time.monotonic()
    primeiro = None
    fim = None
    bytes_lidos = 0
    eventos = 0
    req = urllib.request.Request(
        URL, headers={"Accept": "text/event-stream", "Accept-Encoding": "identity"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        for linha in r:
            if primeiro is None:
                primeiro = time.monotonic() - t0
            bytes_lidos += len(linha)
            if linha.startswith(b"event:"):
                eventos += 1
            if b"replay-end" in linha:
                fim = time.monotonic() - t0
                break
    print(
        f"   #{i+1}  1o byte {primeiro*1000:6.0f} ms   replay-end {fim*1000:7.0f} ms"
        f"   {bytes_lidos/1024:7.1f} KB   {eventos} eventos"
        if fim
        else f"   #{i+1}  1o byte {primeiro*1000:6.0f} ms   replay-end NAO CHEGOU"
    )
