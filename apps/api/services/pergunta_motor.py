"""Detector puro da pergunta "trocar mesmo?" que o Claude Code abre na troca
de modelo ou de esforço.

Medido no CC 2.1.283 em 27/09/2026, numa sessão descartável fora da frota
(fixtures em `tests/fixtures/pergunta_motor/`). O mesmo componente serve os
dois casos, e a forma na tela é esta — o modal é SEMPRE o fim do pane, nada
é desenhado abaixo dele (nem a statusline):

       Switch model?                      |  Change effort level?
       Your next response will be slower and use more tokens
       This conversation is cached for the current model. Switching to ...
       ❯ 1. Yes, switch to Haiku 4.5      |  ❯ 1. Yes, switch to medium
         2. No, go back

- Aparece com o agente OCIOSO também: basta a conversa ter cache no modelo
  (ou esforço) atual. Sessão sem turno no modelo atual troca sem perguntar.
- Nasce com o foco em "1. Yes". `Down`/`Up` movem o `❯`; `Enter` escolhe o
  que está em foco; `Esc` cancela ("Kept model as X" / "Kept effort level as X").
- O dígito escolhe DIRETO, sem Enter e sem depender do foco: `1` aceita mesmo
  com o foco em "No"; `2` cancela.
- O destino do modelo vem no nome de exibição ("Haiku 4.5", "Sonnet 5"); o do
  esforço vem cru ("medium").

Sem I/O aqui: quem captura o pane e quem aperta tecla são os chamadores.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Literal

TipoPergunta = Literal["modelo", "esforco"]
OpcaoEmFoco = Literal["sim", "nao"]

_TITULOS: dict[str, TipoPergunta] = {
    "Switch model?": "modelo",
    "Change effort level?": "esforco",
}
_CURSOR = r"[❯>›]"
_TITULO = re.compile(r"^\s*(Switch model\?|Change effort level\?)\s*$")
_SIM = re.compile(rf"^\s*(?P<foco>{_CURSOR})?\s*1\.\s+Yes, switch to (?P<destino>.+?)\s*$")
_NAO = re.compile(rf"^\s*(?P<foco>{_CURSOR})?\s*2\.\s+No, go back\s*$")
# Título, subtítulo e o corpo (que pode quebrar em várias linhas em pane
# estreito) cabem com folga; mais que isso é outro texto, não este modal.
_MAX_LINHAS_ENTRE_TITULO_E_OPCOES = 12

#: A tecla que escolhe cada resposta. Dígito e não Enter: escolhe sem depender
#: do foco, e se o modal sumir entre a leitura e a tecla, o que sobra é um "1"
#: visível na caixa — nunca um Enter que submete o que estiver armado nela.
TECLA_DA_RESPOSTA: dict[OpcaoEmFoco, str] = {"sim": "1", "nao": "2"}


@dataclass(frozen=True)
class PerguntaMotor:
    tipo: TipoPergunta
    #: Como o CC escreve: "Haiku 4.5" no modelo, "medium" no esforço.
    destino: str
    opcao_em_foco: OpcaoEmFoco | None

    def como_dict(self) -> dict[str, str | None]:
        return asdict(self)


def detecta_pergunta_motor(texto: str | None) -> PerguntaMotor | None:
    """Devolve a pergunta aberta no FIM do pane, ou None.

    Só vale o modal que é a última coisa na tela: "2. No, go back" tem de ser
    a última linha não vazia, com "1. Yes, switch to X" logo acima e o título
    pouco antes. Texto igual mais acima (transcrito, colado, citado numa
    conversa) não conta — responder a uma pergunta que não está aberta é
    mandar tecla solta para o agente.
    """
    if not texto:
        return None
    linhas = [linha for linha in texto.splitlines() if linha.strip()]
    if len(linhas) < 3:
        return None
    nao = _NAO.match(linhas[-1])
    sim = _SIM.match(linhas[-2])
    if nao is None or sim is None:
        return None
    inicio = max(0, len(linhas) - 2 - _MAX_LINHAS_ENTRE_TITULO_E_OPCOES)
    tipo: TipoPergunta | None = None
    for linha in reversed(linhas[inicio:-2]):
        titulo = _TITULO.match(linha)
        if titulo is not None:
            tipo = _TITULOS[titulo.group(1)]
            break
    if tipo is None:
        return None
    foco: OpcaoEmFoco | None = None
    if sim.group("foco"):
        foco = "sim"
    elif nao.group("foco"):
        foco = "nao"
    return PerguntaMotor(tipo=tipo, destino=sim.group("destino"), opcao_em_foco=foco)


def destino_do_modelo(destino: str) -> str | None:
    """"Haiku 4.5" -> "haiku"; "Opus 4.8 (1M context)" -> "opus". None fora da
    família conhecida — nesse caso ninguém responde por ele."""
    primeira = destino.strip().split(" ", 1)[0].lower()
    return primeira if primeira in {"fable", "opus", "sonnet", "haiku"} else None


def pergunta_e_do_pedido(pergunta: PerguntaMotor, tipo: TipoPergunta, alvo: str) -> bool:
    """A pergunta na tela é EXATAMENTE a do pedido: mesmo tipo, mesmo destino."""
    if pergunta.tipo != tipo:
        return False
    if tipo == "modelo":
        return destino_do_modelo(pergunta.destino) == alvo
    return pergunta.destino.strip().lower() == alvo
