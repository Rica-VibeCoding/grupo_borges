# O que o composer tem de entregar

> Lista escrita em 15/08/2026 a pedido do Rica, com as palavras dele: *"eu faria
> uma lista de tudo que um composer tem que entregar em 8/2026, zeraria essa
> lista, testaria de ponta a ponta e me chamaria"*.
>
> Isto é o **contrato funcional** — o que a peça faz. A geometria (quem mede
> altura, quem posiciona, o que não se toca no iPhone) mora em
> `cockpit-v2-composer.md`, e as duas se leem juntas.

## Como esta lista se prova

```bash
python3 docs/cockpit-v2-medicao/bateria-do-composer.py
python3 docs/cockpit-v2-medicao/tela-muda-depois-do-enter.py canarinho:cc tara:codex
```

A bateria roda a tela de verdade na `:3008`, em viewport de iPhone, **nos dois
motores** (Claude Code e Codex), e cada caso vai até o fim do caminho: a
mensagem sai, chega no agente, ele responde, a resposta volta. "O campo esvaziou,
logo funcionou" não conta como prova — foi exatamente assim que 18,8 segundos de
tela muda passaram meses despercebidos.

A segunda bancada existe porque **um requisito sem número não é requisito**: ela
cronometra o intervalo entre o Enter e a bolha aparecer, com o agente ocioso e
com o agente ocupado.

## A lista

### Entrada de texto

1. A caixa cresce com o conteúdo e encolhe ao apagar.
2. A caixa tem teto e rola por dentro — texto longo não empurra a tela.
3. Fonte de 16px ou mais. Abaixo disso o Safari do iPhone dá zoom no foco e
   desloca tudo.
4. Aceita colar texto muito longo sem perder caractere.
5. Aceita acento, emoji e caractere especial sem escapar nada pelo caminho.

### Acentuação (o que quebra em português e não em inglês)

6. Enter no meio de uma composição de acento **não envia**. Segurar a tecla no
   teclado do iPhone para escolher "ã"/"ç" abre uma sessão de composição, e o
   Enter que confirma a escolha chegava como Enter comum: "não" e "ação"
   mandavam a mensagem pela metade.
7. A guarda cobre as **duas bordas** do IME. `isComposing` vale `false` no
   primeiro e no último caractere da composição (MDN); o `keyCode === 229` é o
   que fecha o buraco, e é normativo no W3C UI Events §7.2.1.

### Envio

8. O campo esvazia no aceite, não no retorno da rede — senão um segundo Enter
   durante a viagem duplica a mensagem.
9. **Nada evapora.** Recusa devolve o texto e diz o motivo; nenhum caminho
   descarta o que a pessoa escreveu.
10. Toda recusa com gesto na mão tem recado. Borda vermelha sem palavra é a
    queixa literal do Rica: *"desloca, fica vermelho, mas não fala o que
    acontece, nunca vi isso em nenhum chat"*.
11. **A mensagem vira bolha na tela em até 2 segundos.** É o item que estava
    reprovado e ninguém tinha medido — ver a seção "O que já custou caro".
12. A mensagem chega no agente de verdade, e a resposta dele volta para a tela.

### Mandar enquanto ele ainda responde (double-texting)

13. Escrever durante o turno anterior **não é bloqueado**. A mensagem entra na
    fila e sai sozinha quando liberar — é a estratégia `enqueue` do LangGraph
    ("allows the current run to finish before processing any new input").
14. O que está na fila aparece à vista, com o texto inteiro, e dá para trazer de
    volta ao campo — cancelar e editar são o mesmo gesto.
15. A fila drena sozinha, sem segundo toque.

### Parar

16. Existe um botão de parar enquanto o agente gera, nos dois motores. Parar é
    recurso de primeira classe — o ChatGPT documenta até atalho dedicado
    (`Command + .`).
17. Ele **aparece no tempo do turno**, não no tempo do painel.
18. Ele **some no toque**, não quando o servidor concorda.
19. Ele **não cobre o envio**: com texto escrito, o alvo é mandar. Copiar a troca
    seta→quadrado ao pé da letra criou um beco no celular — sem gesto nenhum para
    despachar, porque o Enter do teclado virtual quebra linha e não há Shift.
20. O campo continua editável durante a geração.

### Anexo

