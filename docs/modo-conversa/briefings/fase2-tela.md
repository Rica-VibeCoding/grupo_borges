# Fase 2 — trilha TELA (cadeira `tela`)

Leia antes: `AGENTS.md` do repo, `apps/cockpit/CLAUDE.md`, o plano `docs/cockpit-v2-modo-conversa-PLANO.md` (§ Fase 2, decisões 3 e 5, riscos), o relato da fase 1 `docs/modo-conversa/relatos/fase1-tela.md` e o contrato `apps/cockpit/lib/conversa/tipos.ts` (estendido agora: `interrompendo`, `falaConfirmada`, `fone`, `pausarVoz`/`retomarVoz`/`descartarVoz`, dois tempos novos). O código da fase 1 está em `apps/cockpit/components/conversa/` e `app/conversa/[slug]/`.

## O que entregar
1. **Esfera** no lugar da onda: reage ao volume de quem fala (o Rica pelo microfone, o Zé pela voz tocando). Sem cor fora de `globals.css`. Respeitar `prefers-reduced-motion`.
2. **Chave "estou de fone"** visível na tela, despachando `{tipo:'fone', ligado}`. Default desligada.
3. **Fala por cima**, só com a chave ligada: detector ligado em `falando` com `minSpeechMs = TEMPOS.confirmaFalaPorCima`; `onSpeechStart` → `falaIniciou`, `onSpeechRealStart` → `falaConfirmada`, misfire → `falaDescartada`. Executar `pausarVoz` / `retomarVoz` (de onde parou) / `descartarVoz` (a fila inteira do Zé sai, inclusive o que ainda não tocou).
4. **Toque mínimo em `components/feed/reprodutor-unico.ts`** se precisar limpar a fila — arquivo de outro dono: menor diff possível, e liste no relato o que mudou e por quê.

## A máquina
É da cadeira `logica`, sendo estendida EM PARALELO no mesmo clone. Não escreva em `lib/conversa/`. O `type-check` fica vermelho até ela terminar; os seus testes rodam antes disso.

## Fecha quando
- `npm test` e `npm run type-check` verdes (depois da lógica).
- No navegador de teste, com áudio injetado como no E2E da fase 1 e o alvo `canarinho` (nenhum outro): (a) sem fone, nada muda; (b) com fone, uma fala longa por cima da voz do Zé pausa, descarta e vira mensagem; (c) um ruído curto (~200 ms) por cima pausa e a voz retoma de onde parou.
- Relato novo em `docs/modo-conversa/relatos/fase2-tela.md` com provas e tempos. Sem commit.
- Se enxergar furo no contrato ou aqui, o seu caminho vale — escreva no relato.
