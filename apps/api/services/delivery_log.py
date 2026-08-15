"""Denominador da entrega: uma linha por tentativa de colar no pane.

Por que existe (15/08): a taxa real de falha de entrega era **impossível de
medir**. O `_DELIVERY_CHANNEL_RECORDS` do `tmux_driver` vive só na memória do
processo e some em todo restart da API — foram quatro num dia —, e o access log
do uvicorn não tem timestamp, então não dava pra ligar um envio a um resíduo
encontrado no pane. Sem denominador não existe antes/depois, e sem antes/depois
nenhum conserto nessa área pode ser provado.

**É aditivo e só isso.** Ninguém lê daqui pra decidir nada. Se a gravação
falhar, a entrega segue: telemetria não pode derrubar a mensagem do Rica. Mas a
falha vai pro log em ERROR — instrumento que falha calado foi o defeito mais
repetido do dia (quatro ferramentas mentiram, cada uma devolvendo um resultado
plausível), e este aqui nasce depois dessa lição.

**Teto em registros, não em tempo.** O painel fica aberto o dia inteiro; corte
por janela deixa o crescimento preso ao uso. 20 mil linhas ≈ 1,6 MB e cobrem
semanas de tráfego real (34 envios numa janela de uma hora, medido).
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from typing import Literal

log = logging.getLogger(__name__)

Desfecho = Literal["entregue", "recusado", "incerto"]

TETO_DE_REGISTROS = 20_000
"""Quantas tentativas ficam guardadas. A mais velha sai quando estoura."""

APARA_A_CADA = 200
"""De quantas em quantas gravações vale a pena varrer. Aparar em toda inserção
custaria um DELETE por mensagem enviada; a 200 o excedente máximo é 1% do teto."""

_guarda = threading.Lock()
_gravacoes_desde_a_apara = 0


def registra_tentativa(
    db_path: str,
    session_name: str,
    desfecho: Desfecho,
    motivo: str | None = None,
    *,
    agora_ms: int | None = None,
) -> bool:
    """Grava uma tentativa. Devolve se gravou — nunca levanta.

    O `bool` existe pro teste; o chamador de produção ignora, porque não há nada
    que ele possa fazer a respeito no meio de uma entrega.
    """
    global _gravacoes_desde_a_apara
    quando = agora_ms if agora_ms is not None else int(time.time() * 1000)
    try:
        conn = sqlite3.connect(db_path, timeout=5.0)
        try:
            with conn:
                conn.execute(
                    "INSERT INTO delivery_attempts (session_name, outcome, reason, at_ms)"
                    " VALUES (?, ?, ?, ?)",
                    (session_name, desfecho, motivo, quando),
                )
            with _guarda:
                _gravacoes_desde_a_apara += 1
                apara = _gravacoes_desde_a_apara >= APARA_A_CADA
                if apara:
                    _gravacoes_desde_a_apara = 0
            if apara:
                with conn:
                    conn.execute(
                        "DELETE FROM delivery_attempts WHERE id <= ("
                        "  SELECT MAX(id) - ? FROM delivery_attempts"
                        ")",
                        (TETO_DE_REGISTROS,),
                    )
        finally:
            conn.close()
        return True
    except sqlite3.Error as erro:
        # ERROR e não WARNING: se isto começar a falhar, o denominador para de
        # existir sem ninguém perceber — que é exatamente o buraco que a tabela
        # veio tapar.
        log.error(
            "não gravei a tentativa de entrega: session=%s desfecho=%s motivo=%s erro=%s",
            session_name,
            desfecho,
            motivo,
            erro,
        )
        return False