21. O `+` existe, abre a gaveta e a foto escolhida vira miniatura.
22. Dá para remover a foto antes de enviar.
23. O `+` continua clicável **enquanto a anterior processa** — escolher arquivo é
    gesto local, nada sobe até o envio.
24. Colar imagem do clipboard anexa a foto.
25. Um gesto, uma entrega: o arquivo sobe com o texto como legenda, no mesmo
    multipart.

### Celular

26. Com o teclado de pé, o composer continua na tela e a última mensagem não
    morre atrás dele.
27. Nenhum aviso que exija leitura mora **abaixo** do composer: ali o teclado o
    esconde, e o Rica lê como "engoliu a mensagem".
28. Alvo de toque de 44px nos controles da base.
29. O rascunho não enviado sobrevive ao reload — puxar a tela para recarregar é
    gesto acidental no iPhone.

### Voz

30. Segurar para falar, com trava para gravação longa.
31. A transcrição volta para a tela antes de virar mensagem — STT erra, e
    descobrir isso pela resposta errada do agente três minutos depois é caro.
32. **Pendente:** o microfone fica desabilitado enquanto o envio anterior está em
    trânsito. É parente do defeito do `+` do item 23 — gravar é gesto local — e
    no Codex esse trânsito chega a minutos, o que dói mais aqui do que ali,
    porque o Rica fala muito mais do que digita.

    Não foi consertado junto com o `+`, e o motivo é diferença de risco, não
    esquecimento: escolher arquivo não toca a máquina de envio, enquanto soltar o
    microfone dispara `enviarVoz` na **mesma** máquina de seis fases que já está
    ocupada com o envio anterior. Habilitar sem antes decidir o que acontece com
    duas entregas concorrentes trocaria um botão morto por um estado ambíguo.
    Precisa de rodada própria.

33. **Pendente:** a bolha otimista da voz só é registrada para o Codex
    (`composer.tsx`, dentro de `subirAudio`), mesmo depois de o texto passar a
    registrá-la nos dois motores. Fica junto do item 32: casar a marca de voz
    com o que o stream do Claude Code grava é o que precisa ser conferido antes,
    e sem essa conferência a pendência ficaria sem par até o teto.

### Fila que atravessa canais — **o próximo alvo grande, ainda aberto**

34. **Reprovado hoje, e é o que sobra de maior.** A fila do composer só conhece o
    envio em voo **daquela aba**. A conversa da Tara é compartilhada com o
    Telegram: turno aberto por outro canal, por outra aba, ou por um envio que a
    aba recém-carregada não viu passa direto pela porta, e o backend recusa com
    `409 shared_turn_in_flight` (`apps/api/routers/agents.py`, `send_agent_input`).
    A tela então vai para `falhou` e oferece "Tentar de novo".

    É o cenário comum do Rica: falar com a Tara pelo Telegram e depois abrir o
    cockpit. A mensagem não se perde — mas ela **deveria entrar na fila**, que já
    existe e já drena sozinha, em vez de virar erro que pede gesto novo.
    Desenho proposto: o `catch` de `usa-envio.ts` distinguir o 409 de turno
    concorrente dos demais erros HTTP e devolver isso ao composer, que reenfileira
    em vez de publicar `falhar`. Não entrou em 15/08 por escolha de risco — mexer
    na máquina de seis fases com o Rica a caminho da tela, no fim de um dia com
    quatro publicações, troca um defeito conhecido por um desconhecido.

    Medido: 2 ocorrências na bateria de 15/08, ambas com o teste já isolando as
    categorias — ou seja, não é artefato de instrumento.

### Acessibilidade

35. Botão de enviar com nome acessível.
36. Existe região viva anunciando mudança de estado.
37. Alvo de toque conforme WCAG 2.2 §2.5.8.
38. **Agente offline não oferece freio.** O `■` lia só `lifecycle_status`, que é
    histórico de evento e não expira quando o agente morre sem despedida: cinco
    dos nove da frota apareciam como `trabalhando` sem processo nenhum, e o toque
    devolvia `200` com `parado: false` calado. A guarda é o `status` do mesmo
    payload, que cruza sessão e processo.

## O que já custou caro (para não repetir)

