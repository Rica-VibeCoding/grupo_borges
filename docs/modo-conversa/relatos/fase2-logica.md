# Fase 2 — relato da trilha LÓGICA

Cadeira `logica` · 27/09/2026 · sem commit, conforme o briefing.

## O que foi feito

- `apps/cockpit/lib/conversa/maquina.ts` — fala por cima completa: estado `interrompendo`,
  evento `fone`, `falaIniciou`/`falaDescartada`/`falaConfirmada` com comportamento real,
  efeitos `pausarVoz`/`retomarVoz`/`descartarVoz`. Pura como antes; relógio pelo `tique`.
- `apps/cockpit/lib/conversa/maquina.test.ts` — +12 testes (19 → 31), cobrindo cada regra do
  briefing, incluindo as duas regressões abaixo.

## Saída dos testes

```
node --test apps/cockpit/lib/conversa/maquina.test.ts
# tests 31 · pass 31 · fail 0
```

`tsc --noEmit` no projeto inteiro: limpo (o type-check vermelho era só o switch não-exaustivo
do `maquina.ts`; com os dois eventos novos tratados, fechou).

## Decisões (as que valem nota)

- **`fone` mora no tipo interno, não no contrato.** O briefing pede "guardar a chave na
  `Conversa`", mas proíbe tocar `tipos.ts`. Guardei em `ConversaInterna` (tipo local da
  máquina) e preservo a chave em **toda** transição — ela atravessa `parar`/`erro` e
  `comecar`. A tela é a fonte da chave e não precisa ler de volta; se um dia precisar, o
  contrato tem que ganhar o campo (passa pela coordenação).
- **Detector ligado em `falando` e `interrompendo` só quando `fone === true`.** Sem fone,
  meio-duplex intacto (nenhum teste antigo mudou de saída). Com fone, `textoDoZe` entra em
  `falando` com `ligarDetector` em vez de `desligarDetector`. `parar` também desliga o
  detector nesses estados acesos (antes só desligava saindo de `ouvindo`).
- **`textoDoZe` em `interrompendo` = enfileirar sem tocar.** Emite `falar` normal (a tela,
  pausada, só enfileira); confirmando, o `descartarVoz` limpa a fila inteira — desclassificando,
  o `retomarVoz` toca o que ficou. Nada se perde, e nenhum efeito novo foi preciso.
- **`retomarVoz` sempre equilibra o `pausarVoz`.** Ao sair de `interrompendo` (tosse, timeout
  ou desligar fone), a máquina **sempre** emite `retomarVoz` — mesmo quando `zeTerminou` e
  `vozTerminou` já vieram durante a pausa; nesse caso vai direto a `ouvindo` (sem ficar em
  `falando` com fila vazia). A tela nunca fica presa num reprodutor pausado sem o retorno.
- **`confirmaFalaPorCima` (500) fica sem uso na máquina.** É o `minSpeechMs` do Silero, da
  tela; a máquina só reage ao `falaConfirmada`. O `desclassificaFalaPorCima` (2000) é usado no
  `tique` como backstop.

## Regressões corrigidas (durante a fase)

- **`falaIniciou` zerava `zeAcabou`/`vozAcabou`** — apontado pela `tela`. Entrar em
  `interrompendo` preservava só `fone` e `interrompeuEm`; se o stream caísse antes da pausa
  curta, o retomar perdia o flag e `vozTerminou` sozinho nunca voltava a `ouvindo`. Agora a
  transição carrega os dois flags + teste dedicado.
- **`pausarVoz` sem `retomarVoz` deixava o reprodutor pausado** (caso "Zé e voz terminam
  durante a pausa"). Corrigido fazendo `saiDeInterrompendo` sempre desfazer a pausa.

## Furos / observações no contrato

- **Desclassificação em duas camadas:** a máquina desclassifica no `tique` (2 s) e o Silero da
  tela também, via `redemptionMs=2000` → `falaDescartada`. Os dois chegam ao mesmo destino
  (`falando` + `retomarVoz`) e a segunda chegada é noop — idempotente de graça, mas a tela pode
  confiar só no Silero e o `tique` fica de backstop.
- **`fone` desligado no meio de `interrompendo`** volta a `falando` + `retomarVoz` +
  `desligarDetector` (a fala por cima morre junto com a chave). Caso raro, mas definido e testado.
- O campo `fone` não aparece em `Conversa` (contrato). Se a tela quiser desenhar o estado "de
  fone" a partir da conversa — e não da chave que ela mesma mandou — o contrato precisa expor.

## Nota para a tela

`retomarVoz` pode vir logo seguido de `ligarDetector` (Zé e voz acabaram na pausa): a tela
despausa e já está em `ouvindo`. E `falar` em `interrompendo` deve **enfileirar sem tocar**
(reprodutor pausado) — o `descartarVoz` joga a fila fora; o `retomarVoz` toca o que ficou.

## Conserto pós-revisão

Revisão da coordenação apontou 3 defeitos. Teste antes do conserto, um por defeito; os 4
falhavam pelo motivo certo, depois ficaram verdes.

- **Captura cai em `interrompendo`** — `capturaCaiu`/`falhou` saindo de `interrompendo` agora
  emitem `descartarVoz` (na frente de `desligarDetector` + `avisarErro`), liberando o reprodutor
  que tinha ficado pausado e dono do áudio.
- **Voz voltando por cima após confirmação** — `falaConfirmada` marca `zeDescartado` (tipo
  interno) quando `zeAcabou` é falso; `textoDoZe` é ignorado enquanto marcado; a marca limpa no
  `zeTerminou` seguinte (e cai sozinha em `parar`/`comecar`, que zeram a memória). O caminho
  defensivo de `ouvindo`/`transcrevendo` segue valendo sem a marca.
- **`tique` desclassificava aos 2 s do início** — agora o `tique` em `interrompendo` usa
  `socorroFalaPorCima` (6 s) só como rede de segurança para callback perdido; quem desclassifica
  de verdade é o `falaDescartada` do Silero. `desclassificaFalaPorCima` (2 s) segue intocado
  para a tela.

**Toquei `tipos.ts`** — única mudança: a constante `socorroFalaPorCima: 6_000` em `TEMPOS`,
autorizada pela linha 21 do briefing do conserto (a regra "não toque tipos.ts" era a geral; a
específica mandou a constante em `TEMPOS`).

**Complemento da coordenação (vazamento do `zeDescartado`):** `novo()` não carrega campos extras
além de `fone`, então a marca morria em `falaTerminou` e `enviou`. Ajustei a marca para atravessar
o percurso da fala do usuário — `falaTerminou` (→ `transcrevendo`), `enviou` (→ `esperandoZe`) e
`transcricaoVazia` (→ `ouvindo`, pelos dois caminhos) — via `extra`. E o `zeTerminou` agora checa a
marca **antes** do estado: se o turno foi descartado, só limpa a marca e não muda o estado (antes,
o `zeTerminou` velho em `esperandoZe` voltava a `ouvindo` como "Zé não produziu texto"). `parar`/
`comecar`/`erro` seguem limpando por `novo()` zerar a memória.

Saída: `node --test lib/conversa/*.test.ts` **37/37**, `npm test` **977/977**, `tsc --noEmit`
limpo.
