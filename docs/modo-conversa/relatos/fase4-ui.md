# Fase 4 — cadeira `ui`: silêncio de 2 s e segurar para pensar

Briefing: `briefings/fase4-silencio-e-segurar.md`. Tudo no PC, sem commit.

## Entreguei

- **Item 1 — silêncio de 2 s.** `TEMPOS.silencioFimDeFala` 1400 → 2000 (`lib/conversa/tipos.ts`), com o porquê e
  o teto de 2 s no comentário.
- **Item 2 — segurar a tela para pensar**, no desenho aceito:
  - `segurar-a-vez.ts` (novo, puro): a história do dedo — `rapido` / `andou` / `parado` / `segurando` — e o que o
    soltar faz (`solta`, `toque`, `configuracoes`, `nada`). Só `ouvindo` segura.
  - `use-gestos-da-conversa.ts`: relógio de 500 ms no `pointerdown`; `pointermove` marca o dedo que anda (raio de
    10 px do toque); o soltar do dedo parado ou segurando anula o clique, pela mesma trava do arrasto. Segundo dedo não
    solta a vez; `contextmenu` do toque longo é barrado com o dedo na tela.
  - `controlador-detector.ts`: o único lugar acoplado ao `@ricky0123/vad-web` 0.0.31, com comentário apontando a
    versão. Segurar leva o limite do silêncio a 1 h; soltar **zera o `redemptionCounter` antes** de o limite voltar a
    2 s (`seguraNoDetector`). A régua por estado virou `opcoesDoDetector` (mesmos números de antes, mais o segurar).
  - `use-detector-de-fala.ts`: `segura()` novo; `ajustaDetector` usa a régua acima.
  - `use-segurar-a-vez.ts` (novo): estado de segurar, som ao segurar e soltura automática se a cena sai de `ouvindo`.
  - Retorno sem texto: a luz da esfera e da moldura baixa e desbota (`--ck-conversa-segurando` em `globals.css`,
    transição de 200 ms, filtro no próprio desenho); uma nota grave e curta (392 Hz, 60 ms) no `AudioContext` já
    destravado; vibração só de bônus, onde existe.

## Provas

- `npm test`: **1118 testes, 1118 passaram** (28 novos em `segurar-a-vez.test.ts` e `contagem-do-silencio.test.ts`).
- `npm run type-check`: verde.
- **Regra do contador** contra o `FrameProcessor` real da 0.0.31, só com o modelo trocado:
  - falar, calar 1,5 s, segurar 4 s, soltar: nada sai por 1,9 s; a fala sai **1984 ms** depois do soltar (62 quadros
    de 32 ms), uma vez, com o áudio inteiro;
  - **controle**: soltar só devolvendo o limite, sem zerar, entrega a fala **no primeiro quadro** — o defeito do
    briefing existe e é o zerar que o evita;
  - voltar a falar segurando, e segurar antes de falar: o fim sai 1984 ms depois do soltar;
  - trava de versão: o teste cai se o pacote sair da 0.0.31 ou se o MicVAD mudar `frameProcessor`/`setOptions`.
- **E2E** (`e2e/fase4-segurar.cjs`, Chrome com dedo de verdade pelo CDP, perfil de celular): **4/4**.
  - `segurar`: calou 1,53 s, segurou 4,06 s; a vez segurou **503 ms** depois do dedo; soltar → fala entregue em
    **1989 ms**; filtro `saturate(0.5) brightness(0.72)` no canvas segurando e `none` 400 ms depois de soltar; nota de
    392 Hz tocou; o clique que sobrou não parou nada; sem `pointercancel`.
  - Uma transcrição e **um** envio. O WAV tem **13,15 s** para 12,54 s entre o início da fala e o fim detectado (a
    diferença é a pré-gravação): um segmento só, da fala até 2 s depois do soltar.
  - `toque-para`: toque rápido em `ouvindo` para (notas 523, 784, 784, 523).
  - `arrasto-chat`: arrasto para a direita em `ouvindo` leva a `/agente/canarinho` e para; não segurou.
  - `longo-fora-da-vez`: dedo parado 1 s com a conversa parada não começa; o toque seguinte começa normal.
- Regressão do mouse (`fase3-toque.cjs`, casos `comecar` e `parar-ouvindo`): **2/2**, rodado numa cópia com o seletor
  `main[data-cena]` (ver "Não fiz").

## Assumi

- **Mouse segura também** (botão esquerdo parado 500 ms), sem gestos, como antes. Mouse que sai da tela apertado vale
  como cancelado.
- Depois de segurar, andar com o dedo não vira gesto: o soltar só devolve a contagem.
- Dedo que andou mais de 10 px e voltou antes dos 500 ms continua sendo toque, como antes.

## Divergi do combinado

- **WAV em PCM de 16 bits** (`criaWav`, uma linha). O briefing contava ~32 KB/s, mas o `encodeWAV` do vad-web sai em
  float de 32 bits: 64 KB/s, e os 10 MB da rota davam **2 min 44 s**, não ~5 min. Em 16 bits são 32 KB/s e ~5 min 27 s,
  como o briefing supunha, e o envio fica com metade do tamanho. A API converte com ffmpeg; a transcrição real passou
  no E2E com o WAV novo.

## Não fiz

- Commit e build da 3008.
- 🟡 **Entrega real ao canarinho não provada.** A sessão dele está fora na VPS: `POST /input` volta **409
  `agent_pane_unavailable` / `sessao_ausente`** (conferido duas vezes, a segunda agora no fim). O relaunch da API é
  destrutivo e recusa motor não-Anthropic (ele roda gpt-5.6), e religar a frota não é da minha faixa. O E2E prova até
  a borda da página com `E2E_ENVIO=simulado` (o `/input` para no navegador com 200; a transcrição é real). Com o
  canarinho de volta, o mesmo script sem a variável confere a mensagem única no stream dele.
- `fase3-toque.cjs` ficou com o seletor `main` de antes do pager (hoje há dois painéis e o primeiro `main` não é a
  voz). Não mexi no E2E antigo; a cópia com `main[data-cena]` passou.

## Estado do PC

- O dev da 3009 está no ar, subido por esta sessão. O Turbopack servia o `globals.css` antigo (sem o token novo)
  mesmo depois de reiniciar: limpei `.next-dev/dev/cache/turbopack` e subi de novo. Só o `.next-dev` do PC.

FIM-DO-SEGURAR
