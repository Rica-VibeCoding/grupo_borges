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


---

# Fase 4 — cadeira `ui`: transcrição ao vivo na tela de voz (item 6)

Briefing: `briefings/fase4-transcricao-ao-vivo.md`. Tudo no PC, sem commit.

## Entreguei

- **O texto sai do canal ao vivo quando a fala acaba.** O detector de fala (itens 1 e 2) continua decidindo o fim;
  o canal só adianta o texto: fim da fala → confirmação → texto firme → `/input` com `origin: "stt"` (chega como
  `🎙 <texto>`, como antes). A API não mudou.
- `espelho-da-fala.ts` (novo, puro): o que do microfone entra no canal. É o **mesmo trecho que o WAV levaria** — a
  pré-gravação do detector (26 quadros), a fala e o silêncio até o fim; nada do silêncio de antes. Guarda a fala
  enquanto o canal abre e despeja tudo quando ele abre. Qualquer quadro perdido (canal caiu no meio, espera acima de
  60 s) tira a fala do caminho ao vivo. Fala descartada pelo detector, ou detector que para no meio, **limpa** o canal
  (`input_audio_buffer.clear`); fala que recomeça sem fim também.
- `transcricao-da-fala.ts` (novo, puro): de onde sai o texto, e a leitura dos eventos do canal (`item_id` casa o texto
  firme com a fala confirmada, como a doc manda).
  - O canal só vale **dentro de 1 s da confirmação** (a janela; dia bom medido: 471–777 ms).
  - WAV **na hora** quando o canal está fora de jogo (bilhete negado, não abriu, caiu) ou desiste sem texto.
  - WAV **quando a janela fecha** sem o texto firme; daí em diante o WAV decide. Texto atrasado do canal só serve se o
    WAV falhar ou vier vazio.
  - Depois de uma fala que o canal não deu a tempo, a próxima sobe o WAV **junto com a confirmação** (os dois correm,
    vale o canal se vier dentro da janela). O canal ganhando de novo, a espera de 1 s volta.
- `use-canal-da-fala.ts` (novo): bilhete (`/transcription/live-token`, o mesmo do chat), WebSocket direto para a
  Realtime, confirmação manual. Sem captura própria: usa os quadros que o detector já processa (16 kHz) e reamostra
  para 24 kHz com o `criaReamostrador` do chat. Abre quando a vez passa ao Rica (`ouvindo`), fecha quando a fala tem
  destino ou a vez sai dele; fora de `ouvindo` não há canal.
- `use-detector-de-fala.ts`: repassa quadro, início, descarte e fim ao canal (o fim antes da máquina, para a
  confirmação sair junto) e descarta a fala do canal quando desliga. `use-modo-conversa.ts`: o efeito `transcrever`
  passa por `transcreveFala`; o `/transcription` segue sendo a rede de segurança.
- E2E novo `e2e/fase4-ao-vivo.cjs` (15 casos). O `e2e/fase4-segurar.cjs` (meu, da rodada passada) passou a negar o
  bilhete de propósito, para seguir provando o caminho do WAV.

## Provas

- **Vermelho antes**, contra esboços com o comportamento anterior:
  - espelho e caminho, contra "toda fala sobe o WAV": **10 de 20 falharam** (os 10 que passaram são os de "cai no WAV");
  - espera por tempo, contra a espera sequencial: 1 passou, 3 falharam, 9 ficaram pendurados esperando o canal;
  - memória da fala anterior, contra paciência fixa: 2 de 15 falharam;
  - janela de 1 s, contra "vale o primeiro": 6 de 17 falharam.
