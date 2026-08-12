# Voz de volta — pesquisa de UI (Hiro, 11/08/2026)

> Pesquisa e desenho para o cockpit v2 responder em **áudio**, como já acontece no
> Telegram. Pedido do Daniel: pesquisar autoplay no iOS, anatomia da mensagem de
> áudio, lib versus feito à mão, referências visuais — e fechar com UMA proposta
> de desenho. **Não é código de produção.** Onde não achei fonte, está escrito
> "não achei fonte".

Contexto da casa: cockpit v2 = Next.js + React em `apps/cockpit`, Rica 90% no
iPhone (Safari/PWA — app web instalado na tela de início), tela é log de execução
(82% `tool_use`/`tool_result`, medido), pele tem dono (`globals.css`, seis regras
inegociáveis). A entrada por voz já existe e está aprovada
(`components/shell/voz.ts`); isto é a **saída**.

---

## 1. Autoplay no iOS — a pergunta que decide a UI inteira

### O que a fonte diz

- **Áudio com som continua bloqueado sem gesto do usuário (user gesture).** A
  política do WebKit exige que `play()` venha de um handler de evento de gesto
  (`touchend`, `click`, `keydown`). A isenção criada em 2017 foi só para vídeo
  mudo; áudio não ganhou exceção. Não achei fonte de nenhuma atualização
  posterior mudando isso.
  Fonte: https://webkit.org/blog/6784/new-video-policies-for-ios/
  e https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- **Um gesto destrava a sessão, não só o momento.** O WebKit usa "sticky
  activation" (ativação permanente) para Web Audio: uma vez que a página teve
  ativação, o `AudioContext` pode ser retomado sem gesto novo.
  Fonte: https://webkit.org/blog/13862/the-user-activation-api/
- **Mas o destrave tem que acontecer DENTRO do gesto, de forma síncrona.** Um
  `await` ou `setTimeout` entre o toque e o `resume()`/`play()` quebra a cadeia.
  E para o elemento `<audio>` o destrave é **por elemento**: a prática madura é
  criar UM elemento persistente, "abençoá-lo" no primeiro gesto (tocando um
  trecho silencioso) e reutilizá-lo trocando o `src`. Criar `new Audio()` por
  resposta toma `NotAllowedError` depois que a janela do gesto expira — relatado
  exatamente num caso de TTS de assistente em PWA iOS.
  Fontes: https://github.com/odysseus-dev/odysseus/issues/5517 ,
  https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos ,
  https://github.com/ctoth/cacophony
- **PWA instalado não muda nada.** Mesma exigência de gesto da aba do Safari; no
  WebKit não existe a isenção por engajamento (MEI — Media Engagement Index,
  índice de engajamento de mídia) que o Chrome dá a PWA instalado.
  Fontes: https://github.com/odysseus-dev/odysseus/issues/5517 ,
  https://docs.jwplayer.com/platform/docs/player-ux
- **Tela bloqueada/background:** `AudioContext` puro para ao bloquear; rotear por
  elemento `<audio>` é o caminho robusto. `navigator.audioSession.type =
  "playback"` (Audio Session API — API de sessão de áudio) declara intenção de
  mídia e impede a chave de silêncio do iPhone de mutar a resposta — API
  experimental, feature-detect (detecção de recurso) obrigatório. Media Session
  API (API de sessão de mídia) funciona no Safari 15+ e mostra controles na tela
  de bloqueio, artwork confiável a partir do iOS 16.4/18.
  Fontes: https://bugs.webkit.org/show_bug.cgi?id=231105 ,
  https://developer.mozilla.org/en-US/docs/Web/API/AudioSession ,
  https://dbushell.com/2023/03/20/ios-pwa-media-session-api/
- **Transient activation (ativação transitória) dura 5s no WebKit** desde
  abr/2022 — mas a reprodução de mídia se ancora na sticky activation + destrave
  por elemento, então o desenho certo NÃO depende de encaixar o TTS dentro de 5s
  do toque.
  Fontes: https://bugs.webkit.org/show_bug.cgi?id=239832 ,
  https://webkit.org/blog/13862/the-user-activation-api/
- Se o ChatGPT usa esse padrão de destrave: **não achei fonte** primária. O guia
  de apps de voz em tempo real recomenda exatamente este desenho (uma ação
  explícita que, dentro do gesto, inicializa o áudio).
  Fonte: https://www.protoface.com/blog/browser-autoplay-policy-guide-for-realtime-ai-avatars-scaling-voice-and-video-without-user-gesture-failures

