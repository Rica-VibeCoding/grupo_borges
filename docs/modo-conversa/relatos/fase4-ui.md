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

# Fase 4 — cadeira `ui`: foto do agente na tela de voz, B e C com chave (item 5)

Base `main` em `70eda2a`. Sem commit, sem VPS. Só o Canário recebeu fala; o Daniel só teve a tela parada carregada.

## Entreguei

- **Chave "Foto do agente"** na folha de configurações: Atividade ao vivo (B, padrão) ou Eclipse (C). Guardada no
  `localStorage` (`ck-conversa-direcao`), como as outras escolhas. Valor desconhecido cai na B.
- **B**: pílula no alto com foto, primeiro nome e estado ("na linha", "ouvindo", "entendendo", "falando"…). O aro
  acende na cor da vez; falando, respira e solta ondas; barrinhas de áudio ao lado do estado.
- **C**: linha em mono no alto (NOME • estado) e o núcleo no lugar da esfera — foto grande, sem cor, com linhas de
  varredura, cercada por um anel de 96 traços que mede a voz de verdade (`leNivel`): ouvindo acende de baixo para
  cima, falando acende inteiro, pensando gira um trecho claro. Com a esfera escolhida, ela passa por trás e vira a
  coroa. Em tela baixa (iPhone SE, resposta longa) o núcleo encolhe em degraus.
- **Tela parada nova, nas duas**: foto e aro em cinza, e só um convite ("Toque para falar / Depois é só conversar"
  na B; "Toque e fale / A tela inteira é o botão" na C). O "Detector pronto em 2,2 s" saiu da tela e foi para o pé
  da folha de configurações.
- **Ícone de chat saiu** da tela de voz (o gesto direita → chat segue). O `aoIrAoChat` morto saiu do pager.
- **Fotos**: 512 px para as onze que têm; canarinho, caseiro e fluytcom usam a de 128 e o núcleo encolhe para
  132 px, sem borrar. Sem arquivo, cai na inicial (Avatar do Radix, nunca imagem quebrada).
- Arquivos novos: `direcao-da-voz.ts`, `foto-do-agente.ts` (regras puras, com teste), `retrato-da-voz.tsx` +
  `.module.css`, `anel-da-voz.tsx`. Mexidos: `tela-conversa.tsx` + css, `configuracao-da-conversa.tsx` + css,
  `use-preferencias-conversa.ts`, `esfera-conversa.tsx` (aceita o núcleo no centro do palco), `pager-do-agente.tsx`,
  `app/globals.css` (tokens `--ck-conversa-foto-*`, `-pilula*`, `-convite`).

## Provas

- Vermelho antes: `direcao-da-voz.test.ts` e `foto-do-agente.test.ts` falharam por módulo ausente; verdes depois (13).
- `npm test`: 1204/1204. `type-check`: 0 erros.
- `e2e/fase4-ao-vivo-2.cjs` de novo: **8/8 PASS** (Chrome e WebKit) — palavras ao vivo, "Você disse", "Não entendi"
  sem texto velho.
- Capturas 390×844 @3x no dev 3009, em `docs/modo-conversa/e2e/fase4-foto/` (roteiro `e2e/fase4-foto.cjs`):
  `atividade-*` e `eclipse-*` em parado, ouvindo (com palavras), entendendo, falando, erro e configurações; mais
  `eclipse-parado-512` (foto do Daniel), `eclipse-com-esfera-parado` e `eclipse-iphone-se` (375×667).
- Nenhuma cor solta nos arquivos novos; tudo em token. `tela-conversa.module.css` fechou em 299 linhas.

## Assumi

- Com "Mostrar texto" desligado, a pílula/linha do alto (nome + estado) e o convite da tela parada continuam
  visíveis: são a identidade da tela, não o texto da conversa. Palavras ao vivo e falas seguem só com o texto ligado.
- A B só com a moldura (o visual padrão) não tem esfera: o convite fica no meio da tela, sob a pílula.
- "Pensando/entendendo" usa a cor de pensar que já existia (`--ck-conversa-pensa`); erro, a de erro.
- A foto da pílula (52 px) usa a de 128, a mesma da cápsula do chat; só o núcleo busca a de 512.

## Divergi do combinado

- Nada.

## Não fiz

