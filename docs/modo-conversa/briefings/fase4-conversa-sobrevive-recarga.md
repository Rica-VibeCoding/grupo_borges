# Fase 4 — a conversa sobrevive a recarga da página (cadeira `ui`)

Base: o clone do PC como está (voz sem commit sobre `e51a92e`) — não resete, não stash, não `git pull`.
Começa depois de `FIM-DO-OCUPADO`.

## O que o Rica viu (28/09)
Recarregar a página volta a tela de voz ao "parado" e perde a conversa em curso. Em produção isso não é só o dedo
dele: todo deploy na 3008 força recarga no iPhone (`deploymentId` + `StaleClientGuard`, commit `08634b4`) — publicar
qualquer coisa derruba a conversa aberta.

## Causa
`use-modo-conversa.ts`: a máquina nasce de `inicial()` em `useState`; nada da conversa fica fora da memória da aba.
O stream do agente (`useCanarioStream`, `recentes: true`) já reaparece depois da recarga — o que se perde é a
conversa da tela: "estou em conversa", de quem é a vez, a fala dele que ainda não tocou.

## Pedido
- Guardar no aparelho (`sessionStorage`, por agente) só o necessário para retomar: conversa ativa, a vez, o turno
  dele em aberto (id/ponto no stream) e as preferências já guardadas continuam onde estão.
- Depois da recarga, com conversa ativa guardada, a tela **não** abre em "parado": mostra o estado verdadeiro lido
  do stream (pensando / trabalhando / resposta pronta) com as regras de `estado-da-vez.ts`.
- iOS exige gesto para abrir microfone e tocar áudio (confira na doc — Context7/MDN — antes de desenhar). Se não
  der para retomar sozinho: **um toque** retoma — toca a resposta que ficou pendente e volta a ouvir. Diga no relato
  o que o navegador permitiu sem toque e o que não, medido.
- Resposta que chegou inteira durante a recarga não se perde nem toca duas vezes. Turno já tocado não toca de novo.
- Parar (toque de parar, sair da tela) apaga o guardado: recarga depois de parar abre em "parado", como hoje.

## Regras
- Teste vermelho antes: regra pura (retomada a partir do guardado + stream) com os casos acima; hoje não existe.
- UI se testa clicando na tela (`browser-harness`); Playwright para recarga no meio de "pensando", no meio de
  "falando" e depois de parar, com o Canário real; WebKit para o caso do gesto.
- Não reinicie o dev sem parar antes. Proibido: VPS, commit, agente real além do Canário. Teto 30%.

## Fecha quando
`npm test` e `type-check` verdes, com números; os três casos de recarga provados com o Canário real; relato em
`relatos/fase4-ui.md` (seção nova). Última linha sozinha: `FIM-DA-RECARGA`.
