---
name: checar-paridade
description: Rodar o checklist de equivalência do Cockpit v2 contra o painel atual antes de qualquer merge ou de virar a chave. Usar quando for integrar frente, fechar etapa ou decidir se o v2 já pode substituir o v1.
---

# checar-paridade — o v2 não perde nada do v1

## Por que existe

O v2 substitui um painel que **funciona**. Regressão silenciosa é o risco real:
tela bonita que perdeu um evento no meio do replay, ou que reordenou depois de uma
reconexão. Comparação visual pode aprovar, mas **não decide**.

## Regra que protege o resultado

**Fixture não se edita para passar no teste.** Se o v2 discorda da fixture, o v2
está errado até que se prove o contrário — e a prova é o comportamento do painel
atual, não argumento.

## Parte 1 — paridade semântica (a que barra merge)

Para os mesmos eventos gravados, o painel novo produz **o mesmo agrupamento, a mesma
ordem e o mesmo conjunto de itens**. Nenhum evento perdido, duplicado ou reordenado
após reconexão.

```bash
corepack pnpm --filter @grupo_borges/cockpit-core test   # 9 testes do pipeline
ls ../../fixtures/cockpit-v2/familias/                   # as 52 famílias
```

As duas bordas obrigatórias: `borda__content_none` (199 casos) e
`borda__content_string` (87).

Se precisar regravar contra a sessão viva:
`../../fixtures/cockpit-v2/gravar-transcripts.py` — ele consome a **mesma SSE** que o
front, de fora, sem tocar no `apps/web`.

## Parte 2 — comportamento observável (o gate)

Os 12 itens estão em `../../docs/cockpit-v2-fusao.md`. Os que reprovam com mais
frequência:

1. **Streaming não engasga** — 50 chunks/s por 60s com 1.000 mensagens no
   histórico: scroll estável, e a digitação no composer não atrasa o eco do
   caractere.
2. **Só a mensagem que streama muda na tela.** As anteriores não repintam.
3. **Quem está lendo o histórico não é arrancado dele** — mensagem nova com o
   usuário rolado para cima não move a viewport; aparece indicador.
4. **Reconexão em poucos segundos, não em 30** — bloquear a tela, trocar wifi por
   dados, desbloquear: volta a receber sozinho e mostra "reconectando".
5. **Uma superfície por vez no celular**, com o botão voltar do sistema fazendo o
   esperado.
6. **Deep-link `/agente/<slug>`** funciona e o refresh mantém o lugar.
7. **O microfone funciona** pelo hostname `.ts.net`.

⚠️ **Medido no iPhone do Rica, via Tailscale.** Não em notebook, não em emulador —
o risco nº 1 do projeto é o celular, e as medidas do ChatGPT que herdamos são de
desktop.

⚠️ **Medir contra o back da Hostinger**, onde o produto vive. Medir na máquina
folgada e virar a chave na apertada fraudaria o próprio gate.

## Parte 3 — o gate estético, que é separado

O critério do Rica é ele dizer **"amei"**. Não é o mesmo portão do numérico e não
substitui nenhum dos dois: passar no número e não arrancar o "amei" significa
continuar; arrancar o "amei" e falhar no número significa **não virar a chave**.

## Prova real: agente-canário, nunca sessão viva

Teste de envio cai por `send-keys` no trabalho de quem estiver lá. Nunca usar a
sessão do Márcio, do Dimy ou de qualquer agente produtivo.
