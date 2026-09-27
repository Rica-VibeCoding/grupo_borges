# Fase 1 — relato da trilha LÓGICA

Cadeira `logica` · 26/09/2026 · sem commit, conforme o briefing.

## O que foi feito

- `apps/cockpit/lib/conversa/maquina.ts` — `inicial()` e `avanca` (tipo `Avanca` do contrato).
  Pura: sem timer, sem fetch, sem DOM; o relógio entra por `agora`.
- `apps/cockpit/lib/conversa/maquina.test.ts` — 18 testes com `node:test`, no estilo dos
  `lib/*.test.ts`. Escrito junto com o código (teste antes de virar o comportamento).

## Saída dos testes

```
node --test apps/cockpit/lib/conversa/maquina.test.ts
# tests 18 · pass 18 · fail 0
```

`tsc --noEmit` nos dois arquivos: limpo.

## Decisões (as que valem nota)

- **Detector ligado só em `ouvindo`** — desligo já no `falaTerminou`, e não só ao entrar em
  `falando` como o contrato literal pede. Motivo: a frase-ponte e o aviso de demora tocam em
  `esperandoZe`; se o detector continuasse ouvindo ali, ele capturaria o eco da própria página
  (Chrome não cancela, pesquisa §3). Desligar mais cedo não quebra a regra do contrato — ela
  fala do mínimo em `falando` — e elimina o eco de graça.
- **`tocarTique` sai junto com `enviar`** (no `transcreveu`), não no `enviou`. O tique é o
  "ouvi você, mandando" imediato; a espera (relógio) só começa quando `enviou` confirmar.
- **`transcrevendo` também cobre o envio.** O contrato não tem estado `enviando`; entre o
  `transcreveu` e o `enviou` a conversa segue em `transcrevendo`. Sem impacto na tela.
- **Saídas de erro:**
  - `transcricaoVazia` → volta a `ouvindo` **sem** `avisarErro` (não é erro, só não havia o que
    enviar). Vale também para `transcreveu` com texto vazio/em branco.
  - todos os outros motivos → `erro` + `desligarDetector` + `avisarErro` (aviso toca com o
    detector já desligado, sem eco).
  - sair de `erro`: `comecar` recomeça limpo (apaga o `motivo`); `parar` volta a `parado`.
- **`comecar` é idempotente**: só age em `parado` e `erro`. Repetido em qualquer estado ativo
  não produz efeito nenhum (a regressão da fase 0, 4 toques = 4 detectores, fica impedida na
  máquina).
- **`falando` só sai quando `zeTerminou` E `vozTerminou` chegaram** — dois flags internos. A
  ordem não importa (a voz pode esvaziar antes do stream cair, e vice-versa); sem isso, um
  chunk atrasado do Zé cairia no meio do `ouvindo`.
  - **Revisão da coordenação (26/09):** corrigido um furo nessa regra. `textoDoZe` chegando em
    `falando` agora **zera `vozAcabou`**, porque a voz nova entra na fila. Antes, o cenário
    *texto 1 → voz do 1 termina → texto 2 → `zeTerminou`* religava o detector em `ouvindo` com
    a voz do texto 2 ainda tocando (eco). Teste de regressão incluído; suíte em 19/19.

## Furos / observações no contrato

- O campo `detalhe` do evento `falhou` não tem como chegar à tela: nem `Conversa` nem o efeito
  `avisarErro` o carregam. Sem perda real (quem disparou o evento já tem o detalhe), mas quem
  for desenhar a mensagem de erro não deve esperar o detalhe de volta.
- Não existe efeito de "parar tudo" (Wake Lock, TTS). Tratei `parado` como teardown implícito:
  a máquina só emite `desligarDetector` quando o detector está ligado (saindo de `ouvindo`), e
  a tela reage ao `estado === 'parado'` para soltar o resto.
- Assunção: a tela sempre emite `zeTerminou` (`isRunning` cai) e `vozTerminou` (fila vazia).
  Se um dos dois nunca vier, `falando` não sai. Confio no contrato; a tela não deve engolir
  nenhum dos dois.

## Dúvida para a coordenação

- O glob do `package.json` (`npm test`) **não** cobre `lib/conversa/*.test.ts`. O plano já
  aponta isso ("incluir `lib/conversa/*.test.ts`"), mas é o dono do lockfile (`tela`) que mexe
  no `package.json`. Fica a cargo dela incluir, senão os testes não rodam no `npm test` geral.