### Resposta prática (o que a UI deve fazer)

1. **Existe um gesto de opt-in** — "Ativar voz" (o toggle de voz de volta).
   Sem gesto não há caminho; isto não é contornável e não vale fingir que é.
2. **No handler desse toque, síncrono:** criar e destravar o recurso único de
   áudio (um `<audio>` persistente tocando silêncio, ou `AudioContext` +
   `resume()`). Guardar o destrave para "quando o TTS chegar" não funciona — a
   resposta chega fora da janela do gesto.
3. **Um único `<audio>` para sempre**, trocando `src`. Nunca um elemento novo
   por mensagem.
4. **Antes de cada reprodução, re-validar:** o contexto volta a
   `suspended`/`interrupted` em troca de aba e bloqueio; re-chamar `resume()` e
   capturar `NotAllowedError` do `play()` — aí a bolha mostra um botão "ouvir"
   (o toque do Rica resolve, sem drama).
5. **Um gesto destrava a sessão inteira — não se re-pede toque por mensagem.**
   Só volta a pedir se o `play()` falhar.
6. **`audioSession.type = "playback"` com feature-detect** (sem isso a chave de
   silêncio muta a resposta) e **Media Session** com título/artista para a fala
   aparecer na tela de bloqueio.
7. **Tratar a fala como experiência de primeiro plano**, lock screen como bônus
   — background em PWA instalado é historicamente menos confiável que na aba.

---

## 2. A anatomia da mensagem de áudio

### O que os maduros fazem

- **Telegram (iOS):** bolha com 4 peças — botão redondo play/pause, waveform
  (onda sonora) pré-computada que é também scrubber (controle de arrastar a
  posição), duração total que vira tempo decorrido ao tocar, botão "2X" ciclando
  1.5× → 2× → 1×. Long-press (toque longo) na velocidade abre controle fino.
  Posição lembrada se você sai no meio. Voice messages consecutivas tocam em
  sequência.
  Fontes: https://accessibleandroid.com/controlling-playback-speed-of-audio-messages-in-whatsapp-and-telegram/ ,
  https://telegram.org/blog/voice-chats-on-steroids ,
  https://ethora.com/blog/chat-app-ui-ux-design/
- **WhatsApp (iOS):** o anúncio de mar/2022 virou o padrão da categoria —
  waveform na bolha, playback fora da conversa (barra no topo do app), pausar
  gravação, ouvir antes de enviar, lembrar posição, velocidade 1.5×/2×. Sete
  bilhões de voice messages/dia: é o formato que a mão do usuário já sabe.
  Fontes: https://about.fb.com/news/2022/03/new-voice-message-features-on-whatsapp ,
  https://www.macrumors.com/2022/03/31/whatsapp-rolls-out-new-voice-message-interface-and-features/
- **ChatGPT:** Read Aloud (ler em voz alta) é um player mínimo sob cada resposta
  — play/pause e avanço/retrocesso, **sem waveform e sem seek fino**. O Advanced
  Voice Mode (modo de voz avançado) é o oposto: tela cheia imersiva com a esfera
  azul, sem controles — é conversa ao vivo, não player de mensagem. **Lição:
  para áudio de RESPOSTA, a OpenAI usa player mínimo, não anatomia de
  mensageiro.**
  Fontes: https://mashable.com/article/chatgpt-how-to-make-it-read-responses-aloud ,
  https://siliconangle.com/2024/03/04/openais-chatgpt-gets-voice/
- Sobre "o que acontece quando chega mensagem nova enquanto uma toca": a
  evidência documentada é reprodução sequencial automática (Telegram); sobre o
  comportamento exato de interromper versus enfileirar, **não achei fonte**
  primária.

### O que vale copiar versus o que é peso morto

**Copiar (padrão consolidado, a mão espera):**

- Botão redondo play/pause + waveform + tempo, numa linha compacta.
- Toque/arraste na onda faz seek (busca de posição).
- Rótulo único de tempo: duração em repouso, restante tocando.
- Velocidade 1× → 1.5× → 2× em ciclo (resposta de trabalho se ouve mais rápido).
- Um áudio por vez: tocar outro pausa o anterior (o v1 já tem esse singleton —
  `playExclusive` em `apps/web/lib/tts-context.tsx`).

**Peso morto pro nosso caso:**

