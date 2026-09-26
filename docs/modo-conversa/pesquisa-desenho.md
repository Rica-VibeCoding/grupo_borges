# Pesquisa de desenho — conversa por voz em tempo real no navegador

> Canário, 26/09/2026. Pedido: Daniel, por briefing (`briefing-pesquisa-canario.md`). Li antes o
> `cockpit-v2-modo-conversa-PLANO.md` e o §11 de `cockpit-v2-fala-em-tempo-real.md`. Nenhum modelo
> de voz como cérebro, conforme a restrição.
> Regra de leitura: **PROVA** = está escrito na fonte primária, com o link. **SUPONHO** = dedução
> minha a partir dela. Onde não achei fonte, digo que não achei.

---

## 1. Arquitetura em cascata — o que roda no navegador e o que roda no servidor

**ACHADO (PROVA).** O desenho validado tem nome e é o padrão: *cascata* (cascade, inglês/português —
"encadeado", ouvir → transcrever → pensar → falar). LiveKit chama de `STT-LLM-TTS` e escreve que
"for most production agents, an STT-LLM-TTS pipeline is the right default". Existem três tipos:
cascata, modelo de fala-para-fala (realtime) e o **meio-cascata** (half-cascade), onde o modelo de
voz só *entende* e devolve texto — que é exatamente a "recepção na frente do Zé" que o briefing
pergunta quem faz.

**ACHADO (PROVA).** O navegador é cliente burro nesses frameworks. O trabalho todo — VAD, STT,
detector de turno, LLM, TTS — roda num processo de servidor ("worker") que **entra na sala como
participante** e publica o áudio de volta. O Pipecat espelha isso com o `SmallWebRTCTransport`
(navegador ↔ bot por WebRTC par-a-par, sem provedor terceiro). O SDK de navegador do Pipecat cuida
só de captura, reprodução, estado de sessão e mensagens (protocolo RTVI).

**ACHADO (PROVA).** Rodar VAD local é barato e recomendado: Silero "processes 30+ms audio chunks in
less than 1ms" numa thread de CPU, e VAD local é "150-200ms faster than remote VAD services". Existe
`web-vad`, adaptação do `@ricky0123/vad` "designed to support realtime voice agents such as those
provided by Pipecat", que roda inteiro no navegador (ONNX Runtime Web + AudioWorklet).

**EVIDÊNCIA.** `docs.livekit.io/agents/models/pipelines/` (verificado 26/09/2026); LiveKit Turn
Detector v1 mede "300 ms latency budget → 9.9% false-cutoff"; Pipecat
`docs.pipecat.ai/pipecat/learn/speech-input`; `docs.pipecat.ai/api-reference/client/js/overview`.

**RISCO.** Não achei números de latência por etapa na doc do LiveKit — a única cifra dura que ela dá
é "voice conversations feel natural when end-to-end response latency stays under one second". Essa
meta **não é alcançável** com o nosso cérebro (Claude Code leva segundos), e nenhum framework
cobre esse caso. O desenho que estamos copiando assume cérebro rápido; nós temos cérebro lento.

**RECOMENDAÇÃO.** Manter o nosso desenho (captura + VAD no navegador, cérebro atrás), porque o
cérebro é justamente o que não pode ser substituído. Mas assumir que **não herdamos** o que o
worker do LiveKit dá de graça: reconexão, transporte de áudio, eco e detector de turno.
Confiança ALTA no desenho geral; ALTA no alerta de que a meta de 1s é irrelevante pra nós.

---

## 2. Fim da fala — quanto silêncio o pessoal usa

**ACHADO (PROVA).** O padrão de mercado tem **três camadas**, não uma:
1. VAD por energia/Silero marca *fala × silêncio* — Silero com `stop_secs = 0.2s` (200 ms).
2. Um atraso mínimo antes de fechar o turno — LiveKit: `endpointing.min_delay = 0.5s`,
   `max_delay = 3.0s`; em modo VAD o corte é `max(silêncio do VAD, min_delay)`.
3. Um modelo semântico decide se a frase **acabou** — Smart Turn no Pipecat e Turn Detector no
   LiveKit. LiveKit v1 mede: 300 ms de orçamento → 9,9% de corte errado; 600 ms → 4,5%; alvo de 5%
   de erro → 543 ms de espera média.

**ACHADO (PROVA, e é a divergência mais concreta).** A lib de VAD de navegador mais usada,
`@ricky0123/vad-web`, usa por padrão `redemptionMs: 1400` (1,4 s de silêncio), `preSpeechPadMs: 800`
e `minSpeechMs: 400`. Lido no código-fonte dela, `packages/web/src/frame-processor.ts`, em
26/09/2026. O plano do Daniel usa **~900 ms**.