- Não publiquei nem commitei (proibido no briefing).
- `Retrato` do chat (`components/shell/retrato.tsx`) não passou a usar `fotoDoAgente`: fora da minha pasta. O caminho
  é o mesmo (`/avatars/<slug>.webp`).
- Sem alvo de ping (casa/sessão) no briefing: o aviso foi pela própria conversa.

## Achados laterais

- 🟡 Com "reduzir movimento" ligado no aparelho, abrir `/conversa/<slug>` direto cai no chat (`/agente/<slug>`), não
  na voz. Visto no Chrome com `reducedMotion: 'reduce'`; sem ele, abre na voz. Não mexi no pager.
- O `[data-estado]` agora também existe no chat novo: roteiro que procura `document.querySelector('[data-estado]')`
  (como o `fase3-capturas.cjs`) pega o elemento errado. O meu usa `main[data-cena]`.
- O Turbopack do dev 3009 perdeu uma edição rápida do `globals.css` (servia o token velho) até eu editar o arquivo
  de novo.

FIM-DA-FOTO

# Fase 4 — cadeira `ui`: o texto da tela de voz entra na proposta visual

Briefing: `briefings/fase4-texto-da-voz.md`. Base: o item 5 sem commit. Sem VPS, sem commit. Nenhum agente recebeu
mensagem além do Canário (e ele só a primeira, ver achados).

## Pesquisa (o que adotei e por quê)

- **Ninguém escreve o estado em título.** ChatGPT (orbe), Siri iOS 18 (luz na borda), Gemini Live (onda) e Sesame
  (círculo que pulsa): a cor e o movimento da animação são o estado. Adotei: o estado é a animação + uma palavra.
- **Legenda é opcional, pequena e presa ao visual.** Gemini: caixa fixa de 3 linhas no meio da tela, só a fala dele.
  Siri: balão pequeno junto da animação ("Always Show Speech/Captions"). ChatGPT (nov/2025): transcrição dos dois
  lados, em texto de conversa. Adotei: 3 linhas num lugar fixo sob a animação, desligável ("Mostrar texto").
- **O convite é o movimento, não a letra.** Sesame e o orbe do ChatGPT convidam pulsando. Adotei: um pulso lento
  que sai da animação + uma linha pequena.
- **Frase explicativa não existe em nenhum dos quatro.** Saiu daqui também.

## Entreguei

- **Uma regra só: "só o agora brilha".** Todo o texto mora num lugar fixo logo abaixo da animação, na mesma família:
  legenda de 18 px em meio-tom, rótulo em mono (caixa-alta de olho) na cor de quem fala.
- **Parada**: sem título. Um pulso lento (3,2 s) sai da borda da esfera, de fora do anel do núcleo (C) ou de um aro
  pequeno com ponto de toque (B só com a moldura). Embaixo, "TOQUE PARA FALAR" em mono 12 px, respirando no mesmo
  ritmo. Preparando: "PREPARANDO A ESCUTA", sem pulso.
- **Estado**: a palavra da pílula (B) e da linha do alto (C) acende na cor da vez; esperando a resposta, ganha os
  segundos ("pensando · 12 s"). O título grande e a frase explicativa saíram da tela e ficaram no `aria-live`.
- **Ao vivo**: suas palavras em 3 linhas, presas embaixo; a linha mais velha some por cima (máscara).
- **"Você disse"** (entendendo, pensando, erro de envio): rótulo âmbar + a fala; parcial esmaecido até o firme.
- **Falando**: sua fala numa linha apagada em cima, o nome do agente em ciano e a resposta do começo, 3 linhas; o
  que ainda não foi dito some por baixo.
- **Erro e aviso**: sempre no cartão do pé (fundo opaco, filete vermelho). Com texto, segunda linha com o que fazer,
  sem repetir o título ("Não ouvi uma frase" fica só com o título).
- **Layout**: palco com teto de 352 px e lugar fixo do texto (144 px com texto): animação + texto viram um bloco no
  meio da altura, e a esfera não pula quando a legenda cresce. Com a esfera fora da vista, o palco guarda o tamanho.
- Arquivos novos: `legenda-da-voz.ts` (regra pura) + teste, `texto-da-voz.tsx` + `.module.css` (legenda, convite,
  sinal do toque). Mexidos: `tela-conversa.tsx` + css (299 → 207 linhas), `retrato-da-voz.tsx` + css (estado na cor,
  segundos, pulso do núcleo; o convite saiu dele), `direcao-da-voz.ts` (convite de uma linha),
  `leitura-da-conversa.ts` (`avisoDaTela`), `app/globals.css` (tokens `--ck-conversa-legenda*`, `-some-acima/abaixo`,
  `-palco-max`, `-sinal`; saíram `-titulo*` e `-convite`).

