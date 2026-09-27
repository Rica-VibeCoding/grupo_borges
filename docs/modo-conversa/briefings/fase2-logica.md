# Fase 2 — trilha LÓGICA (cadeira `logica`)

Plano: `docs/cockpit-v2-modo-conversa-PLANO.md` § Fase 2 e decisão 3. Contrato ESTENDIDO pela coordenação em `apps/cockpit/lib/conversa/tipos.ts` (leia o diff: `git log -p -1 -- apps/cockpit/lib/conversa/tipos.ts`). O `type-check` está vermelho de propósito até a máquina cobrir os tipos novos.

## O que entregar em `lib/conversa/maquina.ts` (+ testes, antes do código)
- Evento `fone {ligado}` guarda a chave na `Conversa` (vale em qualquer estado, inclusive `parado`).
- **Sem fone, nada muda**: meio-duplex exatamente como hoje.
- **Com fone**: em `falando` o detector fica LIGADO. `falaIniciou` em `falando` → `interrompendo` + `pausarVoz`.
  - `falaConfirmada` em `interrompendo` → `descartarVoz` e segue como fala normal: `falaTerminou` depois leva a `transcrevendo` como sempre.
  - `falaDescartada` em `interrompendo`, OU `TEMPOS.desclassificaFalaPorCima` sem confirmar (relógio pelo `tique`) → volta a `falando` + `retomarVoz`.
  - `textoDoZe` chegando em `interrompendo` não pode se perder: decida (enfileirar sem tocar? descartar se confirmar?) e teste.
  - `zeTerminou`/`vozTerminou` em `interrompendo`: a regra "sai de falando só com os dois" continua valendo depois do retomar.
- Ligar o fone no meio de `falando` e desligar no meio de `interrompendo`: defina e teste.
- `TEMPOS.confirmaFalaPorCima` (500) é o que a tela passa como `minSpeechMs` no Silero durante `falando` — a máquina só reage ao `falaConfirmada`.

## Regras
- Só `apps/cockpit/lib/conversa/maquina.ts` e `maquina.test.ts`. Mudar `tipos.ts`: pare e escreva no relato.
- A cadeira `tela` trabalha no MESMO clone agora, em paralelo.
- `node --test apps/cockpit/lib/conversa/*.test.ts` verde. Relato novo em `docs/modo-conversa/relatos/fase2-logica.md`. Sem commit.
- Se enxergar furo, o seu caminho vale — escreva no relato.