- `npm test`: **1148 testes, 1148 passaram** (29 novos: 12 do espelho, 17 da transcrição). `npm run type-check`: verde.
- **Medição, mesmo instrumento nos dois caminhos** (dev 3009, Chrome com microfone falso de arquivo
  `--use-file-for-fake-audio-capture=<wav>%noloop`, 5 falas pt-BR reais, uma por navegador, caminhos intercalados):
  do fim da fala (a cena vira `transcrevendo`) até a resposta do envio (a cena vira `esperandoZe`). `/input`
  simulado nos dois caminhos (mesmo custo nos dois).
  - 🟢 **Dia bom, código final** (5 falas por caminho, depois que a OpenAI voltou ao normal; `medicao-final/`): ao
    vivo **550–780 ms, mediana 756**; WAV (o de hoje) **1149–1677 ms, mediana 1333**. O canal ganhou as 5 dentro da
    janela (texto firme 545–777 ms depois da confirmação).
  - 🟢 **Dia bom, duas baterias anteriores** (10 falas por caminho, antes da janela; em todas o firme veio antes de 1 s,
    então o código final faz o mesmo caminho): ao vivo **475–722 ms, mediana 628**; WAV **1176–1938 ms, mediana 1628**.
  - **Ganho de 0,6 a 1,0 s por fala na mediana**, no PC. No iPhone o WAV (170–620 KB) ainda sobe pela rede móvel, então
    o ganho tende a ser maior (não medido).
  - 🟡 **Dia ruim** (bateria final, código final): da terceira bateria em diante a OpenAI passou a atrasar o texto ao
    vivo em 5 a 7 s (sonda direta, 5 vezes: texto firme 6,2–7,5 s depois da confirmação, primeira palavra ~5 s depois
    de falada) e, em 3 das 5, devolveu o texto **cortado** ("Agora", "Agora responda" para "Agora responda só com a
    palavra dois."). O WAV ficou estável. Primeira fala da sessão: ao vivo **2188–3100 ms, mediana 2628** (WAV decide 1 s depois da
    confirmação); WAV só **1194–1912 ms, mediana 1300**. Da segunda fala em diante o WAV sobe junto: caso `dia-ruim`,
    1ª fala 2223 ms, **2ª fala 1306 ms** (igual a hoje).
- **Quedas para o WAV provadas** (E2E, código final):
  - bilhete negado (5 falas `arquivo-N`, live-token 503): nenhum canal, um `/transcription`, um `/input`;
  - canal que cai no meio da fala (`canal-cai`, canal falso fecha no 15º envio): sem confirmação, WAV **na hora**;
  - texto firme que não vem (`sem-firme`): WAV **1015 ms** depois da confirmação;
  - dia ruim (`dia-ruim`): 1ª fala WAV 1015 ms depois da confirmação; 2ª fala WAV junto com ela.
- `tosse` (estalo de 250 ms antes da fala): **uma limpeza** do canal antes da fala; texto sem resto do estalo.
- `segurar` (cala 1,5 s, segura 4 s, solta): fim **2003 ms** depois do soltar, com o canal ligado; texto inteiro.
- Confirmação sai **menos de 50 ms** depois do fim da fala, em todas; o canal abre ~1,0–1,8 s depois da vez começar
  (a fala que chega antes espera e sobe inteira).
- Regressão: `fase4-segurar.cjs` **6/6** (gestos, segurar, WAV de 16 bits).

## Assumi

- A tela de voz não usava o `/voice`: era `/transcription` + `/input`. "Sobe o WAV como hoje" ficou sendo esse par.
- Fala por cima, com fone: a fala que começa com o agente falando fica guardada e sobe inteira quando a vez chega ao
  Rica. É o mesmo áudio que o WAV levaria; o canal não abre fora de `ouvindo`.
- Canal que cai com o Rica calado não reabre sozinho: a próxima fala vai pelo WAV e a próxima vez abre outro canal.
- Só o texto firme vai ao agente; o texto parcial do canal é ignorado.
- Cada vez do Rica cunha um bilhete (uma chamada à OpenAI pela API), mesmo sem fala.

## Divergi do combinado

- **Quando o WAV sobe.** O briefing: "texto firme não veio a tempo → WAV". Fiz a janela de 1 s, WAV decidindo depois
  dela, e WAV junto desde o começo depois de uma fala perdida pelo canal. Motivo medido: no dia ruim, esperar 3 s e só
  então subir o WAV custava **4,5 s por fala** (três vezes o de hoje); "vale o primeiro" deixaria passar texto cortado.
  Custo: num dia ruim, cada fala é transcrita duas vezes (canal e WAV) e o iPhone sobe o WAV como hoje.

