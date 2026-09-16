"""Marca quem o Rica desligou de propósito, pra o vigia não ressuscitar.

Por que existe (16/09): o `watchdog-sessao-travada.py` conta como MORTE toda
sessão que estava de pé e sumiu por dois ciclos (~10 min), e a morte chama o
`ressuscitar.sh`, que levanta o agente E manda WhatsApp pro Rica. O único filtro
era "quem já estava `off` não é levantado" — nada distinguia queda de
desligamento deliberado, porque os dois deixam o mesmo rastro: estava de pé,
sumiu. Resultado medido no `incidentes.jsonl`: `05:32 maestro — falso-positivo
do vigia, bancada de teste do Rica lida como morte`.

**O contrato é um arquivo, não uma função importada.** Quem grava é a API do
cockpit (este repositório); quem lê é o vigia, que mora em `ze_claude` e roda
por cron noutro processo. Não há código a compartilhar entre os dois — há um
JSON com endereço fixo, e os dois lados carregam a mesma explicação em cima.

**A chave é o nome da SESSÃO tmux, não o slug.** O vigia percorre sessões
(`SESSOES`), e os dois nomes divergem de verdade na frota: o agente `canarinho`
mora na sessão `canario`. Carimbo gravado pelo slug nunca acharia par, e o
efeito seria nenhum — do jeito mais caro de descobrir, que é em produção.

**Só o botão Desligar marca.** O `aplicar-motor` também derruba a sessão, mas
religa na sequência dentro da mesma chamada: marcar ali só criaria carimbo pra
apagar meio segundo depois. E o `_boot_agent_sync` derruba a casca morta antes
de subir — pela mesma razão, o carimbo é do ENDPOINT, nunca do driver.

**O carimbo cai por duas portas, e a segunda é a que segura.** O Ligar apaga na
hora; o vigia apaga sozinho assim que vê a sessão VIVA. Sem a segunda, um boot
que não passe por aqui — `subir-frota.sh` na mão, unit do systemd — deixaria
carimbo velho de pé, e o próximo tombo de verdade passaria em branco. Com ela, a
vida do carimbo é "do desligar até o agente aparecer inteiro outra vez",
qualquer que seja a porta que o levantou.
"""

from __future__ import annotations

import fcntl
import json
import logging
import os
import time
from pathlib import Path

log = logging.getLogger(__name__)

#: Endereço do contrato. Mora ao lado do estado do próprio vigia
#: (`.watchdog-travada-state.json`), no mesmo dono (`clawd`) e no mesmo disco —
#: `os.replace` só é atômico dentro do mesmo sistema de arquivos.
CAMINHO = Path.home() / ".claude" / "channels" / ".desligados-de-proposito.json"

#: Trava de arquivo à parte, e não o próprio JSON: a gravação atômica troca o
#: inode do JSON, então um `flock` nele seria largado no meio do caminho e dois
#: escritores acabariam travando inodes diferentes. O `.lock` nunca é
#: substituído, só aberto.
TRAVA = CAMINHO.with_suffix(".lock")


def _ler_sem_trava() -> dict:
    try:
        with open(CAMINHO, encoding="utf-8") as fh:
            dados = json.load(fh)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        # JSON corrompido não pode travar o Desligar: o pior caso de tratar como
        # vazio é o vigia voltar a se comportar como antes desta mudança.
        log.warning("carimbo de desligamento ilegível em %s — tratando como vazio", CAMINHO)
        return {}
    return dados if isinstance(dados, dict) else {}


def _gravar_atomico(dados: dict) -> None:
    """Grava em temporário na MESMA pasta e renomeia por cima.

    `os.replace` é atômico no POSIX: o vigia lendo no mesmo instante vê o
    arquivo inteiro de antes ou o inteiro de depois, nunca meio JSON. É o
    `_write_atomic` que o próprio CPython usa no `importlib`.
    """
    tmp = CAMINHO.with_name(f"{CAMINHO.name}.{os.getpid()}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(dados, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, CAMINHO)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _altera(muda) -> None:
    """Lê, aplica `muda` e grava — tudo com a trava na mão.

    Ler e gravar sem trava perderia atualização: o vigia limpa carimbo dos vivos
    no mesmo arquivo, a cada 5 min, e um Desligar caindo dentro dessa janela
    sumiria sem deixar erro.
    """
    CAMINHO.parent.mkdir(parents=True, exist_ok=True)
    with open(TRAVA, "a+") as trava:
        fcntl.flock(trava, fcntl.LOCK_EX)
        try:
            dados = _ler_sem_trava()
            novos = muda(dict(dados))
            if novos != dados:
                _gravar_atomico(novos)
        finally:
            fcntl.flock(trava, fcntl.LOCK_UN)


def marcar(sessao: str, por: str = "cockpit") -> None:
    """Carimba a sessão como desligada de propósito. Nunca levanta exceção.

    Falhar aqui não pode derrubar o Desligar: sem carimbo o vigia volta a ser o
    de antes (ressuscita e avisa), que é ruim mas não é perda. Já um Desligar
    que devolve erro deixa o Rica sem saber se o agente caiu ou não.
    """
    try:
        _altera(lambda d: {**d, sessao: {"em": int(time.time()), "por": por}})
    except OSError as exc:
        log.warning("não consegui carimbar %s como desligada de propósito: %s", sessao, exc)


def desmarcar(sessao: str) -> None:
    """Tira o carimbo. Nunca levanta exceção, pela mesma razão do `marcar`."""
    try:
        _altera(lambda d: {k: v for k, v in d.items() if k != sessao})
    except OSError as exc:
        log.warning("não consegui limpar o carimbo de %s: %s", sessao, exc)
