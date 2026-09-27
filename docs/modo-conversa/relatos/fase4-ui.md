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

---

# Fase 4 — cadeira `ui`: conserto do toque demorado com a conversa parada

Briefing: `briefings/fase4-toque-longo-parado.md`. Tudo no PC, sem commit.

## Entreguei

- **Regra nova:** só em `ouvindo` o dedo parado segura a vez; em qualquer outra cena, dedo parado é toque, curto ou
  longo (parado começa, ativos param, erro tenta de novo — o `acaoDoToque` de sempre). Dedo que andou segue gesto.
- `segurar-a-vez.ts`: o estado `parado` do dedo saiu. `rapido` virou `toque` (um dedo de 900 ms não é rápido) e
  fica `toque` depois dos 500 ms fora da vez; `aoSoltar` só desvia o `segurando`.
- `use-gestos-da-conversa.ts`: só o nome do estado (`'rapido'` → `'toque'`, três linhas). Nenhuma mudança de fluxo.
- `segurar-a-vez.test.ts`: caso novo do briefing, varredura "fora da vez, dedo parado é toque em toda cena", e o
  dedo longo que anda depois dos 500 ms volta a ser gesto (antes ficava `nada`).
- `e2e/fase4-segurar.cjs`: `longo-fora-da-vez` saiu; entraram `curto-comeca`, `longo-comeca` e
  `longo-para-esperando`.

## Provas

- **Vermelho antes:** "cena parado, dedo 800 ms sem andar, soltar → toque" falhou no código do `eac75e1`
  (`soltar: 'nada'`, esperado `'toque'`); 9 de 10 passaram.
- `npm test`: **1119 testes, 1119 passaram**. `npm run type-check`: verde.
- **E2E no dev 3009** (Chrome com dedo pelo CDP, perfil de celular, `E2E_ENVIO=simulado`): **6/6**.
  - `curto-comeca`: dedo de 100 ms, parado → `ouvindo`; o toque seguinte para.
  - `longo-comeca`: dedo de 900 ms sem andar, ainda `parado` com o dedo na tela, `ouvindo` ao soltar; não segurou;
    microfone abriu uma vez; o toque seguinte para. Rastro: `pointerdown`, `pointerup`, `click`.
  - `longo-para-esperando`: fala real transcrita, `esperandoZe`; dedo de 900 ms, ainda `esperandoZe` com o dedo na
    tela, `parado` ao soltar; não segurou; **um** `/interromper`.
  - `segurar` (em `ouvindo`, como antes): segurou **502 ms** depois do dedo; soltar → fala em **1980 ms**; filtro
    `saturate(0.5) brightness(0.72)` segurando e `none` depois; nota de 392 Hz; uma transcrição, um envio; WAV de
    16 bits, 13,15 s.
  - `toque-para` (notas 523, 784, 784, 523) e `arrasto-chat` (`/agente/canarinho`, não segurou): iguais.

## Assumi

- O dedo longo fora da vez que anda depois dos 500 ms é gesto (configurações, chat ou nada), como era antes do
  `eac75e1`. Na regra antiga ele virava `nada`.
- O E2E é Chromium. O `click` depois de 900 ms saiu nele; no iPhone de verdade, a prova é o Rica.

## Divergi do combinado

Nada.

## Não fiz

- Commit e build da 3008.
- 🟡 `e2e/teste/fase4-segurar.cjs` (da cadeira `teste`), `casoNaoQuebra` passo 1: afirma a regra antiga ("dedo
  parado 1 s fora da vez não começa") e agora vai cair. Não é meu arquivo; ajuste é da `teste`.

FIM-DO-TOQUE-LONGO
