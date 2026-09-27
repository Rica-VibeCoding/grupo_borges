# Fase 4 — conserto: toque demorado com a conversa parada não começa (cadeira `ui`)

Relato do Rica no iPhone, 27/09 ~20h10, build `eac75e1` na 3008: "clico na tela para iniciar a conversa e nada
acontece". Causa provável, e o erro foi do briefing `fase4-silencio-e-segurar.md`: fora de `ouvindo`, o dedo parado
≥ 500 ms vira `parado` e o soltar vira `nada` (`dedoAosQuinhentos`/`aoSoltar` em `segurar-a-vez.ts`). Um toque firme
no iPhone passa de 500 ms fácil — e antes do `eac75e1` qualquer toque sem arrasto começava.

## Regra nova (substitui a do briefing anterior)
- Só em `ouvindo` o dedo parado segura a vez.
- Em qualquer outra cena, dedo parado é **toque**, curto ou longo: parado começa, estados ativos param, erro tenta de
  novo — exatamente o `acaoDoToque` de sempre. Dedo que andou continua gesto.

## Fecha quando
- Teste vermelho antes: "cena parado, dedo 800 ms sem andar, soltar → toque" falha no código atual.
- Ajuste mínimo em `segurar-a-vez.ts` (e onde mais o `parado` aparecer), testes puros atualizados.
- `npm test` e `type-check` verdes, com números.
- E2E no dev 3009: toque de 100 ms e de 900 ms no estado parado começam; dedo 900 ms esperando o Zé para; segurar em
  `ouvindo` segue como antes. O caso `longo-fora-da-vez` do `e2e/fase4-segurar.cjs` muda de sentido: ajuste.
- Sem commit. Relato em `relatos/fase4-ui.md` (seção nova). Última linha: `FIM-DO-TOQUE-LONGO`.