## Provas

- **Vermelho antes**: convite 2 de 3 falharam (era título + detalhe por direção); `legenda-da-voz.test.ts` e o
  arquivo de `leitura-da-conversa` falharam por módulo/função ausente. Verdes depois (27 nos três arquivos).
- `npm test`: **1211/1211** (7 novos). `type-check`: 0 erros.
- `e2e/fase4-ao-vivo-2.cjs`: **8/8 PASS**, Chrome 4/4 e WebKit 4/4 (palavras ao vivo, "Você disse", "Não entendi"
  sem texto velho), com `E2E_FECHA_CORRIDA=1` — ver achados.
- Capturas 390×844 @3x no dev 3009, esfera matéria + "Mostrar texto" (o arranjo do Rica), em
  `docs/modo-conversa/e2e/fase4-texto/`, roteiro `e2e/fase4-texto.cjs`: `atividade-*` e `eclipse-*` em parado,
  ouvindo (com palavras), entendendo, pensando, falando e erro; mais `*-parado-moldura` e `*-parado-sem-texto`.
  `textos.json` guarda o texto de cada tela (o `aria-live` segue dizendo "Estou ouvindo", "Pensando"…).
- Nenhuma cor solta nos arquivos novos; máscaras e cor do pulso em token.

## Assumi

- **O estado não ganhou uma segunda palavra junto da animação**: a pílula (B) e a linha do alto (C) já são a palavra
  do estado, acima da animação. Duas palavras dizendo "ouvindo" seria o mesmo ruído que o título. Ela passou a
  acender na cor da vez — é o que faz ela ser vista.
- Esmaecidos (parcial, sua fala durante a resposta, linha que some) usam `--ck-text-tertiary` (3,6:1): repetem o que
  já está na tela e são desenho, não leitura. Legenda, rótulos e erro ficam em AA (≥ 5,2:1).
- O rótulo usa `font-variant-caps` e não `text-transform`: o texto continua "Você disse" para o leitor de tela e para
  o E2E do item 6.
- Pulso e convite param com "reduzir movimento" (aro fixo, linha acesa); as reticências também.

## Divergi do combinado

- A palavra do estado ficou onde já estava (pílula/linha do alto), em vez de uma nova junto da animação. Razão acima.

## Não fiz

- Commit, build e publicação: proibidos no briefing.
- iPhone real: sem o aparelho.
- Sem alvo de ping (casa/sessão) no briefing: o aviso vai pela conversa.

## Achados laterais