## Não fiz

- Commit e build da 3008.
- Entrega real ao canarinho: não precisou. O envio é o mesmo `postAgentInput(..., { origin: 'stt' })` de antes.
- 🟡 **Qualidade do modelo ao vivo** (`gpt-live-transcribe`, do bilhete): errou "package.json" nas três vezes em que
  ganhou essa fala ("peca de ponto J", "peca de .json", "peca de ponto json"); o WAV (`gpt-4o-transcribe`) errou "TOC" por "toque" e "agentes.md" uma vez
  cada. Parecido no geral, mas nome técnico falado é o ponto fraco do ao vivo. Recomendo testar `gpt-transcribe` só na
  tela de voz (a doc o indica para o texto final de fala confirmada, que é o único que usamos) e/ou `keywords` (nomes
  dos agentes, `agents.md`, `package.json`). As duas coisas mudam o corpo do bilhete na API: decisão de vocês.
- 🟡 `e2e/teste/fase4-segurar.cjs` (cadeira `teste`) conta como transcrição toda URL com "transcription" — o bilhete
  entra na conta. No dia bom passa por acaso (1 bilhete, 0 WAV); no dia ruim cai (bilhete + WAV). Ajuste é da `teste`.
- iPhone real: o E2E é Chromium no PC.

## Estado do PC

- Dev da 3009 no ar (não reiniciei). WAVs de teste em `%TEMP%\fase4-ao-vivo-audio`. Provas em
  `e2e/fase4-ao-vivo/`: `provas-dia-ruim.json` (bateria final, 15 casos) e `medicao-final/provas.json` (dia bom).

FIM-DO-AO-VIVO

# Fase 4 — cadeira `ui`: bug do iPhone, a causa (item 6, segunda volta — parcial, sem código)

Parado a pedido, antes de implementar. Nenhum arquivo de código mudou.

## Causa

O "Você disse" da tela de erro não é da fala que falhou: é o texto de uma fala **anterior**, que a tela guarda para
sempre. `falhou` e `transcreveu` não vieram da mesma fala.

- `components/conversa/use-modo-conversa.ts:31` — `ultimaTranscricao` só é escrita em `:128` e nunca é limpa (nem no
  começo da vez, nem no `comecar`, nem no erro). Em `:128` ela é escrita **antes** de a máquina aceitar o texto.
- `components/conversa/leitura-da-conversa.ts:75` — em `erro` a fala do Rica aparece cheia; `tela-conversa.tsx:217-220`
  mostra `ultimaTranscricao` ali. Resultado: qualquer erro depois de uma fala com texto mostra o texto velho.
- A mesma fala não chama as duas coisas: `transcricao-da-fala.ts:59` decide uma vez só (`decidido`), e a máquina só abre
  uma transcrição por vez do Rica (`lib/conversa/maquina.ts:148`).

Caminho exato (log da API, vídeo quadro a quadro a 30 qps, prints do Telegram):

1. 05:15, tentativa 1 (`live-token` na linha 1214 do log): o canal ao vivo transcreve "Melhor Estou aproveitando…" →
   `transcreveu` → `:128` grava o texto → `enviar` → o `POST /input` **não chega à API** (nenhum `/input` do iPhone no
   log) → erro de envio. O Rica para (print das 05:16 é a tela parada). A tela não desmontou: as linhas `recentes=1` entre
   as tentativas são o SSE reconectando, não recarga.
2. 05:17, tentativa 2 (`live-token` na linha 1364): 17,3 s de "Estou ouvindo" (moldura amarela contínua, sem outra fala).
   Fim da fala → "Entendendo" por **~70 ms** → "Não entendi o áudio" (`use-modo-conversa.ts:132`), já com o "Você disse"
   da tentativa 1. 70 ms é rápido demais para qualquer texto da OpenAI: o canal desta fala não trouxe nada (caiu ou
   nem confirmou) e o WAV foi recusado no próprio aparelho — nenhum `/transcription` no log.