**EVIDÊNCIA.** Pipecat: "Built-in STT P99 latency values are measured with `stop_secs=0.2`" e
`SpeechTimeoutUserTurnStopStrategy(user_speech_timeout=0.6)`. LiveKit:
`docs.livekit.io/agents/logic/turns/tuning` (verificado 26/09/2026). vad-web:
`github.com/ricky0123/vad`, arquivo acima.

**RISCO.** 900 ms é 36% mais agressivo que o padrão da própria lib. Quem respira no meio da frase
(ou pensa em voz alta, como o Rica faz por voz) é cortado. O erro é assimétrico e cruel: cortar cedo
manda meia frase pro cérebro e queima um turno inteiro de Claude Code; esperar 400 ms a mais só
custa 400 ms. Além disso, o VAD de energia puro não distingue "pausa" de "acabou" — a Pipecat
escreve literalmente que VAD "only hears silence, so it cannot tell a finished sentence from a
pause mid-sentence".

**RECOMENDAÇÃO.** Subir o silêncio para ~1300–1500 ms **ou** somar Silero (`@ricky0123/vad-web`) por
cima do gate de energia, mantendo a energia como pré-filtro barato. Confiança ALTA de que 900 ms
está abaixo do praticado; MÉDIA sobre qual dos dois caminhos é melhor pra nós.

---

## 3. Fala por cima (barge-in) com o alto-falante tocando — o eco

**ACHADO (PROVA, e derruba a premissa do R2).** No Chrome, o cancelamento de eco **não cobre áudio
tocado pela própria página**. O flag `kChromeWideEchoCancellation` existe pra isso — "mix and cancel
all audio playback going to a specific output device in the audio service" — e está declarado
`FEATURE_DISABLED_BY_DEFAULT` no próprio código do Chromium. Um relato no W3C diz o mesmo por outro
caminho: "Chrome, however, seems to be moving away from specs as it only attempts to remove sound
from only remote peer and not all sounds as mentioned in spec definition" — enquanto Edge, Firefox
e Safari seguiriam a definição ampla.

**ACHADO (PROVA).** Só funciona o que estiver no grafo de áudio do navegador. O SDK da Zoom troca a
rota de reprodução conforme o AEC disponível: com Chrome-wide, toca pelo `AudioContext`; sem ele,
toca "through a media element plus a peer connection". E diz por quê: sem o recurso, "the echo
canceller never sees what the speakers are playing".

**ACHADO (PROVA).** No iPhone a história é outra e tem dois efeitos colaterais medidos: com o
microfone capturando, a **qualidade da reprodução degrada** — taxa de amostragem cai e estéreo vira
mono, tanto para WebRTC quanto para `HTMLAudioElement`, com ou sem `echoCancellation: false`
(WebKit bug 311451, iOS 26.4). E `echoCancellation: false` devolve "stereo track with left-channel
audio only" (WebKit bug 281978). Safari não suporta `noiseSuppression` nem `autoGainControl`;
`echoCancellation` liga ou desliga todo o processamento de voz.

**ACHADO (PROVA).** O jeito de mercado de cortar a fala não é "subir o limiar", é uma **janela de
confirmação**: LiveKit usa `interruption.min_duration = 0.5s` (fala mínima pra contar como
interrupção), `false_interruption_timeout = 2.0s` (silêncio depois da suposta interrupção antes de
classificá-la como falsa) e `resume_false_interruption = true` (volta a falar de onde parou). O modo
`adaptive` — que usa um modelo de áudio pra separar interrupção real de "mm-hmm", tosse e ruído —
rejeita "51% of VAD-based barge-ins" e detecta barge-in verdadeiro mais rápido em 64% dos casos.

**EVIDÊNCIA.** `chromium.googlesource.com/chromium/src/media/+/…/base/media_switches.cc`
(fonte primária, lida 26/09/2026); `lists.w3.org/Archives/Public/public-webrtc-logs/2019May/0149.html`
(**2019 — fonte velha, tratar como indício**); `devforum.zoom.us` tópico `145288`; WebKit bugs
`311451` e `281978`; `livekit.com/blog/adaptive-interruption-handling` e
`docs.livekit.io/agents/logic/turns/tuning`.

**RISCO.** O R2 do plano aposta em `echoCancellation` do navegador + detector surdo. A segunda
metade é a que segura; a primeira provavelmente não cobre o `<audio>` do `reprodutor-unico.ts` no
Chrome. Não achei confirmação de que o Chrome-wide AEC esteja ligado por padrão em 2025–2026: ele
ainda aparece como opção em `chrome://flags` (Chrome 139 / Edge 139) com valor "Default", e um post
da própria Chrome for Developers sobre AEC nativo é de **2018** e trata de outra coisa. Ou seja:
não conte com ele.

