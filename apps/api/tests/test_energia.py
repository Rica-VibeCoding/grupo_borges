"""Contrato de energia: todos os efeitos são registrados por um executor falso."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi import FastAPI

from routers import energia as energia_router
from services import energia

HOSTS = {
    "arsenal": "ricardo@100.91.105.22",
    "pc": "RicardoBorges@100.118.54.91",
    "note": "ricardo@100.116.209.95",
}
SCRIPT_PC = "/home/clawd/repos/ze_claude/pavan/.claude/skills/pc-remoto/scripts/pc.sh"
PS_LINUX = """chrome /opt/google/chrome/chrome --user-data-dir=/home/ricardo/.config/ze-chrome
chrome /opt/google/chrome/chrome --user-data-dir=/home/ricardo/.config/ze-chrome
chrome /opt/google/chrome/chrome --user-data-dir=/home/ricardo/.config/ze-chrome-sobral
chrome /opt/google/chrome/chrome --type=renderer --user-data-dir=/home/ricardo/.config/ze-chrome
chrome /opt/google/chrome/chrome
chrome /opt/google/chrome/chrome --type=gpu-process
chrome_crashpad /opt/google/chrome/chrome_crashpad_handler
sh /bin/sh -c echo chrome
"""


def ssh(maquina, comando):
    # Expectativa independente dos montadores do serviço.
    return (
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3",
        "-o", "StrictHostKeyChecking=yes", HOSTS[maquina], comando,
    )


def pc(acao):
    return (
        "systemd-run", "--user", "--collect", "--property=Type=exec",
        "--property=RuntimeMaxSec=600s", SCRIPT_PC, acao,
    )


class ExecutorFalso:
    def __init__(self):
        self.chamadas = []
        self.ligadas = dict.fromkeys((host.split("@")[1] for host in HOSTS.values()), False)
        self.respostas = {}

    async def __call__(self, pedido):
        self.chamadas.append(pedido)
        await asyncio.sleep(0)
        resposta = self.respostas.get(pedido.argumentos)
        if isinstance(resposta, Exception):
            raise resposta
        if resposta is not None:
            return resposta
        if pedido.tipo == "tcp":
            return energia.Resultado(codigo=0 if self.ligadas[pedido.argumentos[0]] else 1)
        return energia.Resultado()

    def ligar(self, maquina):
        self.ligadas[HOSTS[maquina].split("@")[1]] = True

    @property
    def comandos(self):
        return [pedido for pedido in self.chamadas if pedido.tipo == "comando"]


@pytest.fixture
def bancada(monkeypatch):
    executor = ExecutorFalso()
    agora = [100.0]
    async def sem_painel(maquina):
        raise RuntimeError("painel fora")

    servico = energia.ServicoEnergia(executor=executor, relogio=lambda: agora[0], ler_abertos=sem_painel)
    monkeypatch.setattr(energia, "servico", servico)
    return executor, agora, servico


@pytest.fixture
async def cliente(bancada):
    app = FastAPI()
    app.include_router(energia_router.router, prefix="/api/energia")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://cockpit.test"
    ) as client:
        yield client


async def test_lista_contrato_hosts_timeout_e_cache(cliente, bancada):
    executor, agora, _ = bancada
    executor.ligar("pc")
    resposta = await cliente.get("/api/energia")
    assert resposta.status_code == 200
    assert resposta.json() == [
        {"id": "arsenal", "nome": "Arsenal", "ligado": False,
         "ligar": {"pode": False, "motivo": "falta a tomada"}, "em_andamento": None},
        {"id": "pc", "nome": "PC", "ligado": True,
         "ligar": {"pode": True, "motivo": None}, "em_andamento": None},
        {"id": "note", "nome": "Note", "ligado": False,
         "ligar": {"pode": False, "motivo": "liga só na mão"}, "em_andamento": None},
    ]
    assert executor.chamadas == [
        energia.Execucao("tcp", ("100.91.105.22", "22"), 3.0),
        energia.Execucao("tcp", ("100.118.54.91", "22"), 3.0),
        energia.Execucao("tcp", ("100.116.209.95", "22"), 3.0),
    ]
    agora[0] += 14.9
    assert (await cliente.get("/api/energia")).json() == resposta.json()
    assert len(executor.chamadas) == 3
    agora[0] = 115.0
    await cliente.get("/api/energia")
    assert len(executor.chamadas) == 6


async def test_leituras_simultaneas_compartilham_cache(cliente, bancada):
    respostas = await asyncio.gather(*(cliente.get("/api/energia") for _ in range(8)))
    assert all(resposta.status_code == 200 for resposta in respostas)
    assert len(bancada[0].chamadas) == 3


@pytest.mark.parametrize("maquina", ["vps", "outra", "PC", "arsenal;poweroff", "100.91.105.22"])
@pytest.mark.parametrize("rota", ["impacto", "ligar", "desligar"])
async def test_allowlist_antes_de_qualquer_efeito(cliente, bancada, maquina, rota):
    caminho = f"/api/energia/{maquina}/{rota}"
    resposta = (
        await cliente.get(caminho) if rota == "impacto"
        else await cliente.post(caminho, json={"confirmo": True})
    )
    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "máquina desconhecida"}
    assert bancada[0].chamadas == []


@pytest.mark.parametrize("corpo", [None, {}, {"confirmo": False}, {"confirmo": 1},
                                   {"confirmo": "true"}, {"confirmo": None},
                                   {"confirmo": True, "host": "injetado"}])
async def test_desligar_exige_true_literal(cliente, bancada, corpo):
    resposta = await cliente.post("/api/energia/arsenal/desligar", json=corpo)
    assert resposta.status_code == 422
    assert bancada[0].chamadas == []


@pytest.mark.parametrize("maquina", HOSTS)
async def test_ligar_ja_ligada_nao_chama_executor(cliente, bancada, maquina):
    executor, _, _ = bancada
    executor.ligar(maquina)
    await cliente.get("/api/energia")
    executor.chamadas.clear()
    resposta = await cliente.post(f"/api/energia/{maquina}/ligar")
    assert resposta.status_code == 200
    assert resposta.json() == {"mensagem": "já está ligada", "em_andamento": None}
    assert executor.chamadas == []


async def test_ligar_ja_ligada_sem_cache_so_verifica_tcp(cliente, bancada):
    executor, _, _ = bancada
    executor.ligar("pc")
    assert (await cliente.post("/api/energia/pc/ligar")).status_code == 200
    assert executor.chamadas == [energia.Execucao("tcp", ("100.118.54.91", "22"), 3.0)]


@pytest.mark.parametrize("maquina,motivo", [("arsenal", "falta a tomada"), ("note", "liga só na mão")])
async def test_ligar_sem_caminho(cliente, bancada, maquina, motivo):
    resposta = await cliente.post(f"/api/energia/{maquina}/ligar")
    assert resposta.status_code == 409
    assert resposta.json() == {"mensagem": motivo}
    assert bancada[0].comandos == []


@pytest.mark.parametrize("maquina", HOSTS)
async def test_desligar_desligada(cliente, bancada, maquina):
    resposta = await cliente.post(f"/api/energia/{maquina}/desligar", json={"confirmo": True})
    assert resposta.status_code == 409
    assert resposta.json() == {"mensagem": "já está desligada"}
    assert bancada[0].comandos == []


@pytest.mark.parametrize("maquina", ["arsenal", "note"])
async def test_desligar_linux_comando_exato_e_estado(cliente, bancada, maquina):
    executor, _, _ = bancada
    executor.ligar(maquina)
    resposta = await cliente.post(f"/api/energia/{maquina}/desligar", json={"confirmo": True})
    assert resposta.status_code == 202
    assert resposta.json() == {"mensagem": "pedido de desligar enviado", "em_andamento": "desligando"}
    assert executor.comandos == [
        energia.Execucao("comando", ssh(maquina, "sudo -n systemctl poweroff"), 10.0)
    ]
    estados = (await cliente.get("/api/energia")).json()
    assert next(e for e in estados if e["id"] == maquina)["em_andamento"] == "desligando"


@pytest.mark.parametrize("acao", ["ligar", "desligar"])
async def test_pc_systemd_comando_exato_sem_bloquear_por_tres_minutos(cliente, bancada, acao):
    executor, agora, _ = bancada
    if acao == "desligar":
        executor.ligar("pc")
    resposta = await cliente.post(f"/api/energia/pc/{acao}", json={"confirmo": True})
    assert resposta.status_code == 202
    andamento = "ligando" if acao == "ligar" else "desligando"
    assert resposta.json()["em_andamento"] == andamento
    assert executor.comandos == [energia.Execucao("comando", pc(acao), 10.0)]
    estados = (await cliente.get("/api/energia")).json()
    assert next(e for e in estados if e["id"] == "pc")["em_andamento"] == andamento
    executor.ligadas["100.118.54.91"] = acao == "ligar"
    agora[0] += 15
    estados = (await cliente.get("/api/energia")).json()
    assert next(e for e in estados if e["id"] == "pc")["em_andamento"] is None


async def test_acao_simultanea_nao_duplica_comando_e_andamento_expira(cliente, bancada):
    executor, agora, _ = bancada
    respostas = await asyncio.gather(*(cliente.post("/api/energia/pc/ligar") for _ in range(8)))
    assert all(resposta.status_code == 202 for resposta in respostas)
    assert len(executor.comandos) == 1
    agora[0] += 600
    estados = (await cliente.get("/api/energia")).json()
    assert next(e for e in estados if e["id"] == "pc")["em_andamento"] is None


async def test_impacto_arsenal_conta_perfis_e_pessoal_e_sessoes(cliente, bancada):
    executor = bancada[0]
    executor.respostas.update({
        ssh("arsenal", energia.TMUX): energia.Resultado(
            stdout="cockpit-tmux-tara-c8aedcfc.scope loaded active running x\n"
                   "cockpit-tmux-fluyt-pos-93fd0872.scope loaded active running x\n"
                   "cockpit-tmux-tara-0475e3f0.scope loaded active running x\n"
                   "--\ntara\tTara\n"
        ),
        ssh("arsenal", "ps -eo comm=,args="): energia.Resultado(stdout=PS_LINUX),
        ssh("arsenal", energia.SESSOES_GRAFICAS): energia.Resultado(stdout="tty\nwayland\n"),
    })
    resposta = await cliente.get("/api/energia/arsenal/impacto")
    assert resposta.status_code == 200
    assert resposta.json() == {
        "agentes": ["Fluyt Pos", "Tara"], "chromes": 3, "em_uso": True,
        "aviso": "O Rica pode estar usando esta máquina agora.",
    }
    assert executor.chamadas == [
        energia.Execucao("comando", ssh("arsenal", comando), 10.0)
        for comando in (
            energia.TMUX, "ps -eo comm=,args=",
            '''sessions=$(loginctl list-sessions --no-legend --no-pager) || exit 1
while read -r session rest; do
    if [ -n "$session" ]; then
        loginctl show-session "$session" -p Type --value || exit 1
    fi
done <<EOF
$sessions
EOF''',
        )
    ]


async def test_arsenal_sem_agentes_mantem_aviso(cliente, bancada):
    bancada[0].respostas[ssh("arsenal", energia.TMUX)] = energia.Resultado(stdout="")
    resposta = await cliente.get("/api/energia/arsenal/impacto")
    assert resposta.status_code == 200
    assert resposta.json() == {
        "agentes": [], "chromes": 0, "em_uso": False,
        "aviso": "O Rica pode estar usando esta máquina agora.",
    }


@pytest.mark.parametrize("tipo", ["x11", "wayland", "tty", ""])
async def test_note_impacto_sem_agentes(cliente, bancada, tipo):
    executor = bancada[0]
    executor.respostas[ssh("note", "ps -eo comm=,args=")] = energia.Resultado(stdout=PS_LINUX)
    executor.respostas[ssh("note", energia.SESSOES_GRAFICAS)] = energia.Resultado(stdout=tipo)
    resposta = await cliente.get("/api/energia/note/impacto")
    assert resposta.status_code == 200
    assert resposta.json() == {
        "agentes": [], "chromes": 3, "em_uso": tipo in {"x11", "wayland"}, "aviso": None,
    }
    assert all(p.argumentos[-1] != energia.TMUX for p in executor.comandos)


@pytest.mark.parametrize("logado", [True, False])
async def test_pc_impacto_query_user_chrome_e_comandos_exatos(cliente, bancada, logado):
    executor = bancada[0]
    executor.respostas[ssh("pc", "query user")] = (
        energia.Resultado(stdout=" USERNAME SESSIONNAME ID STATE IDLE TIME LOGON TIME\n"
                               ">Ricardo console 1 Active none 11/05/2026 09:00\n")
        if logado else energia.Resultado(codigo=1, stderr="No User exists for *")
    )
    chrome = energia.CHROMES_WINDOWS
    executor.respostas[ssh("pc", chrome)] = energia.Resultado(stdout="2\r\n")
    resposta = await cliente.get("/api/energia/pc/impacto")
    assert resposta.status_code == 200
    assert resposta.json() == {
        "agentes": [], "chromes": 2, "em_uso": logado,
        "aviso": "O Rica pode estar usando esta máquina agora." if logado else None,
    }
    assert executor.chamadas == [
        energia.Execucao("comando", ssh("pc", comando), 10.0) for comando in ("query user", chrome)
    ]


@pytest.mark.parametrize("falha,motivo", [
    (TimeoutError(), "a máquina não respondeu a tempo"),
    (FileNotFoundError(), "não foi possível executar o comando de energia"),
    (energia.Resultado(255, stderr="Permission denied (publickey)."),
     "o acesso por SSH foi recusado; confira a chave e a permissão"),
    (energia.Resultado(255, stderr="Connection refused"),
     "não foi possível conectar à máquina por SSH"),
    (energia.Resultado(255, stderr="Connection timed out"), "a máquina não respondeu a tempo"),
    (energia.Resultado(255, stderr="Host key verification failed."),
     "a identidade SSH da máquina precisa ser conferida"),
    (energia.Resultado(1, stderr="sudo: a password is required"),
     "falta permissão para desligar esta máquina sem senha"),
    (energia.Resultado(255, stderr="erro técnico privado"),
     "não foi possível consultar ou comandar a máquina por SSH"),
])
@pytest.mark.parametrize("rota", ["impacto", "desligar"])
async def test_erro_ssh_vira_motivo_legivel(cliente, bancada, falha, motivo, rota):
    executor, _, servico = bancada
    executor.ligar("arsenal")
    comando = energia.TMUX if rota == "impacto" else "sudo -n systemctl poweroff"
    executor.respostas[ssh("arsenal", comando)] = falha
    resposta = (
        await cliente.get("/api/energia/arsenal/impacto") if rota == "impacto"
        else await cliente.post("/api/energia/arsenal/desligar", json={"confirmo": True})
    )
    assert resposta.status_code == 502
    assert resposta.json() == {"mensagem": motivo}
    assert servico._andamento == {}


async def test_systemd_falhou_nao_marca_ligando(cliente, bancada):
    executor, _, servico = bancada
    executor.respostas[pc("ligar")] = energia.Resultado(1, stderr="Failed to connect to bus")
    resposta = await cliente.post("/api/energia/pc/ligar")
    assert resposta.status_code == 502
    assert resposta.json() == {"mensagem": "não foi possível iniciar o controle da tomada do PC"}
    assert servico._andamento == {}


@pytest.mark.parametrize("falha", [TimeoutError(), ConnectionRefusedError()])
async def test_tcp_falha_e_desligado(cliente, bancada, falha):
    bancada[0].respostas[("100.91.105.22", "22")] = falha
    resposta = await cliente.get("/api/energia")
    assert resposta.status_code == 200
    assert resposta.json()[0]["ligado"] is False


async def test_host_do_cliente_nao_entra_no_comando(cliente, bancada):
    bancada[0].ligar("note")
    resposta = await cliente.post(
        "/api/energia/note/desligar?host=atacante", json={"confirmo": True}
    )
    assert resposta.status_code == 202
    assert bancada[0].comandos == [
        energia.Execucao("comando", ssh("note", "sudo -n systemctl poweroff"), 10.0)
    ]


async def test_servico_tambem_recusa_ids_fora_da_allowlist(bancada):
    executor, _, servico = bancada
    for maquina in ("vps", "desconhecida"):
        for operacao in (servico.impacto(maquina), servico.acionar(maquina, "ligar")):
            with pytest.raises(energia.FalhaEnergia) as falha:
                await operacao
            assert falha.value.status == 404
    assert executor.chamadas == []


async def test_router_registrado_na_api_real(bancada):
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://cockpit.test",
        headers={"Tailscale-User-Login": "rica@teste"},
    ) as client:
        assert (await client.get("/api/energia")).status_code == 200


async def test_pc_query_user_com_codigo_1_e_usuario_logado(cliente, bancada):
    executor = bancada[0]
    executor.respostas[ssh("pc", "query user")] = energia.Resultado(
        codigo=1,
        stdout=" USERNAME              SESSIONNAME        ID  STATE   IDLE TIME  LOGON TIME\n"
               " ricardoborges         console             1  Ativo       nenhum   05/11/2026 13:29\n",
    )
    executor.respostas[ssh("pc", energia.CHROMES_WINDOWS)] = energia.Resultado(
        stdout="4\r\n"
    )
    resposta = await cliente.get("/api/energia/pc/impacto")
    assert resposta.status_code == 200
    assert resposta.json()["em_uso"] is True
    assert resposta.json()["aviso"] == "O Rica pode estar usando esta máquina agora."


async def test_arsenal_conta_chromes_pela_lista_do_painel(cliente, bancada):
    from types import SimpleNamespace as N

    executor, _, servico = bancada

    async def lista(maquina):
        return N(itens=[
            N(grupo="seus", rotulo="Chrome pessoal"), N(grupo="agente", rotulo="Chrome do Fluyt Com"),
            N(grupo="agente", rotulo="Chrome do Teste"), N(grupo="seus", rotulo="VS Code"),
            N(grupo="protegido", rotulo="Agente Estúdio"),
        ])

    servico._ler_abertos = lista
    executor.respostas[ssh("arsenal", energia.TMUX)] = energia.Resultado(stdout="")
    executor.respostas[ssh("arsenal", energia.SESSOES_GRAFICAS)] = energia.Resultado(stdout="tty")
    resposta = await cliente.get("/api/energia/arsenal/impacto")
    assert resposta.json()["chromes"] == 3
    assert all(c.argumentos[-1] != energia.CHROMES_LINUX for c in executor.chamadas)