**Premissa escrita como fato.** Estava em dois arquivos que *"no Claude Code o
eco volta pelo stream em milissegundos"*. Nunca foi medido. São **18,9 s**. Essa
frase sozinha custou: a bolha otimista não ligada neste ramo, um prazo de alarme
calibrado errado, e três sintomas que o Rica reportou como um só.

**Número calibrado sobre a amostra errada.** `PRAZO_ECO_MS = 12_000` saiu de uma
amostra local de 30/07 com pior caso de 1,434 s. No caminho real o eco leva
18,9 s — o prazo estourava antes da confirmação e **toda** mensagem para agente
ocioso terminava dizendo "não consegui confirmar se entrou". Falso, e é o que
pausava a fila e pendurava a mensagem seguinte em vermelho.

**Sinal de painel usado como sinal de turno.** O `■` nasceu lendo
`lifecycle_status`, alimentado por hook e por vigia de JSONL, que chega no tempo
do painel. Medido: **o botão não apareceu na tela em 100 segundos**, enquanto o
"Pensando há 2 s" — que lê outra fonte, na mesma tela — afirmava o contrário.

**Medidor com `except` largo mente calado, e mentiu aqui.** A primeira apuração
daquele caso concluiu que o `lifecycle_status` não acendia; a função que
"provou" isso lia `/api/fleet` como lista quando a rota devolve
`{agents: [...]}`, e o `except Exception` devolvia `null` em toda amostra. Com o
parser certo o campo acende. O defeito na tela era o mesmo; a causa que se
escreveu primeiro, não. Prova negativa exige olhar o instrumento antes da
conclusão.

**Teste que não isola acusa o produto por concorrência que ele mesmo criou.**
Três vezes num dia: o `■` do Codex, o B2 da régua do Daniel, e as categorias da
bateria mandando mensagem em sequência sem esperar o agente sossegar — que
rendeu um `input_nao_observavel` e um `shared_turn_in_flight`, os dois lidos como
falha do composer. Categoria que envia espera o agente ficar ocioso antes de
medir.

**Duas armadilhas de bancada mobile que queimaram medições em 15/08.** As duas
produziram números plausíveis, que é o que as torna caras:

- **Apertar Enter não envia em viewport mobile.** Com `pointer: coarse` o Enter
  quebra linha por desenho (`usaTecladoTouch`). Duas rodadas deram "■ nunca em
  60 s" sem que um único POST tivesse saído do browser. Em bancada mobile,
  **clicar o botão**, nunca apertar Enter.
- **Localizador largo pega o elemento errado.** Procurar o texto da mensagem em
  qualquer elemento-folha casa com o conteúdo de dentro do próprio `textarea` —
  virou "bolha em 0,06 s" de uma bolha que não existia. Mesmo erro de contar
  `img` na página inteira em vez de dentro de `.ck-miniatura`: o localizador
  precisa excluir o `form` do composer.

**Pane sujo reprova conserto bom.** A prova do freio deu "■ nunca em 60 s" numa
rodada e passou na seguinte, sem mudança de código: o pane do agente tinha texto
**armado** de um envio anterior, e o driver recusa colar em campo ocupado. Antes
de acusar a mudança, olhar o estado do alvo.

**Pesquisa que não vira régua de teste não protege ninguém.**
`docs/chat-patterns-research.md` já listava a atualização otimista como TOP 1,
com a frase exata do conserto: *"input limpa na hora, bubble aparece na hora"*,
complexidade baixa, ROI alto. Foi feita e ficou na gaveta.

## Fontes

- Double-texting e a estratégia `enqueue` —
  [docs.langchain.com/langgraph-platform/double-texting](https://docs.langchain.com/langgraph-platform/double-texting)
- Limites de tempo de resposta (0,1 s · 1 s · 10 s) —
  [nngroup.com/articles/response-times-3-important-limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
- Atualização otimista em chat, com estado `pending`/`error` na mensagem —
  `docs/chat-patterns-research.md` §2, e `useOptimistic` do React 19
- Parar geração como recurso de primeira classe —
  [help.openai.com/en/articles/9703738](https://help.openai.com/en/articles/9703738)
- Rascunho salvo automaticamente — Slack e
  [core.telegram.org/api/drafts](https://core.telegram.org/api/drafts)
- IME e `keyCode 229` — MDN `KeyboardEvent.isComposing` e W3C UI Events §7.2.1
- Alvo de toque — WCAG 2.2, critério 2.5.8
