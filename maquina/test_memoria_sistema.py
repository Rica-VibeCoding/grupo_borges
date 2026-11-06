"""Contabilidade por fontes disjuntas, inclusive Chrome fora de user@."""

import pytest

from maquinas import ScopePorProcessos
from test_maquinas import linux, frota, falha


def meminfo(linux, **campos):
    mem = {"MemTotal": 8192000, "MemAvailable": 4096000, "Slab": 999999,
           "SReclaimable": 700000, "SUnreclaim": 206 * 1024,
           "KernelStack": 15 * 1024, "PageTables": 58 * 1024,
           "Shmem": 256 * 1024, "MemFree": 2000 * 1024,
           "Active(file)": 1000 * 1024, "Inactive(file)": 1000 * 1024,
           "KReclaimable": 512 * 1024, **campos}
    (linux.m.proc / "meminfo").write_text("".join(f"{k}: {v} kB\n" for k, v in mem.items()))


def zram(linux, nome="zram0", texto=None):
    pasta = linux.m.sys_block / nome
    pasta.mkdir(parents=True)
    (pasta / "mm_stat").write_text(texto if texto is not None else
        f"{2400 * 2**20} {600 * 2**20} {719 * 2**20} 0 9999999999 0 0 0 0\n")


def sistema(linux):
    raiz = linux.m.cgroup.parent / "sistema"
    raiz.mkdir()
    linux.m.cgroup_sistema = raiz
    return raiz


def unidade(raiz, nome, mb, pids=""):
    pasta = raiz / nome
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / "cgroup.procs").write_text(pids)
    (pasta / "memory.stat").write_text(
        f"anon {mb * 2**20}\nshmem 0\nfile {5000 * 2**20}\nkernel {900 * 2**20}\n")
    return pasta


def por_id(leitura):
    return {i["id"]: i for i in leitura["itens"]}


def test_quebra_medida_sem_slab_cache_swap_logico_ou_shmem_duplicado(linux):
    meminfo(linux)
    zram(linux)
    raiz = sistema(linux)
    unidade(raiz, "system.slice/tailscaled.service", 40)
    unidade(raiz, "system.slice/sshd.service", 8)
    linux.processo(10, pss=100 * 1024)
    linux.scope("app.slice/a.scope", 10)
    leitura = linux.m.abertos()
    itens = por_id(leitura)
    assert itens["memoria-kernel"]["memoria_mb"] == 279
    assert itens["memoria-zram"]["memoria_mb"] == 719
    assert itens["memoria-servicos"]["memoria_mb"] == 48
    assert itens["memoria-servicos"]["rotulo"] == "Serviços do sistema · tailscaled"
    assert itens["memoria-cache-retido"]["memoria_mb"] == 512
    assert itens["memoria-compartilhada"]["memoria_mb"] == 256
    assert itens["fora-da-lista"]["memoria_mb"] == 2086
    assert sum(i["memoria_mb"] for i in leitura["itens"]) == leitura["memoria_mb"] == 4000
    assert leitura["memoria_meminfo_kb"]["Shmem"] == 256 * 1024
    for i in leitura["itens"][1:]:
        assert i["acao_rotulo"] is None and i["grupo"] == "residual"
        falha(404, linux.m.fechar, i["id"])


def test_vps_root_e_containers_ja_tem_item_nao_reaparecem(frota, linux):
    meminfo(linux, SecPageTables=1024)
    zram(linux)
    linux.processo(10, args=("tailscaled",), pss=40 * 1024)
    linux.scope("system.slice/tailscaled.service", 10)
    linux.processo(20, args=("containerd",), pss=80 * 1024)
    linux.scope("system.slice/docker-abcdef.scope", 20)
    leitura = frota.m.abertos()
    assert not any(i["id"].startswith("sistema:") for i in leitura["itens"])
    assert len([i for i in leitura["itens"] if i["grupo"] == "protegido"]) == 2
    assert por_id(leitura)["memoria-kernel"]["memoria_mb"] == 280
    assert sum(i["memoria_mb"] for i in leitura["itens"]) == 4000


def test_varios_zram_inclui_fragmentacao_mas_nao_orig_ou_compr(linux):
    zram(linux)
    zram(linux, "zram1", f"{1000 * 2**20} {10 * 2**20} {21 * 2**20}\n")
    item = por_id(linux.m.abertos())["memoria-zram"]
    assert item["memoria_mb"] == 740
    assert len(item["zram_dispositivos"]) == 2


@pytest.mark.parametrize("texto", ["", "1 2", "1 lixo 3", "1 2 -3"])
def test_zram_invalido_nao_vira_zero_nem_sem_dono_preciso(linux, texto):
    zram(linux, texto=texto)
    itens = por_id(linux.m.abertos())
    assert itens["memoria-zram"]["memoria_mb"] is None
    assert itens["fora-da-lista"]["memoria_mb"] is None


def test_kernel_incompleto_e_diferenca_negativa_nao_sao_inventados(linux):
    (linux.m.proc / "meminfo").write_text("MemTotal: 1000 kB\nMemAvailable: 500 kB\n")
    itens = por_id(linux.m.abertos())
    assert itens["memoria-kernel"]["memoria_mb"] is None
    assert itens["fora-da-lista"]["memoria_mb"] is None
    meminfo(linux, MemAvailable=8191999)
    itens = por_id(linux.m.abertos())
    assert itens["memoria-kernel"]["memoria_mb"] == 279
    assert itens["fora-da-lista"]["memoria_mb"] is None


