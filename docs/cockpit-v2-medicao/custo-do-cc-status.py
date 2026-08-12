"""Quanto custa ler o esforço do Claude — a conta que decide se ele entra na rota.

O nível de esforço do Claude não está em `/api/agents/<slug>`: sai do
`cc_status`, que hoje só o `/painel` lê. Pôr esse dado na rota mataria o picote
de ~328ms do rótulo do motor nos seis agentes Claude da tropa — mas só vale se o
custo for uma fração pequena disso, porque ele passa a ser pago em TODA
navegação, não só quando o painel abre.

Mede o pior caso junto com o feliz: o fallback anda para trás nas sessões
recentes até achar arquivo legível em `/tmp`, então agente sem statusline paga o
laço inteiro. Medir só quem tem arquivo responderia pela metade boa da frota.

Uso: python3 custo-do-cc-status.py [repeticoes]
"""

import asyncio
import statistics
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2] / "apps" / "api"
sys.path.insert(0, str(RAIZ))

from config import get_settings  # noqa: E402
from db.store import GrupoBorgesDB  # noqa: E402
from routers.agents import _load_cc_status  # noqa: E402

reps = int(sys.argv[1]) if len(sys.argv) > 1 else 10


async def principal() -> None:
    db = GrupoBorgesDB(get_settings().db_path)
    agentes = [a["slug"] for a in await db.list_agents()]
    print(f"== custo de `_load_cc_status`, {reps} repetições por agente\n")
    piores: list[float] = []
    for slug in agentes:
        amostras = []
        for _ in range(reps):
            t0 = time.perf_counter()
            estado = await _load_cc_status(db, slug)
            amostras.append((time.perf_counter() - t0) * 1000)
        achou = "sem arquivo" if estado.payload is None else ("fallback" if estado.fell_back else "direto")
        piores.append(max(amostras))
        print(
            f"   {slug:10} {min(amostras):6.1f}–{max(amostras):6.1f} ms   "
            f"mediana {statistics.median(amostras):6.1f}   ({achou})"
        )
    print(f"\n   pior caso da frota: {max(piores):.1f} ms")


asyncio.run(principal())
