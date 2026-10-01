# F15 — protótipo do Histórico novo (relato)

- Capturas 390×844 (@3x) em `C:\tmp\f15\` (PC do Rica): 1-lista, 2-leitura, 3-ocupado, 4-espera, 5-nova-vazia e 5b-gaveta (Nova conversa ao lado do Histórico).
- Montado com `pecas.tsx`, ícones, `PilulaDoAgente` e os tokens da §G, numa rota descartável já apagada. Fonte guardada em `C:\tmp\f15\fonte\`. Nada no diff.
- Uma direção. A lista é **um bloco só** com linhas de título e tempo, sem um cartão por conversa: oito itens cabem sem rolar.
- O filtro ⭐ vira só o ícone, para *Concluídas* caber sem apertar.
- A leitura mostra título, "3h atrás, 24 turnos", a nota ("Onde parou") e as últimas mensagens no desenho do chat (Rica em balão, agente em texto corrido).
- ⭐, Concluída, Renomear e 🗑 ficam numa fileira sem moldura, em cinza, logo acima do botão.
- **Continuar esta** é uma pílula clara (branco no lugar de cor). Assim ela é a coisa mais forte da tela sem criar acento novo nem usar o azul, que é só do "ligado".
- Agente ocupado: a linha "José Pavan está trabalhando" aparece **antes** do toque, e o botão já nasce âmbar: "Interromper e continuar esta". Não há passo de confirmação; um toque age.
- A espera é "Abrindo esta conversa…" mais uma barra, no lugar da fileira de ações. A leitura continua visível atrás.
- Conversa nova: "Voltar pra anterior" com o título da anterior embaixo, logo acima do composer, onde o polegar alcança. A foto não se repete.
- Olhar sobre o plano: tirar a ⚠️ de pendência da lista esconde um fato útil. Sugiro que ela volte como filtro quando existir, nunca na linha.
- A barra da espera não tem progresso real (a API não dá porcentagem). No código, ela tem de ser indeterminada.