**RECOMENDAÇÃO.** Duas saídas, nesta ordem: (a) **fone de ouvido** — resolve 100% e custa zero de
código; (b) meio-duplex de verdade (surdo enquanto fala), que é o *fallback* que a própria indústria
admite. Se um dia quiser full-duplex no Chrome, o caminho é rotear a reprodução por um
`RTCPeerConnection` de loopback — caro e frágil; não recomendo agora. E trocar "limiar mais alto" da
fatia 2 por `min_duration` + `false_interruption_timeout` + retomar de onde parou. Confiança ALTA no
diagnóstico; MÉDIA na recomendação de barge-in (baseada em fonte de 2019 para Safari).

---

## 4. Cérebro lento — como disfarçam 5 a 60 s

**ACHADO (PROVA, e é contraintuitivo).** A OpenAI **não** recomenda muleta falada. O guia oficial
dela diz pra manter as confirmações que a tarefa exige, pausar a camada de voz, oferecer um botão
"Resume conversation" e usar um evento de conclusão do backend pra iniciar nova sessão avisando que
o resultado ficou pronto. A única antecipação que ela sugere é "start a speculative lookup from
transcript fragments" — começar a busca antes de o texto fechar.

**ACHADO (PROVA).** Quem faz o disfarce como produto é a Inworld, e o desenho tem nome: *back-channel*
(inglês, "canal de volta" — "uh-huh", "right", enquanto o usuário ainda fala) e *responsiveness*
(muletas tipo "let me think" depois que o turno fecha). Os parâmetros são finos e valem copiar:
`initial_wait_timeout_ms` (quanto esperar o primeiro pedaço do LLM antes de soltar a muleta),
`hard_deadline_ms`, `min_filler_gap_ms`, `max_initial_per_turn`, `pause_text`.

**ACHADO (PROVA).** O outro eixo é **falar em pedaços**. É o que a cascata faz: agregação de frase
(LiveKit e Pipecat têm o mesmo `SentenceAggregator`) e TTS em blocos — a KugelAudio publica presets
`[50, 100, 150, 250]` e avisa pra **não** dar descarga a cada frase (cada flush paga prefill e cache
frio). A `vocal-stack` detecta travamento com `stallThresholdMs: 700` e injeta muleta, mas **só antes
do primeiro bloco**. A thinnestAI usa som de "pensando" em volume baixo sob o TTS, disparado por
eventos da sessão.

**EVIDÊNCIA.** `developers.openai.com/api/docs/guides/voice-latency-cost` (verificado 26/09/2026);
`docs.inworld.ai/realtime/provider-data`; README da `vocal-stack`; `docs.kugelaudio.com`;
`docs.thinnest.ai/docs/voice/ambience`.

**RISCO.** O plano (item 4 + R5) toca cada texto assim que chega e mostra "pensando" **na tela** —
mas quem está de fone, ouvindo, não vê tela nenhuma. Silêncio de 60 s sem nenhum som é
indistinguível de conexão morta, e o Rica desliga. Esse é o furo real, não a latência.

**RECOMENDAÇÃO.** Três camadas, na ordem em que ele as percebe: (1) confirmação sonora imediata ao
mandar o turno (um tique curto basta — é o equivalente falado do "pensando" na tela); (2) muleta
falada se o primeiro texto não chegar em ~5 s, no máximo uma por turno; (3) aviso explícito se
passar de ~20 s ("ainda estou trabalhando"). E **nunca** ler markdown, caminho de arquivo ou bloco de
código em voz alta — o texto que chega do Claude Code é cheio disso. Confiança MÉDIA-ALTA.

---

## 5. iOS Safari

**ACHADO (PROVA).** Três armadilhas separadas, e a terceira é a que mata:
1. `getUserMedia` precisa ser chamado **dentro do gesto, no mesmo tick** — não depois de `await`,
   `setTimeout` ou em ciclo de vida. E o diálogo de permissão **não conta como gesto**: `resume()`
   do `AudioContext` depois que ele resolve é rejeitado. HTTPS é obrigatório.
2. Autoplay não funciona com **Modo de Baixo Consumo** ligado. O `AudioContext` criado fora do gesto
   fica suspenso pra sempre no iOS — silêncio total.
