# Fase 2 — conserto pós-revisão (cadeira logica)

Revisão da coordenação achou 3 defeitos em `apps/cockpit/lib/conversa/maquina.ts`. Os três são seus.
Regra da casa: para cada um, escreva ANTES o teste em `maquina.test.ts` que falha pelo motivo certo, depois conserte.
Não toque em `components/`, `tipos.ts` nem em arquivo da tela. Sem commit.

1. **Captura cai em `interrompendo` deixa a voz pausada para sempre.** `capturaCaiu` (e `falhou`) vindos de
   `interrompendo` só emitem `desligarDetector` + `avisarErro`; o reprodutor fica pausado e dono do áudio, e a
   próxima conversa trava em `falando`. Conserto: saindo de `interrompendo` para `erro`, emitir também `descartarVoz`.

2. **Interrupção confirmada com o Zé ainda transmitindo: a voz volta por cima.** `falaConfirmada` vai para `ouvindo`
   com `descartarVoz`, mas o turno do Zé continua; o próximo `textoDoZe` cai no caminho defensivo de `ouvindo`/
   `transcrevendo`, vai para `falando` e a fala do usuário se perde. Conserto: marcar `zeDescartado` (tipo interno)
   no `falaConfirmada` quando `zeAcabou` for falso, ignorar `textoDoZe` enquanto marcado e limpar a marca no
   `zeTerminou` seguinte (e em `parar`/`comecar`). O caminho defensivo continua valendo sem a marca.

3. **O `tique` desclassifica 2 s após o INÍCIO da fala, não após 2 s de silêncio.** "hmm", 1,5 s calado, "espera":
   o Silero ainda conta como um segmento (o `redemptionMs` reinicia a cada quadro de fala), mas a máquina retoma a voz
   aos 2 s e a confirmação que chega logo depois vira noop. Quem desclassifica é o Silero (`falaDescartada`); o
   `tique` fica só de rede de segurança para callback perdido. Conserto: nova constante em `TEMPOS` (ex.:
   `socorroFalaPorCima = 6000`) usada no `tique` de `interrompendo`; `desclassificaFalaPorCima` segue 2000 para a tela.

Pronto quando: `node --test apps/cockpit/lib/conversa/maquina.test.ts` verde com os 3 testes novos, `npm test` e
`npm run type-check` em `apps/cockpit` verdes. Acrescente uma seção "Conserto pós-revisão" no
`docs/modo-conversa/relatos/fase2-logica.md` e avise a coordenação respondendo PRONTO numa linha.

## Complemento (coordenação, depois do seu PRONTO)

O conserto 2 vaza: `novo()` não carrega campos extras, então `falaTerminou` (`ouvindo → transcrevendo`) e o envio
(`transcrevendo → esperandoZe`) apagam o `zeDescartado`. O resto do turno velho que chegar em `transcrevendo` vai para
`falando`; o que chegar em `esperandoZe` é tomado como resposta à fala nova, e o `zeTerminou` velho em `esperandoZe`
volta a `ouvindo` como "Zé não produziu texto".
Conserto: a marca atravessa `ouvindo → transcrevendo → esperandoZe` (e `transcricaoVazia → ouvindo`) até o `zeTerminou`
do turno velho, que em qualquer desses estados só limpa a marca e não muda o estado. `parar`/`comecar`/`erro` limpam.
Teste antes: fala confirmada com Zé transmitindo → `falaTerminou` → `transcreveu` → `textoDoZe` residual (ignorado)
→ `zeTerminou` velho (continua `esperandoZe`) → `textoDoZe` novo (vai para `falando`). Mesmas provas e PRONTO numa linha.
