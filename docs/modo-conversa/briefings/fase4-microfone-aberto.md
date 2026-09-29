# Fase 4 — permissão de microfone pedida de novo no meio da conversa (cadeira `ui`)

Base: main `f16677e` (o clone do PC tem a voz sem commit sobre `e51a92e`, mesmo conteúdo — não resete nem stash).

## O que o Rica viu (29/09, produção 3446, iPhone)
A tela de voz pediu permissão de áudio de novo no meio da conversa.

## Causa provável (confira antes)
`use-detector-de-fala.ts`: o `pauseStream` do MicVAD dá `track.stop()` a cada vez que o agente fala, e o
`resumeStream` chama `getUserMedia` de novo ao voltar a ouvir. Cada `getUserMedia` novo pode reabrir o pedido de
permissão no iOS (no Chrome do iPhone, que é WKWebView, quase sempre). Vem da fase 1 (`5ff9759`); agora aparece
porque as respostas ficaram longas.

## Pedido
- Um `getUserMedia` por conversa. Na vez do agente, o microfone fica **surdo sem soltar**: `track.enabled = false`
  (ou detector pausado com a faixa viva); voltando a ouvir, reusa a mesma faixa se ela estiver `live`, e só pede
  outra se ela caiu (`ended`) — o caminho `capturaCaiu`/vigia continua igual.
- Meio-duplex não muda: nada do microfone entra no detector nem no canal ao vivo enquanto o agente fala.
- Fechar a tela / sair da conversa continua soltando o microfone (indicador laranja do iPhone apaga).

## Regras
- Teste vermelho antes: contar chamadas de `getUserMedia` numa conversa de 3 voltas (esperado 1; hoje 3+).
- UI se testa clicando na tela (`browser-harness`); Playwright com microfone falso para as 3 voltas com o Canário real,
  contando `getUserMedia` por `addInitScript`. Conferir no WebKit que o volume/rota do áudio do agente não muda com o
  microfone aberto (se mudar, registre no relato — não é para decidir sozinho).
- Não reinicie o dev 3009 sem parar antes. Proibido: VPS, commit, agente real além do Canário. Teto 30%.

## Fecha quando
`npm test` e `type-check` verdes, com números; relato em `relatos/fase4-ui.md` (seção nova) com a contagem antes e
depois. Última linha sozinha: `FIM-DO-MICROFONE`.
