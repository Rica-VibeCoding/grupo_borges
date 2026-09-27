# Fase 4 — itens 1 e 2: silêncio de 2 s e segurar para pensar (cadeira `ui`)

Pauta: `docs/modo-conversa/fase4-rodada-da-voz.md` §1 e §2. Leia antes, e `lib/conversa/`, `toque-da-conversa.ts`,
`use-gestos-da-conversa.ts` e `use-detector-de-fala.ts`.

## 1. Silêncio que entrega a fala: 2 s
`TEMPOS.silencioFimDeFala` 1400 → 2000 (`lib/conversa/tipos.ts`), comentário junto. Não passar de 2 s.

## 2. Segurar a tela para pensar (desenho aceito pelo Rica, não reabrir)
- Toque rápido continua parando a conversa, como hoje.
- Dedo **parado** por ≥ 500 ms segura a vez: a contagem de silêncio para enquanto o dedo estiver na tela.
- Soltar volta a contar os **2 s inteiros** a partir do soltar.
- Dedo que anda é gesto (direita → chat, cima → configurações) e não segura.
- Só vale na vez do Rica (`ouvindo`, com ou sem fala detectada). Em outro estado, dedo parado não faz nada, e o
  soltar também não vira toque.
- Retorno sem texto: mudança visual discreta na esfera/moldura enquanto segura, e som curto ao segurar (o
  `AudioContext` já destravado, `sons-locais.ts`). Sem vibração obrigatória.

## Armadilhas medidas no `@ricky0123/vad-web` 0.0.31 (`dist/frame-processor.js`)
- O fim da fala é `++redemptionCounter >= redemptionFrames` em cada quadro abaixo do `negativeSpeechThreshold`.
  Subir o `redemptionMs` durante o segurar não zera o contador: ao voltar para 2000, se o silêncio já passou disso,
  a fala **sai no primeiro quadro depois de soltar**. Esse é o defeito a provar que não acontece.
- `pause()` do MicVAD encerra ou descarta o segmento (`submitUserSpeechOnPause`). Não serve para segurar.
- `frameProcessor` é `private` no `.d.ts`; mexer nele é acoplamento com a versão. Se for o caminho, isolar num
  lugar só (o `controlador-detector.ts`), com teste e comentário apontando a versão.
- O áudio segurado inteiro vai no WAV (16 kHz, ~32 KB/s): 10 MB da rota dão ~5 min. Não precisa de teto novo.
- O clique que sobra de um dedo segurado **não pode** virar toque (parar). Hoje o `pointercancel` do pager já
  anula o clique de arrasto; o segurar precisa da mesma anulação.

## Limites
`components/conversa/` e `lib/conversa/` (com teste), tokens em `globals.css`. Não mexer em `apps/api`.
≤300 linhas por arquivo. Context7 antes de codar o que for React/Pointer Events.

## Fecha quando
- Testes puros novos: "gesto × estado → segura / toque / gesto / nada" e a regra do contador (segurar depois de
  1,5 s de silêncio, soltar: a fala só sai 2 s depois do soltar, não antes).
- `npm test` e `type-check` verdes no PC, com os números.
- E2E com o `canarinho`: falar, calar 1,5 s, segurar 4 s, soltar → a fala chega inteira como UMA mensagem ~2 s
  depois; toque rápido ainda para; arrasto ainda leva ao chat.
- Sem commit. Relato curto em `relatos/fase4-ui.md`. Última linha: `FIM-DO-SEGURAR`.
