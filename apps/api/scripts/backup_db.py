#!/usr/bin/env python3
"""Backup comprimido do sqlite do cockpit, com a API rodando.

`cp` de arquivo sqlite vivo pode capturar um estado no meio de uma transação;
`Connection.backup` copia página a página respeitando o lock e entrega um
arquivo consistente sem parar ninguém.

Guarda só o backup mais recente: isto é rede de segurança pra poda que roda
logo depois, não acervo histórico.

Uso:
    python3 scripts/backup_db.py <caminho-do-db> <pasta-destino>
"""
from __future__ import annotations

import gzip
import shutil
import sqlite3
import sys
import time
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2

    db, destino = Path(sys.argv[1]), Path(sys.argv[2])
    destino.mkdir(parents=True, exist_ok=True)
    bruto = destino / f"{db.stem}-{time.strftime('%Y-%m-%d')}.db"

    origem = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    saida = sqlite3.connect(bruto)
    try:
        origem.backup(saida)
    finally:
        saida.close()
        origem.close()

    comprimido = bruto.with_suffix(".db.gz")
    with bruto.open("rb") as entrada, gzip.open(comprimido, "wb", compresslevel=6) as gz:
        shutil.copyfileobj(entrada, gz)
    bruto.unlink()

    for velho in sorted(destino.glob(f"{db.stem}-*.db.gz"))[:-1]:
        velho.unlink()

    print(f"backup    {comprimido} ({comprimido.stat().st_size / 1048576:,.0f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