3. **Tela bloqueada e troca de app cortam o microfone.** É contrato de plataforma, não falha:
   "browsers do not let pages capture microphone audio once the page becomes hidden or the screen
   locks", e um *service worker* **não pode** tocar no microfone. O truque do laço de áudio silencioso
   não funciona mais em iOS Safari nem Android Chrome modernos. O kernel iOS registra isso como
   `mic_silent_while_desired_on` e a sessão parece ter caído por rede.

**ACHADO (PROVA).** O contorno oficial é a **Screen Wake Lock API** (tela sempre acesa), disponível
no Safari 16.4+, exigindo re-aquisição no `visibilitychange` — o navegador solta o lock quando a
página some. Um relato de fórum descreve entrada de voz morrendo "after about thirty seconds on
Safari". O WebKit também suspende captura que não alimenta um pipeline ativo.

**EVIDÊNCIA.** `stackoverflow.com/questions/79810064` (mic com aparelho bloqueado);
`developer.apple.com/forums/thread/774239` ("Safari Should Allow Background WebRTC for Real-Time
Audio Apps"); `community.livekit.io` tópico `1649`; blog `widget-chat.com/fix-getusermedia-ios-safari`;
README do Pacote de Compatibilidade da Flashphoner (Low Power Mode). Verificado 26/09/2026.

**RISCO.** O R1 do plano trata o problema como "autoplay precisa de gesto". Esse é o menor dos três.
O maior é: **com a tela bloqueada a conversa acaba em silêncio**, sem erro visível, e o usuário
acha que o Zé travou. Não existe caminho de navegador pra ouvir com o aparelho no bolso — só app
nativo com permissão de áudio em segundo plano.

**RECOMENDAÇÃO.** Entrar no plano, na fatia 1: pedir Wake Lock junto com a permissão de microfone,
re-adquirir no `visibilitychange`, e **avisar na tela e por som** quando a captura cair. E não
prometer "microfone aberto por minutos" como característica — prometer só enquanto a tela está
acesa. Confiança ALTA.

---

## 6. Custo — mandar áudio só quando há fala é prática comum?

**ACHADO (PROVA).** A premissa "só enviar fala economiza" **vale em alguns provedores e não em
outros**, e a OpenAI não é claramente o caso que ajuda. O Deepgram afirma o bom caso: com *keep-alive*
e sem pacote de áudio, "we will not charge since we are not processing any audio". Já a IBM afirma o
mau caso: "You are charged for the duration of all data that you send to the service, including
silence that you send to extend the session." E a própria doc de custo da OpenAI, sobre a voz
full-duplex, diz: "Active session time includes time when the user speaks, the assistant speaks,
both are silent, or the backend is working" — e "Muting microphone input does not close the
session". Fechar, sim, economiza: "Closing saves $0.05 per minute of idle voice time."

**ACHADO (PROVA).** Preço conferido na doc oficial: `gpt-live-transcribe` US$ 0,017/minuto, unidade
declarada como "Realtime audio duration — minute". A doc **não define** se "duration" é o áudio
transmitido ou o tempo de sessão aberta — as duas leituras cabem no texto. Um fio da comunidade do
LiveKit tem as duas respostas contraditórias sobre o STT em WebSocket: um diz que só se paga o áudio
enviado, outro que "muting the stream, or not sending audio won't affect your STT usage".

**ACHADO (PROVA).** Armadilhas de sessão longa, todas relevantes pra nós: a sessão do Realtime
**expira** (limites de 15 → 30 → 60 minutos aparecem conforme a época, sempre sem *reconnect* nem
retomada), o servidor manda *ping* de 20 s e derruba quem não responde, e reconectar exige cunhar
token novo — com TTL de 600 s, como já medimos no §11.

**EVIDÊNCIA.** `developers.openai.com/api/docs/models/gpt-live-transcribe` e
`…/guides/voice-latency-cost`; `github.com/orgs/deepgram/discussions/421`; doc de STT da IBM;
`community.livekit.io` tópico `710`; `github.com/pipecat-ai/pipecat/issues/3170` (60 min no Realtime).
Verificado 26/09/2026.

**RISCO.** O R3 do plano trata o gate por VAD como economia garantida. Se a OpenAI faturar por
**tempo de sessão aberta** — e o comportamento dela no produto irmão aponta nessa direção —, o gate
economiza **zero** e a arquitetura toda fica pagando silêncio. Além disso, com o cérebro levando
minutos, a sessão de transcrição fica aberta ociosa justamente na fase mais longa da conversa.

**RECOMENDAÇÃO.** Não decidir por literatura: medir. Um teste de 10 minutos com ~1 minuto de fala
no `gpt-live-transcribe` e a leitura do `usage` diz a verdade em uma rodada. E, independente do
resultado, desenhar já pensando em **fechar a sessão de transcrição durante a fase "esperando o
Zé"** e cunhar token por turno — resolve de uma vez o custo ocioso e o teto de duração da sessão.
Confiança ALTA no risco de faturamento por tempo; BAIXA em qual dos dois é o caso da OpenAI hoje.

---

## Onde o plano do Daniel diverge — item por item

1. **Detector de fim de fala (item 1).** Plano: energia + ~900 ms. Divergência real: a lib de
   referência do navegador usa 1400 ms e os frameworks de produção usam atraso mínimo de 500 ms
   **mais** um modelo semântico. 900 ms vai cortar quem respira no meio da frase.
2. **Arquitetura (itens 1 e 2).** Plano: VAD e máquina de estados no navegador, cérebro atrás.
   Divergência: LiveKit e Pipecat põem tudo no servidor. Não é erro — o nosso cérebro não é um LLM
   de turno, é o Claude Code —, mas significa que **não herdamos** transporte, reconexão e eco
   prontos. O plano precisa cobrir isso à mão.
3. **Eco (R2).** Plano: `echoCancellation` do navegador + detector surdo. Divergência forte: no
   Chrome o AEC **não** cobre áudio tocado por `<audio>`, e o recurso que cobriria está desligado
   por padrão. A metade que funciona é a segunda. Fone de ouvido resolve melhor que código.
4. **Fala por cima (item 5, fatia 2).** Plano: "limiar mais alto". Divergência: o padrão é janela de
   confirmação — 500 ms de fala pra valer como interrupção, 2 s de silêncio pra desclassificá-la, e
   retomar de onde parou. Subir limiar sem isso dá agente que se cala com tosse ou que não se cala
   quando devia.
5. **Espera do Zé (item 4 + R5).** Plano: "pensando" na tela + tocar cada texto conforme chega.
   Divergência: falta o **canal de áudio**. Quem só ouve não vê a tela. Falta confirmação sonora
   imediata e aviso falado de demora.
6. **iPhone (R1).** Plano: o toque destrava a primeira fala; o resto "precisa ser testado no
   aparelho dele". Divergência: o problema maior não é autoplay, é a **tela bloquear e o microfone
   morrer** por contrato da plataforma. Wake Lock precisa entrar no plano, não no teste.
7. **Custo (R3).** Plano: gate por VAD economiza. Divergência: plausível, **não provado** para a
   OpenAI — o que a doc dela comprova é que fechar a sessão economiza. Falta a medição.
8. **Fatias.** Estrutura de fatia 1 e 2 me parece bem cortada; não achei divergência de desenho.
   O ponto de atenção é a prova declarada: "conversa de 3 turnos com um Zé na 3009" **não cobre**
   tela bloqueada, eco de alto-falante nem queda de WebSocket — os três riscos que a comunidade mais
   relata e que só aparecem em uso real, não em teste de bancada.

---

## Furos no próprio briefing (o Daniel pediu pra apontar)

- **A pergunta 3 está mal posta.** Ela pede "o AEC cobre áudio de `<audio>` ou só WebRTC?". A
  resposta útil não é sim/não: é "depende do navegador, e no Chrome depende de um flag experimental
  desligado por padrão". Sugiro reescrever como decisão: *assumimos meio-duplex e pronto*.
- **A pergunta 6 pede literatura quando cabe medição.** Preço e comportamento de faturamento da
  OpenAI a gente resolve com 10 minutos de chave real, como foi feito no §11 — e com mais certeza
  do que qualquer blog.
- **Falta uma pergunta: o que acontece quando o WebSocket de transcrição cai no meio.** O §5 do doc
  de fala trata isso pra gravação manual, mas o modo conversa tem outro regime — falha silenciosa
  aqui é conversa morta, e a máquina de estados do item 2 precisa de uma saída explícita pra isso.

---

## Onde eu não consegui confirmar

- **Chrome-wide AEC ligado por padrão hoje?** Não achei status de campo nem nota recente — só o flag
  em `chrome://flags` em 2025 e um post de 2018 sobre outra coisa.
- **`gpt-live-transcribe` fatura por áudio transmitido ou por tempo de sessão?** A doc não define, a
  comunidade se contradiz, e o produto irmão da OpenAI aponta para tempo.
- **Quanto o Safari cancela de áudio da própria página?** A única fonte é uma mensagem de lista de
  2019. Medir no iPhone do Rica é mais rápido que pesquisar.
- **Latência por etapa do LiveKit:** a doc compara em palavras ("Moderate/Fastest"), sem número.