3. Por que o iPhone perde os POSTs e não o canal: o canal é WebSocket direto na OpenAI; `/input`, `/transcription` e o
   2º bilhete passam pela tailnet. As três reconexões de SSE entre as tentativas mostram a tailnet do iPhone oscilando
   naquela hora. Isso é hipótese de rede (não tenho o iPhone); o bug da tela independe dela.

## Plano do conserto (teste vermelho primeiro)

- Regra pura nova `fala-da-vez.ts`: o texto da tela pertence à vez do Rica. Zera quando a máquina **entra** em `ouvindo`;
  guarda o firme só se a máquina aceitou o `transcreveu` (estava em `transcrevendo`). Teste vermelho contra esboço do
  comportamento de hoje: fala 1 com texto → vez nova → `falhou` ⇒ "Você disse" tem de ser nulo (hoje: o texto velho);
  `falhou` e depois `transcreveu` atrasado ⇒ nulo.
- `use-modo-conversa.ts`: usar a regra no lugar de `ultimaTranscricao`; despachar `transcreveu` e só então gravar.
- E2E vermelho no Chrome (dev 3009), mesma página: fala 1 com canal falso dando texto e `/input` 500 → toque → fala 2
  com canal mudo e `/transcription` abortado ⇒ "Não entendi" **sem** texto. Mais: fala normal chega ao `/input`;
  OpenAI lenta + WAV falhando ⇒ o texto atrasado do canal vai ao `/input` (já funciona, vira caso fixo).
- Fora do escopo, recomendo à coordenação: repetir uma vez o POST do WAV quando falha sem status (rede) — é idempotente.

## Plano das palavras ao vivo

- Medido no Chrome: os `delta` chegam durante a fala (~1 s de atraso na 1ª palavra), com o **mesmo `item_id`** que o
  commit confirma depois; nenhum delta depois do commit.
- `transcricao-da-fala.ts`: `leEventoDoCanal` passa a devolver `parcial` (item + texto). `use-canal-da-fala.ts`: acumula
  por item e expõe o parcial da fala em curso; zera no `inicio`, no `descarte` (tosse limpa o canal) e ao fechar.
  Continua: só o texto firme vai ao `/input`.
- Tela: em `ouvindo` com parcial, as palavras no lugar de "Estou ouvindo / Quando você parar, eu envio."; em
  `transcrevendo`, o parcial esmaecido no lugar das reticências até o firme substituir. Sem canal ou sem delta, fica
  como hoje. Texto longo rola com a última linha à vista; só com "Mostrar texto" ligado (desligado, nada muda).
- Erro de transcrição: parcial some, nada de texto na tela.

## WebKit

O WebKit do Playwright no Windows (26.6) não tem `AudioContext`, `MediaStream` nem `mediaDevices`: a tela de voz não
roda nele como está. Plano: E2E WebKit com uma camada de microfone falsa injetada (AudioContext/AudioWorkletNode
mínimos que entregam quadros de 16 kHz de um WAV), com o detector Silero real, fetch, WebSocket e React do WebKit.
Prova a lógica e a rede no motor do Safari, não o áudio do iOS.

## Estado e sobras

- Sem commit, sem mudança de código. Sondas em `%TEMP%` (`sonda-chrome.cjs`, `sonda-webkit.cjs`, `video-rica/`).
- ⚠️ Antes da ordem de parar, usei a VPS: ficaram `/tmp/webkit-e2e`, `/tmp/quadros-rica` e a imagem Docker
  `mcr.microsoft.com/playwright:v1.63.0-noble` (~3,5 GB) em 100.116.1.44. Túnel encerrado e conferido. A limpeza é de
  quem tem acesso: `sudo docker rmi mcr.microsoft.com/playwright:v1.63.0-noble` e `rm -rf` das duas pastas.
- Pelo dev 3009 (API de produção, só leitura): baixei os 2 prints e 2 áudios do Telegram do Daniel e transcrevi os
  áudios (2 chamadas de STT).

FIM-DA-CAUSA

# Fase 4 — cadeira `ui`: WAV que cai, texto velho e palavras ao vivo (item 6, segunda volta)