- Slider de velocidade 0.2×–2.5× (é de podcast; ciclo de 3 basta).
- Lembrar posição (resposta de 10–90s não se retoma, se re-ouve do início).
- Fila automática de áudios consecutivos (cockpit é ferramenta de trabalho, não
  conversa de mensageiro — ver proposta, §6).
- Modo imersivo tela cheia e waveform ao vivo durante a fala (são de conversa
  bidirecional em tempo real, não de resposta).
- Controle de volume na bolha (o do sistema basta).

---

## 3. Fazer à mão ou usar lib — recomendação: **à mão, SVG + peaks do servidor**

- **wavesurfer.js v7** (7.12.11, BSD-3, zero dependências, plugins
  tree-shakeable — importa só o que usa): bundle minificado 43 kB → **~12.3 kB
  gzip** (medido no artefato oficial; bundlephobia não renderizou — "não achei
  fonte" lá). Pre-computed peaks (picos pré-calculados) é feature de primeira
  classe: `WaveSurfer.create({ peaks, duration })` desenha sem decodificar, e a
  doc recomenda gerar server-side com o `audiowaveform` da BBC.
  Fontes: https://registry.npmjs.org/wavesurfer.js/latest ,
  https://wavesurfer.xyz/docs/peaks/ ,
  https://unpkg.com/wavesurfer.js@7.12.11/dist/wavesurfer.min.js
- **O padrão Telegram:** a waveform vai DENTRO da mensagem —
  `documentAttributeAudio.waveform`, ~100 valores de 5 bits (0–31), ~63 bytes de
  payload. Cabe inline no JSON, sem arquivo separado.
  Fontes: https://core.telegram.org/constructor/documentAttributeAudio ,
  https://github.com/tdlib/td/issues/2370
- **Como o nosso TTS é gerado server-side**, computar os peaks no backend custa
  uma linha de `audiowaveform` (ou um loop de RMS — root mean square, média
  quadrática — em Node). Com peaks na mão, a onda nasce completa no instante
  zero e o "problema do streaming" simplesmente não existe.
- **Por que não wavesurfer:** 90% dele é pipeline de decode/streaming/Web Audio
  que não usaríamos — com peaks do servidor sobra só o desenho de barras, que é
  a parte fácil. A casa mantém tudo à mão (ícones são custom, sem lucide), o
  teto é 300 linhas/arquivo e cada kB conta no iPhone. Uma dependência a menos.
- **Por que não howler/react-h5-audio-player/peaks.js:** motor sem onda, UI
  genérica que não é bolha de chat, e escopo de editor de áudio,
  respectivamente.
- **Reconsiderar wavesurfer só se** aparecer áudio de minutos, zoom na onda ou
  timeline com marcadores — aí os 12 kB pagam funcionalidade real.

Plano concreto: endpoint TTS devolve `{ url, duration, peaks: [~100×0-31] }`;
componente desenha ~80 barras SVG e sincroniza progresso pelo evento
`timeupdate` do `<audio>`; velocidade via `audio.playbackRate`.

---

## 4. Referências visuais 2026 — e qual encaixa na nossa estética

- **Gemini Live, redesign de abr/2026 (a mais forte).** Abandonou a tela cheia:
  a fala do assistente virou uma **pílula compacta na base com uma waveform
  azul**, sobre o conteúdo do app. É a única referência que resolve o nosso
  problema real: voz que **não toma a tela** — exatamente o caso de um feed 82%
  log de ferramentas. Contida, dark-mode (modo escuro), estado visível sem
  exigir atenção (bom para TDA).
  Fontes: https://9to5google.com/2026/04/19/gemini-live-app-redesign/ ,
  https://sammyguru.com/gemini-live-interface-drops-fullscreen-design/
- **ElevenLabs UI (a mais acionável).** Biblioteca open source de componentes de
  voz na família shadcn/ui: Live Waveform (modos estático/rolando/processando),
  Conversation Bar, Orb. Dá pra ver renderizado e copiar comportamento. A Orb 3D
  em Three.js eu ignoraria — mais festiva e pesada que a estética contida.
  Fontes: https://ui.elevenlabs.io/ ,
  https://ui.elevenlabs.io/docs/components/live-waveform
- **Orbe do ChatGPT (como convenção, não como tela).** A esfera pulsante é o
  símbolo que o usuário já lê como "IA falando" — a OpenAI a está unificando
  como identidade de voz (o Codex usa a mesma orbe, vazamento de jun/2026).
  Útil como microelemento de estado, não como layout.
  Fontes: https://help.openai.com/articles/8400625-voice-mode-faq ,
  https://pasqualepillitteri.it/en/news/5438/codex-voice-pet-orb-hey-chat
- Bônus — **Apple Podcasts, transcrições (mar/2024):** a fala vira texto que
  acompanha o áudio palavra por palavra. No nosso caso o texto já existe (a
  resposta É texto); a voz é a sombra, não o protagonista. Reforça: o player é
  uma linha, não uma tela.
  Fonte: https://www.apple.com/newsroom/2024/03/apple-introduces-transcripts-for-apple-podcasts/
- Sesame e Spotify AI DJ: **não achei fonte** escrita descrevendo o visual —
  valeria abrir a demo da Sesame no iPhone e registrar à mão.

**Encaixe na nossa estética:** Gemini Live como referência de postura (compacta,
não toma a tela), ElevenLabs UI como referência de componente, orbe do ChatGPT
como convenção de estado reconhecível. Nada de tela cheia, nada de 3D.

---

## 5. O que a pele da casa já decide (levantamento do `globals.css` + estética)

- **Superfície:** `var(--ck-surface-raised)` (#313131) — "mensagem elevada" é a
  casa natural da bolha; exige o fio de luz de 1px no topo (`.ck-lit`) e proíbe
  véu de overlay por cima.
- **Raio:** `var(--ck-radius-frame)` (8px) — "raio pequeno é da superfície que
  MOSTRA saída"; o 16px é do composer, não dela. O botão play é
  `var(--ck-radius-pill)` (circular) com mínimo de toque `var(--ck-touch-min)`
  (44px).
- **Tempo:** `var(--ck-font-mono)` (voz da máquina) + classe `.ck-tabular`
  (obrigatória — senão o número dança a cada segundo), `--ck-text-xs`/`sm` em
  `var(--ck-text-secondary)`.
- **Estado "tocando":** o vocabulário existente aponta `var(--ck-state-running)`
  (ciano = máquina trabalhando); falha vai em `var(--ck-state-fail)` com
  ícone/texto — cor nunca é portadora única (§3 da estética).
- **Movimento:** waveform **estática** — movimento persistente é privilégio de
  quem chama o humano (`state-attention`); "movimento em tudo é decoração". O
  progresso avança recolorindo barras (mudança discreta no `timeupdate`, não
  transição); se houver barra de preenchimento, só `transform: scaleX()`, nunca
  `width`. Entrada da bolha: `.ck-surge` (200ms, padrão do app).
  `prefers-reduced-motion` desliga tudo.
- **Ícones:** play/pause **não existem** — entram no `icones.tsx` pela régua da
  casa (traço 1.3, `fill: none`, `currentColor`; sólido só se for a ação que a
  tela promove). `IconeOnda` já existe e serve como marca de "áudio".
- **Não existem e precisam ser pedidos (não inventados):** cor de waveform e de
  trilha de progresso (proposta abaixo exige medição de contraste pela §3 da
  estética — "proposta de cor sem o número calculado não entra").

---

## 6. A proposta de desenho — "a bolha que fala"

Uma linha por baixo da resposta em texto, não uma tela, não um modo. O áudio é a
sombra sonora da mensagem que já existe no feed.

### Anatomia da bolha (uma linha, ~48px de altura)

Da esquerda pra direita, em `--ck-surface-raised` + `.ck-lit`, raio `--ck-radius-frame`:

1. **Botão play/pause circular** (44px). Em repouso mostra play; tocando,
   pause. Ícone novo no `icones.tsx`.
2. **Waveform estática** de ~60–80 barras SVG, desenhada dos peaks que vêm no
   payload da mensagem. Barras já percorridas em `var(--ck-state-running)`,
   restantes em `var(--ck-edge-hairline)` (par novo de cor — medir contraste
   contra `raised` antes de entrar). Toque posiciona; arrastar faz seek.
3. **Tempo em mono tabular:** duração em repouso (`0:42`), restante ao tocar.
4. **Botão "1×"** ciclando 1× → 1.5× → 2× — omitido se a resposta tiver menos
   de ~15s (curto demais pra ganhar algo).

### O fluxo, do momento em que a resposta chega até o áudio terminar

1. **Antes de tudo, uma vez:** o Rica liga "Voz de volta" (toggle no composer,
   mesmo lugar onde hoje se escolhe motor/effort — regra da casa de reusar o
   affordance existente). Nesse toque, síncrono no handler, o front cria o
   `<audio>` único, toca um silêncio de 1 frame e o guarda. A sessão está
   destravada; nunca mais se pede gesto para tocar.
2. **A resposta chega** pelo SSE como hoje (texto e blocos de ferramenta). O
   endpoint de TTS devolve `{ url, duration, peaks }` e a bolha entra no feed
   com `.ck-surge`, anexada à mensagem do assistente — acima do primeiro bloco
   de texto, uma linha só.
3. **Se nada está tocando, ela toca sozinha.** O botão vira pause, as barras
   vão acendendo em ciano, o tempo desce em mono. Se algo já estava tocando
   (resposta anterior), a nova **não interrompe**: entra em repouso com um
   ponto de "nova" (mesma gramática de badge que a casa já tem); quando a atual
   termina, a nova toca na sequência — o Rica pode furar a espera tocando nela,
   o que pausa a anterior. Sem fila visível, sem painel: no máximo uma
   esperando.
4. **Durante a fala** o Rica pode: tocar na bolha (pausa/retoma), arrastar na
   onda (seek — gesto direto, sem modo), tocar no "1×" (mais rápido). Nada
   pulsa, nada respira — a prova de vida é a onda avançando.
5. **O áudio termina:** a bolha volta ao repouso (play, duração total) e fica
   no feed como qualquer item de log — re-ouvir é um toque. A que estava
   esperando, se houver, começa.
6. **Se o `play()` falhar** (trocou de aba, bloqueou, contexto suspenso): a
   bolha mostra o estado de falha com a saída, na filosofia do `voz.ts` —
   nunca só o diagnóstico: "toque para ouvir" (o toque re-destrava e toca na
   hora). Sem banner de erro, sem modal.
7. **Tela bloqueada:** com Media Session configurada, a fala aparece na tela de
   bloqueio com título do agente e dá pra pausar de lá. Bônus, não fundação.

### O que este desenho evita de propósito

- Não é tela cheia nem modo — o feed continua sendo o protagonista (82% log).
- Não tem waveform ao vivo nem orbe animada — movimento persistente é
  privilégio de `state-attention` na casa.
- Não tem fila, posição lembrada, slider de velocidade, volume — peso morto
  medido contra respostas de 10–90s.

### Decisões que ficam para o back (fora do meu recorte, mas travam a UI)

- TTS sob demanda (botão "ouvir" por mensagem, como o Read Aloud) ou sempre que
  a voz está ligada? O v1 já tem `trigger: 'always' | 'on_voice_input' |
  'never'` — a bolha nasce pronta quando `always`, ou sob demanda nos outros.
- Peaks computados na geração (ideal) ou no primeiro pedido.
- Onde a bolha se anexa no contrato de dados: candidato natural é uma part
  `data-voz` na ponte `RenderItem` (a regra da casa para o que a lib não
  modela), citando a família de fixture correspondente — renderer novo exige
  fixture gravada.

---

## 7. A onda durante a síntese progressiva — veredito sobre o `{ url, duration, peaks }`

**A contradição (apontada pelo Daniel, e ele tem razão).** O endpoint
`{ url, duration, peaks }` do §3/§6 é o caminho do arquivo inteiro: o servidor só
consegue calcular `duration` e `peaks` depois de sintetizar o áudio **todo**. A
frente do Canário quer o oposto — sintetizar por sentença e entregar
progressivamente, porque não existe jeito de saber a duração de um áudio ainda
chegando (a propriedade do navegador devolve infinito com o fluxo aberto, o
cabeçalho HTTP que serviria nunca saiu de provisional — provisório —, e a marca
de duração do MP3 exige o total conhecido antes; medição e documentação do
Canário, não verifiquei independentemente). Eu resolvi o streaming voltando pro
blob (arquivo binário único) sem perceber.

**O dado que concilia (medido pelo Daniel no endpoint real, voz `daniel`):**
122 palavras em pt-BR → 7,54s de síntese → 40,18s de fala. A síntese corre
**5,3× mais rápido que a fala**. O áudio começa a tocar em ~1s; aos ~7,5s a
síntese termina e os peaks + duração real chegam por um segundo evento — quando
o Rica ouviu ~16% da resposta.

**Veredito: a terceira opção do Daniel — onda desenhada progressivamente —,
resgatada pela duração estimada.** A versão crua dela morre porque, sem duração
total, o eixo X não tem escala: a régua se move debaixo do dedo e o seek é
impossível. Mas o servidor conhece o **texto inteiro** antes de sintetizar — e
com a taxa medida por voz (~3 palavras/s no caso medido) estima a duração total
antes do primeiro byte. Com escala travada, o desenho vira:

- A bolha nasce com a **largura final** (duração estimada) e todas as barras em
  estado-fantasma: altura mínima, `var(--ck-edge-hairline)`.
- Conforme cada sentença chega, os peaks reais dela **substituem** os fantasmas
  no lugar que já era delas. A revelação anda ~5× mais rápido que o playhead
  (indicador de posição da reprodução) — ou seja, **está sempre à frente do que
  o Rica está ouvindo**: a barra que ele ouve agora já nasceu real.
- Quando a duração real chega, a escala se ajusta uma vez. Com estimativa boa
  (±15%), o ajuste é imperceptível; a taxa de fala é estável por voz e pode ser
  medida e guardada por voz no servidor.

### Por que esta não lê como defeito, e as outras duas leem

A régua é uma frase: **o futuro pode chegar; o passado não pode mudar.**

- **Barra de progresso que vira onda** (primeira opção): a bolha troca de
  componente aos 7,5s, no meio da reprodução — uma metamorfose estrutural numa
  tela cujo padrão de entrada é `.ck-surge` de 200ms. Lê como "carregou de
  verdade agora", ou seja: admite que antes era simulação.
- **Onda de espera que acende de uma vez** (segunda opção): o pior caso é
  invisível até você olhar o detalhe — as barras **atrás** do playhead (o que o
  Rica já ouviu) mudam de forma retroativamente. Interface que reescreve o
  passado lê como falha, não como carregamento.
- **Revelação progressiva** (a escolhida): é a gramática universal de
  carregamento progressivo — a trilha de buffer (armazenamento antecipado) do
  YouTube à frente do playhead, o skeleton (esqueleto de carregamento) que
  preenche. Todo usuário lê "está chegando", ninguém lê "quebrou". E passa na
  régua de movimento da casa: não é movimento persistente — tem começo, meio e
  fim (~7,5s), como o próprio `.ck-surge`; com `prefers-reduced-motion` a
  revelação é uma mudança discreta por sentença, sem transição.

### O que muda nos detalhes da §6 (apenas durante a revelação)

- **Tempo:** mostra só o decorrido (`0:12` subindo), sem total — número que se
  corrige lê como erro. Quando a duração real chega, passa ao formato restante
  da convenção. É informação que se completa, não que se corrige.
- **Seek:** só na zona já revelada. Tocar na zona fantasma não faz nada (o
  fantasma já diz "ainda não existe").
- **Velocidade 1.5×/2×:** segue disponível — mesmo a 2× o playhead continua
  mais lento que a revelação (5,3 ÷ 2 = 2,65×).
- **Resposta curta** (~30 palavras, ~2s de síntese): a revelação completa antes
  de o Rica perceber — o caso feliz sai de graça no mesmo desenho.

### Por que não "pagar os ~10s pela onda perfeita"

É resposta legítima, mas a matemática não fecha: a espera escala com o texto.
122 palavras já são 7,5s de silêncio; um relatório de entrega de 300 palavras
são ~20s. Silêncio de 20s num assistente de trabalho lê como travamento — é
exatamente o defeito que a frente do Canário existe pra eliminar. O preço do
desenho progressivo é um ajuste de escala quase invisível; o preço da onda
perfeita é o produto não valer a pena.

**Fallback honesto:** se o back não entregar duração estimada nem peaks por
sentença, sobra a barra de progresso fina sem onda no primeiro trecho, virando
onda ao completar — aceita como degradação conhecida, não como desenho. A bola
da estimativa de duração e do peaks-incremental é do back; o texto inteiro ele
já tem.

---

## 8. Resumo de uma tela

- Autoplay iOS: um gesto destrava a sessão; destrave síncrono no opt-in, um
  `<audio>` eterno, re-`resume()` por reprodução, PWA não muda nada.
- Anatomia: play/pause + waveform + tempo + 1×/1.5×/2×, seek na onda; o resto é
  peso morto.
- Implementação: SVG à mão + peaks do servidor (padrão Telegram, ~63 bytes);
  wavesurfer só se áudio longo aparecer.
- Visual: postura Gemini Live, componente ElevenLabs, convenção orbe — dentro
  dos tokens da casa, waveform estática, `.ck-surge` na entrada.
- Pedidos de token: cor da waveform (tocada × restante) com contraste medido;
  ícones play/pause novos no `icones.tsx`.
