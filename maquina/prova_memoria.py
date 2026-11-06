"""Prova read-only das fontes reais e da soma no painel instalado (sem revelar chave).

python3 prova_memoria.py /tmp/prova-memoria.json
"""

from decimal import Decimal
import json
from pathlib import Path
import sys
from unittest.mock import patch
from urllib.request import ProxyHandler, Request, build_opener


def verificar(leitura):
    mem = leitura["memoria_meminfo_kb"]
    assert leitura["memoria_mb"] == round((mem["MemTotal"] - mem["MemAvailable"]) / 1024, 2)
    for item in leitura["itens"]:
        fontes = item.get("memoria_fontes", {})
        if item["id"] == "memoria-kernel":
            assert fontes == {k: mem[k] * 1024 for k in
                              ("SUnreclaim", "KernelStack", "PageTables", "SecPageTables") if k in mem}
            esperado = round(sum(fontes.values()) / 2**20, 2)
        elif item["id"] == "memoria-zram":
            esperado = round(sum(fontes.values()) / 2**20, 2)
        elif item["id"].startswith("sistema:") and "pss_pids" not in fontes:
            esperado = round(sum(v["sinal"] * (v["anon"] + v["shmem"])
                                 for v in fontes.values()) / 2**20, 2)
        else:
            continue
        assert item["memoria_mb"] == esperado, item
    assert all(i["memoria_mb"] is not None for i in leitura["itens"]), "Há RAM desconhecida"
    soma = sum(Decimal(str(i["memoria_mb"])) for i in leitura["itens"])
    assert soma == Decimal(str(leitura["memoria_mb"])), (soma, leitura["memoria_mb"])


def main():
    pasta = Path.home() / ".local/share/cockpit-maquina"
    sys.path.insert(0, str(pasta))
    import painel

    # Captura o texto devolvido pelo kernel durante a coleta instalada. Outra
    # leitura posterior pode divergir: o SO continua funcionando durante a prova.
    originais, ler = {}, Path.read_text

    def capturar(path, *args, **kwargs):
        texto = ler(path, *args, **kwargs)
        if path.name in {"meminfo", "mm_stat", "memory.stat", "smaps_rollup"}:
            originais.setdefault(str(path), []).append(texto)
        return texto

    with patch.object(Path, "read_text", capturar):
        coleta = painel.MAQUINAS.abertos()
    verificar(coleta)
    for item in coleta["itens"]:
        fontes = item.get("memoria_fontes", {})
        if item["id"] == "memoria-zram":
            for arq, valor in fontes.items():
                assert any(int(t.split()[2]) == valor for t in originais[arq])
        elif item["id"].startswith("sistema:"):
            if "pss_pids" in fontes:
                kb = 0
                for pid in fontes["pss_pids"]:
                    texto = originais[f"/proc/{pid}/smaps_rollup"][-1]
                    kb += sum(int(l.split()[1]) for l in texto.splitlines()
                              if l.startswith(("Pss_Anon:", "Pss_Shmem:")))
                assert item["memoria_mb"] == round(kb / 1024, 2)
            else:
                for arq, campos in fontes.items():
                    candidatos = [dict(l.split() for l in t.splitlines()) for t in originais[arq]]
                    assert any(all(int(c[k]) == campos[k] for k in ("anon", "shmem"))
                               for c in candidatos)
    mem_real = {l.split(":")[0]: int(l.split()[1])
                for l in originais["/proc/meminfo"][-1].splitlines()}
    assert coleta["memoria_meminfo_kb"] == mem_real
    chave = (Path.home() / ".config/cockpit-maquina/chave").read_text().strip()
    url = f'http://{painel.CONFIG["ip_tailscale"]}:{painel.CONFIG["porta"]}/api/maquina/abertos'
    pedido = Request(url, headers={"Authorization": "Bearer " + chave})
    with build_opener(ProxyHandler({})).open(pedido, timeout=20) as resposta:
        http = json.load(resposta)
    verificar(http)
    prova = {"coleta_instalada": coleta, "fontes_lidas": originais, "http": http,
             "resultado": "fontes conferidas; soma exata nas duas leituras"}
    Path(sys.argv[1]).write_text(json.dumps(prova, ensure_ascii=False, indent=2) + "\n")
    print(prova["resultado"])
    for item in http["itens"]:
        if item["grupo"] == "residual":
            print(f'{item["rotulo"]}: {item["memoria_mb"]:.2f} MB')
    print(f'Total da lista = cartão: {http["memoria_mb"]:.2f} MB')


if __name__ == "__main__":
    main()