Briefing: `briefings/fase4-ao-vivo-na-tela.md`, com o adendo. Sobre o código do item 6 do PC (`ce4bce7`; sem pull, o
revert `32bb0a2` da origin não entrou). Sem VPS, sem commit.

## Por que o WAV não sai no Safari

**No motor do Safari, o WAV sai.** Rodei a tela de voz no WebKit do Playwright com detector Silero, canal, `fetch` e
React de verdade; só o microfone é falso (esse WebKit não tem áudio). Os suspeitos do adendo, um a um:

- `criaWav` nulo ou lançando: não. Com bilhete negado, o WAV sai na hora (244 KB, 7,6 s de fala) e o texto volta.
- `efeito.audio` vazio por causa do espelho: não. O espelho só guarda referências; o detector entrega cópia.
- `transcreveFala` decidindo `falhou` sem chamar o `arquivo`: não há caminho. `falhou` só sai depois de o WAV rejeitar.
- Canal no Safari (subprotocolo, formato): abre com `realtime`, recebe parciais e firme, confirma. Canal mudo: WAV 1 s
  depois da confirmação.

O que sobra é o que o log mostrou: os POSTs do fim da fala **morrem sem resposta HTTP**. No WebKit isso é
`TypeError: Load failed`, e o código tratava como definitivo: **uma queda, "Não entendi"**, sem segunda subida. É
esse o defeito que o teste vermelho prova e o conserto cobre.

Não provado daqui: por que o iPhone perde esses POSTs. Dois passos, para quem tem a VPS:

- log do Next da 3008 (`cockpit-v2.service`) às 05:17 UTC: "Failed to proxy" = o pedido chegou ao Next e caiu a
  caminho da API; nada = morreu antes (tailnet ou aparelho);
- perguntar ao Rica se o Tailscale do iPhone usa exit node. Se usar, o canal (~64 KB/s de subida contínua) passa pelo
  mesmo túnel dos POSTs, e o padrão fecha: o bilhete (antes do canal) chega, o que vem depois da fala não.

Dois detalhes do vídeo: o navegador é o **Chrome do iPhone** (a Central de Controle mostra "Chrome"), WebKit por baixo.
E a tentativa 1 pode nem ter saído do aparelho: com o Daniel ocupado (o Rica mandava áudio para ele no mesmo minuto),
a tela para em "O agente está ocupado" sem POST nenhum. Sem o vídeo dela, não distingo.

## Entreguei

- **WAV que cai na rede sobe de novo** (`transcricao-da-fala.ts`). Rejeição sem status HTTP ("Load failed",
  "Failed to fetch") → nova subida em 400 ms e depois em 1,2 s. Na espera, o canal ainda ganha (dentro da janela) ou
  vale como último recurso. Status HTTP é definitivo: o STT da API já tem retentativa própria. Parou no meio: não sobe.
  - O `/input` **não** repete: `postAgentInput` cria uma chave nova por chamada e a API não deduplica o `/input`.
    Repetir numa queda poderia entregar a fala duas vezes.
- **Texto velho** (`fala-da-vez.ts`, novo, puro). O texto da tela é da vez do Rica: zera quando a vez volta a ele; o
  firme só entra quando a máquina aceita o `transcreveu`. Sai o `ultimaTranscricao` de `use-modo-conversa.ts`; o
  `despacha` aplica a regra a cada evento.
- **Palavras ao vivo.**
  - `leEventoDoCanal` lê o parcial (`delta`) com o item. `parcial-do-canal.ts` (novo, puro) soma os pedaços por item.
  - `use-canal-da-fala.ts` repassa o parcial à tela. Apaga quando o áudio sai do canal: tosse, fala recomeçada,
    canal que caiu no meio.
  - Tela, em `ouvindo`: as palavras no lugar de "Estou ouvindo / Quando você parar, eu envio.". 36 px (token da
    esfera), últimas 5 linhas à vista; o começo da fala longa sai por cima.
  - Em `transcrevendo`: o parcial esmaecido sob "Você disse" até o firme. Durante o envio, o firme (antes, reticências
    até o envio acabar).
  - Só com "Mostrar texto"; desligado, nada muda. Sem canal ou sem parcial, a tela fica como antes. O leitor de tela
    segue ouvindo "Estou ouvindo"; o parcial não é anunciado.