- 🔴 **O Canário parou de responder às 14:57 UTC** (28/09): minha primeira fala de teste ("Responda só com a palavra:
  um") está há 18+ min em "trabalhando", sem resposta. Com isso a tela recusa qualquer fala com "O agente está
  ocupado" (o stream fica "em voo"). Não mexi (VPS proibida). Por isso:
  - as capturas simulam o envio e a resposta **no navegador** (o `/input` não sai; a resposta entra como evento no
    stream real) — a fala, o canal ao vivo e a transcrição são de verdade;
  - `fase4-ao-vivo-2.cjs` ganhou `E2E_FECHA_CORRIDA=1`, que fecha a corrida pendurada só no navegador. Sem ela, hoje,
    dá 0/8 com "O agente está ocupado" antes de testar qualquer coisa.
- Às 14:39 UTC o Canário recebeu uma fala real pelo modo conversa ("Vou pedir para o Daniel fazer alguns ajustes"):
  o Rica pode estar usando o Canário ao mesmo tempo que os testes.

## Estado do PC

- Dev 3009 no ar (não reiniciei). Uma edição minha no meio de uma captura recarregou a tela e zerou a conversa; a
  rodada foi refeita.
- `%TEMP%`: ficaram só os logs das rodadas (`fase4-texto.log`, `ao-vivo-2.log`); amostra do stream e mosaicos apagados.

FIM-DO-TEXTO

# Fase 4 — cadeira `ui`: a legenda da fala do agente acompanha a voz por frase (item 7)

Briefing: `briefings/fase4-legenda-do-agente.md`. Base: main `e51a92e` + voz nova sem commit. Sem VPS, sem commit,
dev 3009 não reiniciado. Único agente acionado: o Canário (três pedidos: um da legenda, um do caso 1 da bateria, um
do ao-vivo-2 com `/input` simulado — este não chegou nele).

## Entreguei
- `components/conversa/frases-da-voz.ts` (novo, puro): corta a resposta em frases pela mesma regra do servidor
  (`_split_sentences` de `apps/api/routers/tts.py`: pontuação final, linha em branco, abreviação não fecha frase);
  `audioTocando` diz qual áudio toca pelo relógio do reprodutor; `fraseEmDestaque` devolve a frase atual e a de antes.
- `frases-da-voz.test.ts` (novo): 11 testes, escritos antes e vistos vermelhos (módulo inexistente).
- `use-fila-de-voz.ts`: cada envelope de áudio guarda de que texto e de que sentença veio; quando o progresso cruza o
  começo do próximo áudio, avisa `aoFrase`. Pausado (falou por cima), o progresso é ignorado: a legenda congela.
- `use-modo-conversa.ts`: `respostaDoZe` (o texto inteiro, trocado a cada bloco) virou `fraseDoZe` (a frase cujo
  áudio toca). Zera quando o turno do agente abre e quando a sua fala é transcrita. Texto novo do agente segue
  enfileirando sem mexer na legenda.
- `legenda-da-voz.ts` + teste: o trecho do agente carrega a frase em destaque, não mais o texto inteiro.
- `texto-da-voz.tsx` + `.module.css`: nas mesmas três linhas de antes, a frase que toca embaixo, do começo (mais de
  três linhas some por baixo); a de antes sobe em meio-tom apagado, mostrando o fim e sumindo o começo. A frase nova
  entra subindo (320 ms); com movimento reduzido, sem animação. Chave por áudio: a que acabou é o mesmo elemento
  que sobe e apaga.
- `app/globals.css`: duas máscaras novas junto das da legenda (`--ck-conversa-frase-some-abaixo`/`-acima`).
- `docs/modo-conversa/e2e/fase4-legenda.cjs` (novo): E2E real — pedido sintetizado pela voz do cockpit, tocado por
  microfone falso, ao Canário de verdade; grava cada troca de frase e cada áudio que começa.

## Provas
- `npm test`: 1286 testes, 1285 passam, 0 falham, 1 pulado (o mesmo de antes). `npm run type-check`: 0 erros.
- E2E legenda (`e2e/fase4-legenda/provas.json`, fotos `frase-1..5.png`): 5 áudios, 5 frases, nada da resposta antes do
  primeiro áudio, console e JS limpos. Sequência observada (ms da página; distância até o áudio da frase):
  1. 19617 (+249 ms) — "A luz do sol chega branca, com todas as cores misturadas."
  2. 23609 (−142 ms) — "Ao entrar na atmosfera, ela esbarra nas moléculas de ar e se espalha." (anterior: a 1)
  3. 28542 (−231 ms) — "As cores de onda curta, como o azul, se espalham muito mais que o vermelho." (anterior: a 2)
  4. 33560 (−81 ms) — "Por isso o azul chega aos seus olhos vindos de todo lado do céu." (anterior: a 3)
  5. 38159 (−140 ms) — "No fim da tarde a luz atravessa mais ar, e aí sobra o vermelho." (anterior: a 4)
- Bateria real, caso 1 (Chromium, atividade, texto ligado): ordem ouvindo → transcrevendo → esperandoZe → falando →
  ouvindo, `/input` 200, console limpo.
- Chrome do agente (browser-harness) no dev: tela de voz abre em `parado`, zero `console.error`/`warn` no carregamento.

## Assumi
- A troca vem do relógio do reprodutor cruzando o começo real de cada áudio (duração medida no MP3, não a estimada
  por caractere), com folga de 250 ms. Na prática: a primeira frase aparece ~250 ms depois da voz (o primeiro
  `timeupdate` do navegador); as seguintes trocam no fim da anterior, 80–230 ms antes do próximo áudio soar.
- Um sinal exato de "áudio começou" pede um `aoComecar` em `components/feed/reprodutor-unico.ts`, que é do Hiro.
  Não mexi; a folga acima cobre.
- Frase em destaque no meio-tom da família (não branco), a de antes no terciário.

## Divergi do combinado
- Nada.

## Não fiz
- Interrupção real (falar por cima no meio da resposta) não foi provada em E2E: o microfone de arquivo não acerta o
  momento. O congelamento vem do código (progresso ignorado com a voz pausada) e do teste da legenda (`pausada`
  mantém a frase).
- WebKit não rodado nesta volta.

## Achados laterais
- `e2e/fase4-ao-vivo-2.cjs` caso `normal` falha numa checagem velha: espera `origin: 'stt'`, o código manda `'voz'`
  desde `a0ff331`. O resto do caso passou (palavras ao vivo antes do fim, um envio, sem erro de JS). Não é desta
  mudança; o script precisa trocar a origem esperada.
- Se o servidor e a tela cortarem diferente (markdown, bloco de código), a legenda fica na última frase do bloco
  em vez de adiantar; sem erro.
- A cópia da regra de corte tem que andar junto com `_SENTENCE_END`/`_ABBREVIATION_END` do servidor (comentário no
  arquivo diz isso).

## Estado do PC
- Dev 3009 no ar, não reiniciado. Aba do Chrome do agente ficou na tela de voz do dev.
- `%TEMP%/fase4-ao-vivo-audio/legenda.wav` criado (fala do pedido); logs em `/tmp` do Git Bash.
- ⚠️ Os dois E2E reescreveram as saídas deles: `e2e/teste/saida-real-chromium-atividade-texto1.json` (só o caso 1
  agora) e as fotos de `e2e/fase4-ao-vivo-2/`. Quem precisar da rodada anterior da cadeira `teste` roda de novo.

FIM-DA-LEGENDA

# Fase 4 — cadeira `ui`: animações da tela de voz + adendo do Rica + revisão do Pavan

Briefing: `briefings/fase4-animacoes.md` (com o adendo de 28/09 e a revisão do Pavan). Sem VPS, sem commit, dev 3009
não reiniciado, nenhuma biblioteca nova. Canário: tentei três vezes, a sessão dele está fora (ver Não fiz).

## O que anima, e quanto dura
- Abrir a voz pelo link do chat ou voltar do navegador: `document.startViewTransition()` nativo
  (`transicao-da-voz.ts`). A tela que sai apaga em 200 ms e a que entra aparece em 320 ms; fechando, a esfera
  (`ck-voz-esfera`, o único nome) encolhe em 200 ms. No celular o link é só de teclado e leitor de tela; o dedo abre
  pelo gesto do pager, e aí vale a entrada abaixo.
- Entrada da tela, em qualquer caminho (gesto, link, entrada direta): o alto chega em 320 ms e o texto 70 ms depois,
  subindo 0,75rem com a mola; a esfera acende em 320 ms, só opacidade.
- Troca de estado: a palavra do estado entra com fade (200 ms) e sobe 0,4em com a mola (320 ms), via `@starting-style`
  com a palavra como chave. A esfera muda de ritmo em ~0,4 s, sem tranco (`aproximaRitmo`); cor e forma já trocavam
  aos poucos.
- Legenda (adendo): cada palavra entra com fade e sobe 0,35em (320 ms). A janela de três linhas sobe 320 ms quando
  nasce linha nova, só `transform` (Web Animations, `composite: 'add'`).
- "Toque para falar": a linha não pisca mais, só entra (320 ms). Quem convida é o anel da esfera respirando: cresce
  4–5% e volta, em 3,6 s. É o único laço fora da própria esfera.
- Mola nova em `globals.css`: `--ck-mola`, um `linear()` amortecido que passa 1,5% do alvo e assenta.

## Adendo do Rica
- Estado verdadeiro: `estado-da-vez.ts` + teste (9 casos, vermelho antes).
  - pensando = esperando, sem ferramenta;
  - trabalhando = a última coisa do agente no log é uso de ferramenta ou resultado dela;
  - falando = só com áudio saindo: sem progresso do áudio por 450 ms, deixa de ser "falando".
- A máquina da conversa não mudou. `data-cena` segue a máquina; o visual, a pílula e o núcleo seguem a cena nova
  (`data-vista`). "Trabalhando" tem esfera própria (facetada, borda do agente, ritmo 1,5), moldura, palavra e leitura
  de tela próprias.
- Palavra por palavra: a fala dele entra ao longo do áudio de cada frase, com o peso de cada palavra em letras,
  dentro de 90% da duração real do áudio. Interromper congela. A sua fala entra conforme a transcrição chega.
- Janela de três linhas rolando, nas duas falas, sempre com as últimas linhas à vista. A legenda por frase do item 7
  (atual e anterior) saiu: o adendo vale acima dela.
- Recarga do dev: salvei em quatro lotes, cada um de uma vez. Medi que a recarga derruba a conversa. Com a escuta
  aberta, salvar TS/TSX da voz volta a tela ao "parado" (Fast Refresh, sem recarregar a página); salvar CSS recarrega a
  página. É item novo, não consertei.

## Revisão do Pavan
- Nenhum `box-shadow` animado sobrou. O brilho do aro da pílula, o do aro do núcleo e o halo da esfera sem WebGL
  viraram `::after` parados, e o laço anima só a opacidade deles; o núcleo escala o aro, não a sombra.
- Blur da pílula no WebKit, medido com a esfera animando: p50 15 ms e p95 17 ms com blur; p50 15 e p95 16 sem. Não
  custou, ficou. Medido no WebKit do Playwright no Windows, não num iPhone.

## Provas
- `npm test`: 1303 testes, 1302 passam, 0 falham, 1 pulado. `npm run type-check`: 0 erros. Nenhum arquivo da voz
  passa de 300 linhas.
- E2E `e2e/fase4-animacoes.cjs` (Chromium e WebKit, fotos em `e2e/fase4-animacoes/`):
  - Chromium: a troca de tela anima (~1 s em dev) e a esfera tem o nome da troca;
  - Chromium: o toque na troca de estado cai no botão e liga a escuta;
  - WebKit com a API: a troca de tela anima, sem erro;
  - WebKit sem `startViewTransition`: troca direta, painel voz, URL certa, sem erro;
  - reduced-motion (Chromium e WebKit): `/conversa/canarinho` abre na voz e o link troca sem animar.
- Quadros longos (long-animation-frame, Chromium, dev): abrindo a voz pela primeira vez sobra um de 928 ms, que é o
  replay do stream da própria tela de voz (`EventSource.onreplay-start`, já existia), e um de 377 ms sem script.
  Estilo+layout+pintura ficou ≤ 9 ms em todos: nenhuma animação longa no main thread.
- `e2e/fase4-ao-vivo-2.cjs` caso normal: a sua fala entra palavra a palavra com a transcrição real.
- Chrome do agente (browser-harness): reduced-motion emulado abre `/conversa/canarinho` na voz, console sem erro nem
  aviso. A troca animada não roda ali porque a aba do agente fica escondida (`visibilityState: hidden`).

## Assumi
- "Trabalhando" é lido do log (último bloco do agente é ferramenta, ou resultado dela), não de tempo.
- A palavra do agente se espalha pelo peso em letras; o tempo real de cada palavra não existe no áudio.

## Divergi do combinado
- A troca de ESTADO não usa View Transition. Medido no Chrome: durante qualquer troca o toque cai no `html`, mesmo
  com `pointer-events: none` em toda a árvore da transição, e um toque para interromper se perderia. O estado anima
  em CSS e no desenho. A View Transition ficou para a troca de tela, onde o toque em ~300 ms não pesa.
- Abrindo a voz, a esfera não entra na foto da troca: montar o WebGL dela e o da moldura dentro da troca congelava a
  tela por ~900 ms (medido). Ela monta logo depois e acende sozinha.
- Consertei o reduced-motion. O corte global de `globals.css` põe transição de 0,01 ms em toda propriedade, e o
  `order` do painel da voz chegava um quadro atrasado: o scroll caía no chat e o encaixe o segurava lá. A correção é
  `transition-property: none` no painel do pager. O diagnóstico anterior (reflow) não se confirmou: o `scrollTo`
  funcionava.

## Não fiz
- 🔴 Ciclo real com o Canário: `/input` voltou 409 três vezes, `agent_pane_unavailable` / `sessao_ausente`. A sessão
  tmux dele não existe na VPS, e subir sessão é fora da minha faixa. Por isso o palavra por palavra do agente e o
  "falando só com som" estão provados em teste de unidade, não com resposta real. O E2E está pronto:
  `node e2e/fase4-legenda.cjs` grava a sequência de estados, as palavras por frase e se houve "falando" sem som. Ele
  pede uma ferramenta (data no terminal) e quatro frases.
- Fechar pela troca animada (voltar do navegador) não tem E2E; o caminho de código é o mesmo da abertura.
- WebKit não liga a escuta aqui: o WebKit do Windows não tem `AudioContext`. É ambiente, não produto.
- A moldura sem WebGL (`.reserva` da moldura) ainda repinta gradiente com `--nivel-da-voz` (não é sombra). Fica
  para o Pavan decidir.

## Achados laterais
- `e2e/fase4-ao-vivo-2.cjs` continua esperando `origin: 'stt'`; o código manda `'voz'`.
- As saídas dos E2E foram reescritas: `e2e/fase4-legenda/provas.json` guarda a rodada bloqueada; `fase4-ao-vivo-2/`
  e `fase4-animacoes/` foram refeitas.

## Estado do PC
- Dev 3009 no ar, não reiniciado; os arquivos tocados no teste de recarga voltaram ao conteúdo original.
- Temporários em `%TEMP%/anim` (scripts de lote e de medição).

FIM-DAS-ANIMACOES

# Fase 4 — cadeira `ui`: prova com o Canário real (fala palavra por palavra + estado de verdade)

Rodada de 28/09, 16:04, com a sessão do Canário religada. Fecha o 🔴 do "Não fiz" acima.
`node docs/modo-conversa/e2e/fase4-legenda.cjs` no Chromium (Chrome headless, 390×844, toque), contra o dev 3009.
Nenhuma rota interceptada. O único falso é o microfone: o pedido foi sintetizado pela voz do cockpit e tocado por
um dispositivo falso. O pedido força uma ferramenta: "confira a data de hoje no terminal; depois me explique em
quatro frases curtas por que o céu é azul". Saída em `e2e/fase4-legenda/provas.json` e nas fotos `frase-1..6.png`.

## Sequência observada (ms desde a carga da página)
- 457 preparando → 1255 parado → 1619 ouvindo (toque no centro)
- 13214 transcrevendo, 0,95 s depois da fala
- 14165 pensando, por 3,05 s
- 17215 **trabalhando**, por 3,12 s: ele rodou o comando da data
- 20334 pensando de novo, por 10,0 s: escreve a resposta e a voz prepara a 1ª frase
- 30372 **falando**, por 26,0 s: 5 áudios em sequência, sem voltar a "pensando" entre eles
- 56392 ouvindo: fim do turno, mãos livres

## A fala dele, frase a frase
- 5 frases, 5 áudios, nenhuma palavra da resposta antes do primeiro áudio
- As palavras entraram aos poucos, espalhadas pela frase:
  - frase 0: 23 passos em 6,1 s, a primeira palavra 252 ms depois do áudio começar
  - frase 1: 14 passos em 4,0 s, −67 ms
  - frase 2: 14 passos em 4,0 s, −28 ms
  - frase 3: 13 passos em 3,3 s, −180 ms
  - frase 4: 14 passos em 3,9 s, −142 ms
- O sinal negativo é a folga de 250 ms do item 7: a troca de frase antecipa o `playing` do próximo áudio em até
  ¼ s. Dentro do combinado.
- A janela de 3 linhas aparece na `frase-4.png`: o que já foi dito, apagado, em cima; a frase que toca embaixo, cortada
  onde a voz está ("O azul, que tem").
- **"Falando" sem som: 0.** Cada entrada em "falando" tinha áudio tocando.

## Erros
- Console, JS e API (≥ 400): nenhum.

## Achados laterais
- O aviso "Não consegui manter a tela acesa." ficou na tela a rodada toda. É o wake lock (a trava que impede a tela
  de apagar), e o Chrome headless do teste nega esse pedido. É ambiente; no iPhone vale conferir à mão.
- `e2e/fase4-legenda/falha.png` (15:52) é de uma rodada anterior à minha e ficou na pasta.
- O interromper por cima da fala (congela a fala) segue provado só em teste de unidade. Este E2E não fala por cima.

## Estado do PC
- Dev 3009 no ar desde 16:00, não mexi.
- O `HEAD` local segue em `e51a92e`. O `4cb52ab` só existe em `origin/main` (fiz fetch, sem merge). Os arquivos
  dele estão na árvore como edição não commitada, e é esse o código que a 3009 serve.
- Nenhum arquivo de produção alterado nesta rodada; só este relato.

FIM-DA-PROVA
