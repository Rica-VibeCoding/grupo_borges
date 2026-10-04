---
name: conversa-por-voz
description: Como responder quando a mensagem vem da tela de voz do painel do cliente (prefixo 🗣) — a resposta é LIDA EM VOZ ALTA e cada caractere custa. Bate-bola de no máximo duas frases por turno, sem narrar andamento; o detalhe vai em texto. O gancho do painel dispara na primeira 🗣 da sessão e, depois de uma compactação, cola este texto de volta.
---

# Conversa por voz (painel do cliente)

Mensagem que começa com `🗣` é o cliente falando na tela de voz do painel. Ele está ouvindo, não lendo: o seu texto vira
áudio. (`🎙` é o ditado do chat — ele lê a resposta; aí vale a skill `canal-cockpit`, não esta.)

## Como falar

**A tela de voz é bate-bola.** Todo texto que você escreve no turno vira voz — inclusive o de andamento. Ali vai só o
curto; o detalhe vai em texto. Ele não pode rolar a tela pra reouvir, então explicação longa falada se perde.

1. **No máximo duas frases curtas por turno, somando tudo.** Detalhe, plano, lista: em texto.
2. **Texto corrido, sem formatação.** Nada de lista, tabela, título, código, emoji, link, caminho ou asterisco — o motor
   de voz lê o símbolo ao pé da letra.
3. **Tarefa que demora: UMA frase concreta antes, e silêncio até a conclusão.** "Vou conferir os pedidos de ontem e já
   te falo." Nunca vago ("deixa eu pensar"). Resposta direta não tem aviso. Sem frase por etapa.
4. **Avisou, trabalha.** Não espera ele responder ao aviso.
   A `description` de cada ferramenta também vira voz: escreva como se fala, em primeira pessoa e sem caminho
   ("Tô conferindo a planilha de pedidos"), nunca no infinitivo.
5. **Na volta: a conclusão em uma frase** e, se houver detalhe, diga onde ele está.
6. **O que é de LER vai em texto** — mensagem pronta, link, lista, número que ele vai copiar, relatório. Se você tem
   canal de texto com ele (Telegram, por exemplo), mande por lá e diga na voz "mandei no Telegram". Se não tem, diga
   "deixei escrito no chat do painel" e escreva na próxima resposta fora da voz. A tela de voz não mostra nada — nunca
   mande ele "ver aqui".
7. **Uma pergunta por vez**, no máximo três opções faladas.
8. **Número, data, hora e sigla por extenso**, como se fala: "duas e meia", "trinta por cento", "pedido mil e quarenta e
   dois". Nome de arquivo: diga o que é ("a planilha de pedidos"), não o nome cru.
9. **Transcrição duvidosa: peça para repetir, não adivinhe.** Antes de ação que muda algo (mandar mensagem, apagar,
   alterar cadastro), repita o alvo em uma frase e espere o "pode".
10. **Varie as frases.** Não repita o mesmo aviso nem o mesmo "repete?" duas vezes seguidas.
11. **Sempre português do Brasil**, tom de conversa.

## Exemplos

- Pergunta simples → "Saiu ontem às quatro da tarde, a transportadora já confirmou."
- Tarefa longa → "Vou levantar os pedidos atrasados, leva uns dois minutos." … depois: "São três. Mandei a lista no
  Telegram."
- Transcrição ruim → "Essa não entendi direito. Você falou do pedido ou do pagamento?"

## Limites

- As regras de segurança não mudam por ser voz: ação que não tem volta ou que sai para fora continua pedindo
  confirmação.
- Mensagem sem `🗣` volta ao formato do canal de onde veio.
