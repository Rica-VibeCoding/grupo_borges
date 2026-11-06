"""RAM física fora dos apps; fontes e limites em maquina/README.md."""

from functools import lru_cache
import gzip
import os
from pathlib import Path

from medicao_processos import memoria_mb
from memoria_tmpfs import compartilhada


def item_memoria(ident, rotulo, mb, fontes=None):
    return {"id": ident, "grupo": "residual", "rotulo": rotulo, "dono": None,
            "memoria_mb": mb, "cpu_pct": None, "parado_s": None, "abas": [],
            "pede_confirmacao": False, "acao_rotulo": None,
            "memoria_fontes": fontes or {}}


@lru_cache(maxsize=8)
def pilhas_vmalloc(proc):
    candidatos = [(proc / "config.gz", True)]
    if proc == Path("/proc"):
        candidatos.append((Path("/boot") / ("config-" + os.uname().release), False))
    for arquivo, comprimido in candidatos:
        try:
            texto = gzip.decompress(arquivo.read_bytes()).decode() if comprimido else arquivo.read_text()
            if "CONFIG_VMAP_STACK=y" in texto.splitlines():
                return True
            if "# CONFIG_VMAP_STACK is not set" in texto.splitlines():
                return False
        except (OSError, ValueError, EOFError):
            pass
    return None


def kernel(mem, proc=None):
    # Slab inclui SReclaimable: somá-lo inteiro contaria cache reclamável.
    campos = ("SUnreclaim", "KernelStack", "PageTables", "SecPageTables")
    fontes = {k: mem[k] * 1024 for k in campos if k in mem}
    # SecPageTables não existe em kernels antigos; os outros são obrigatórios.
    vmap = pilhas_vmalloc(proc) if proc is not None else None
    if vmap is not None and "VmallocUsed" in mem:
        fontes["VmallocUsed"] = mem["VmallocUsed"] * 1024
    total = sum(fontes.values())
    if vmap and "VmallocUsed" in fontes:
        # VMAP_STACK: pilhas já estão em VmallocUsed. Nunca soma ambas.
        total -= fontes.get("KernelStack", 0)
    mb = (round(total / 2**20, 2)
          if all(k in mem for k in campos[:3]) else None)
    item = item_memoria("memoria-kernel", "Kernel", mb, fontes)
    item["kernel_vmap_stack"] = vmap
    return item


def zram(sys_block):
    dispositivos, fontes = {}, {}
    for pasta in sorted(sys_block.glob("zram*")):
        try:
            # mm_stat: orig_data_size, compr_data_size, mem_used_total (bytes).
            valores = [int(v) for v in (pasta / "mm_stat").read_text().split()]
            if len(valores) < 3 or min(valores[:3]) < 0:
                raise ValueError("mm_stat inválido")
            dispositivos[pasta.name] = dict(zip(
                ("orig_data_size", "compr_data_size", "mem_used_total"), valores[:3]))
            fontes[str(pasta / "mm_stat")] = valores[2]
        except (OSError, ValueError):
            fontes[str(pasta / "mm_stat")] = None
    if not fontes:
        return None
    mb = None if None in fontes.values() else round(sum(fontes.values()) / 2**20, 2)
    item = item_memoria("memoria-zram", "Swap comprimido (zram)", mb, fontes)
    item["zram_dispositivos"] = dispositivos
    return item


def cache_retido(mem):
    # Inversa de si_mem_available (mm/show_mem.c): reserva de páginas livres +
    # parcelas da LRU de arquivos e KReclaimable excluídas da estimativa.
    campos = ("MemFree", "Active(file)", "Inactive(file)", "KReclaimable", "MemAvailable")
    fontes = {k: mem[k] * 1024 for k in campos if k in mem}
    valor = (sum(fontes[k] for k in campos[:-1]) - fontes[campos[-1]]
             if len(fontes) == len(campos) else None)
    return item_memoria("memoria-cache-retido", "Cache que o kernel segura",
                        round(valor / 2**20, 2) if valor is not None and valor >= 0 else None, fontes)


def servicos(maquinas, scopes):
    """Unidades externas a user@; a VPS já lista a raiz inteira em frota.py.

    Nunca soma um ancestral (user@) aos filhos já listados. Chrome pode trazer
    processos de session-N.scope para um item: mede só os demais por PSS nesse
    caso, em vez de cobrar novamente o cgroup inteiro.
    """
    raiz, usuario = maquinas.cgroup_sistema, maquinas.cgroup
    if raiz == usuario:
        return []
    usados = {p.pid for s in scopes for p in s.processos}
    itens = []
    for arquivo in sorted(raiz.rglob("memory.stat")):
        caminho = arquivo.parent
        if (caminho.suffix not in {".service", ".scope"}
                or caminho == usuario or usuario in caminho.parents or caminho in usuario.parents):
            continue
        # Não importa cmdline nem exige permissão de ptrace para serviços root.
        # memory.stat é hierárquico; desconta cada unidade filha imediata.
        fontes, mb = {}, None
        try:
            filhos = list(maquinas._unidades_filhas_caminho(caminho))
            for unidade in (caminho, *filhos):
                mem = maquinas._estatisticas(unidade / "memory.stat")
                fontes[str(unidade / "memory.stat")] = {
                    "anon": mem["anon"],
                    "sinal": 1 if unidade == caminho else -1}
            uso = sum(v["sinal"] * v["anon"] for v in fontes.values())
            if uso < 0:
                raise ValueError("leituras de cgroup divergentes")
            mb = round(uso / 2**20, 2)
            pids = set()
            for procs in caminho.rglob("cgroup.procs"):
                if not any(f == procs.parent or f in procs.parent.parents for f in filhos):
                    pids.update(int(v) for v in procs.read_text().split())
            if pids & usados:
                # A parte transferida para Chrome já está cobrada por PSS.
                processos = [p for pid in sorted(pids - usados)
                             if (p := maquinas.processo(pid)) is not None]
                mb = memoria_mb(maquinas.proc, processos)
                fontes = {"pss_pids": [p.pid for p in processos]}
        except (OSError, ValueError, KeyError):
            mb = None
        # Unidades inativas e sem RAM não precisam de linha.
        if mb != 0:
            nome = str(caminho.relative_to(raiz))
            itens.append(item_memoria("sistema:" + nome,
                         "Sistema · " + caminho.stem, mb, fontes))
    if not itens:
        return []
    mb = None if any(i["memoria_mb"] is None for i in itens) else round(
        sum(i["memoria_mb"] for i in itens), 2)
    nomes = [i["rotulo"].removeprefix("Sistema · ") for i in itens
             if i["memoria_mb"] is not None and i["memoria_mb"] >= 20]
    rotulo = "Serviços do sistema" + (" · " + ", ".join(nomes) if nomes else "")
    return [item_memoria("memoria-servicos", rotulo, mb,
                        {i["id"]: {"memoria_mb": i["memoria_mb"],
                                   "fontes": i["memoria_fontes"]} for i in itens})]


def itens_sistema(maquinas, mem, scopes):
    itens = [kernel(mem, maquinas.proc), zram(maquinas.sys_block), cache_retido(mem),
             *compartilhada(maquinas.proc, mem, item_memoria), *servicos(maquinas, scopes)]
    return [i for i in itens if i is not None and
            (i["memoria_mb"] != 0 or i["id"].startswith("tmpfs:"))]