- E2E: `e2e/fase4-ao-vivo-2.cjs` (Chrome e WebKit), `e2e/microfone-falso-webkit.cjs`, `e2e/sonda-webkit-fala.cjs`.

## Provas

- **Vermelho antes.**
  - Retentativa: 4 de 5 falharam. O 5º ("erro do servidor não repete") passa hoje e guarda o limite.
  - Texto da vez, contra esboço do comportamento de hoje: 5 de 8 falharam. Três são o texto velho: fala anterior no
    "Não entendi", texto atrasado recusado pela máquina, vez nova sem limpar. Dois são do parcial.
  - E2E contra o código antigo (Chrome, arquivos voltados ao `HEAD` e restaurados; `provas-codigo-antigo-chromium.json`):
    `texto-velho` **falhou com a tela exata do iPhone**, "Não entendi o áudio … Você disse “Canário, teste do modo
    conversa…”" (texto da fala 1). `wav-cai-uma` falhou: uma queda do WAV virou erro.
- `npm test`: **1183 testes, 1183 passaram** (18 novos). `type-check`: verde.
- **E2E final, 8/8 — Chrome 4/4, WebKit 4/4** (dev 3009, `/input` sempre parado no navegador):
  - `normal`: 12 a 17 atualizações de palavras durante a fala; a primeira ~1 s depois de dita, a fala inteira na tela
    ~1 s antes de o detector encerrar. Firme ao `/input`, nenhum WAV.
  - `lenta-sem-wav` (firme 3 s atrasado, WAV sempre caindo): 3 subidas caídas, texto atrasado do canal ao `/input`.
  - `wav-cai-uma` (canal mudo): 2 subidas, 1 caída; `/input` com o texto do WAV.
  - `texto-velho`: o erro de envio mostra o texto da própria fala; a fala 2 dá "Não entendi o áudio" **sem texto**.
  - Nos oito, nenhum quadro com "Não entendi" e texto juntos.
- Fala longa no WebKit (23 s): as 5 últimas linhas à vista durante a fala (`webkit-fala-longa-*.png`).
- Canal real medido: depois de limpar uma tosse, a fala seguinte vem com item novo e nada do item limpo chega depois.
- Regressão do item 6 (`fase4-ao-vivo.cjs`, Chrome): **7/7** (`aoVivo-1`, `arquivo-1`, `canal-cai`, `sem-firme`,
  `tosse`, `segurar`, `dia-ruim`).
- Tudo em `e2e/fase4-ao-vivo-2/`.

## Assumi

- "Palavras no lugar do título" vale com "Mostrar texto" ligado (o Rica usa ligado, visto no vídeo).
- Duas novas subidas do WAV (400 ms e 1,2 s): cobre uma conexão velha no pool do iOS e uma queda curta de rede sem
  segurar "Entendendo" mais de ~2 s a mais.

## Não fiz

- Commit, build e publicação: ordem desta volta.
- iPhone real e a causa de rede no aparelho: sem VPS e sem o aparelho.
- `/input` repetido na queda de rede: precisa de deduplicação no servidor antes.
- 🟡 Recomendo, para o próximo teste no iPhone, o motivo da falha numa linha pequena da tela de erro ("rede" ou
  "servidor 502"): separa aparelho de servidor numa gravação. Muda o que o Rica vê: decisão dele.

## Estado do PC

- Dev da 3009 no ar (não reiniciei).
- Código: `transcricao-da-fala.ts`, `use-canal-da-fala.ts`, `use-modo-conversa.ts`, `tela-conversa.tsx` e `.module.css`
  alterados; novos `fala-da-vez.ts`, `parcial-do-canal.ts`, e os testes `transcricao-retentativa`, `fala-da-vez`,
  `parcial-do-canal`.
- Pela API de produção, via dev 3009, só leitura: bilhetes do canal e ~10 transcrições de WAV. Nenhum `/input` real.
- `%TEMP%`: minhas sondas e cópias removidas; as da volta anterior ficaram.

FIM-DO-AO-VIVO-2