def test_unidade_filha_descontada_do_pai_e_cache_ignorado(linux):
    raiz = sistema(linux)
    unidade(raiz, "pai.service", 100)
    unidade(raiz, "pai.service/filha.service", 30)
    unidade(raiz, "pai.service/filha.service/neta.scope", 10)
    itens = por_id(linux.m.abertos())
    fontes = itens["memoria-servicos"]["memoria_fontes"]
    assert fontes["sistema:pai.service"]["memoria_mb"] == 70
    assert fontes["sistema:pai.service/filha.service"]["memoria_mb"] == 20
    assert fontes["sistema:pai.service/filha.service/neta.scope"]["memoria_mb"] == 10
    assert itens["memoria-servicos"]["memoria_mb"] == 100
    assert sum(i["memoria_mb"] for i in itens.values()) == 4000


def test_ancestrais_e_descendentes_de_user_nao_entram_duas_vezes(linux):
    raiz = sistema(linux)
    unidade(raiz, "user.slice/user@1000.service", 400)
    linux.m.cgroup = unidade(raiz, "user.slice/user@1000.service/usuario.service", 300)
    unidade(linux.m.cgroup, "app.scope", 100)
    assert not any(i["id"].startswith("sistema:") for i in linux.m.abertos()["itens"])


def test_chrome_ja_cobra_filhos_externos_somente_restante_usa_pss(linux):
    raiz = sistema(linux)
    linux.processo(10, args=("chrome",), pss=30 * 1024)
    linux.processo(20, args=("sshd",), pss=5 * 1024)
    pasta = unidade(raiz, "session-2.scope", 200, "10\n20\n")
    p = linux.m.processo(10)
    scope = ScopePorProcessos(pasta, "chrome.scope", (p,), p)
    leitura = linux.m.contabilizar({"itens": [{"memoria_mb": 30, "cpu_pct": 1}]}, 10, [scope])
    item = por_id({"itens": leitura["itens"][1:]})["memoria-servicos"]
    assert item["memoria_mb"] == 5
    assert item["memoria_fontes"]["sistema:session-2.scope"]["fontes"] == {"pss_pids": [20]}
    assert leitura["itens"][-1]["cpu_pct"] == 9
    assert sum(i["memoria_mb"] for i in leitura["itens"]) == 4000


def test_servico_sem_fonte_nao_e_ram_zero(linux):
    raiz = sistema(linux)
    pasta = unidade(raiz, "sshd.service", 8)
    (pasta / "memory.stat").write_text("shmem 8388608\n")
    itens = por_id(linux.m.abertos())
    assert itens["memoria-servicos"]["memoria_mb"] is None
    assert itens["fora-da-lista"]["memoria_mb"] is None


def test_arredondamento_fecha_no_centavo_mb(linux):
    meminfo(linux, SUnreclaim=123, KernelStack=456, PageTables=789)
    zram(linux, texto="999999 555555 666666\n")
    leitura = linux.m.contabilizar({"itens": [{"cpu_pct": 3, "memoria_mb": 12.34}]}, 8)
    assert round(sum(i["memoria_mb"] for i in leitura["itens"]), 2) == leitura["memoria_mb"]


def test_margem_de_memavailable_independe_do_residual_e_do_slab_total(linux):
    meminfo(linux, MemFree=600 * 1024, Active=99999999,
            **{"Active(file)": 1900 * 1024, "Inactive(file)": 1700 * 1024},
            KReclaimable=300 * 1024, MemAvailable=4000 * 1024)
    itens = por_id(linux.m.abertos())
    assert itens["memoria-cache-retido"]["memoria_mb"] == 500
    mem = linux.m._estatisticas_memoria()
    mem.pop("KReclaimable")
    from memoria_sistema import cache_retido
    assert cache_retido(mem)["memoria_mb"] is None


def test_shmem_sai_dos_cgroups_e_dos_recortes_sem_sumir_da_lista(linux):
    meminfo(linux, Shmem=80 * 1024)
    linux.processo(10, pss=100 * 1024)
    (linux.m.proc / "10/smaps_rollup").write_text("Pss_Anon: 102400 kB\nPss_Shmem: 81920 kB\n")
    pasta = linux.scope("a.scope", 10)
    (pasta / "memory.stat").write_text(f"anon {100 * 2**20}\nshmem {80 * 2**20}\n")
    scope = linux.m.scopes()[0]
    assert linux.m.memoria(scope) == 100
    assert linux.m.memoria(ScopePorProcessos(pasta, "recorte", scope.processos, scope.principal)) == 100
    itens = por_id(linux.m.abertos())
    assert itens["memoria-compartilhada"]["memoria_mb"] == 80
    assert sum(i["memoria_mb"] for i in itens.values()) == 4000


@pytest.mark.parametrize('config,esperado', [('CONFIG_VMAP_STACK=y', 334),
                                            ('# CONFIG_VMAP_STACK is not set', 349),
                                            ('', 279)])
def test_vmalloc_somente_com_config_conhecida_e_sem_duplicar_pilhas(linux, config, esperado):
    import gzip
    (linux.m.proc / 'config.gz').write_bytes(gzip.compress(config.encode()))
    meminfo(linux, VmallocUsed=70 * 1024)
    assert por_id(linux.m.abertos())['memoria-kernel']['memoria_mb'] == esperado
