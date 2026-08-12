# Voz de volta — pesquisa de engines (canário, 11/08)

Pergunta do Rica: o cockpit v2 vai **responder em áudio**. Decidir com pesquisa, não com chute. Esta é a frente de estado da arte: o que já temos, as opções de engine comparadas, streaming vs blob, voz nativa e custo real.

**Contexto que assumi como dado** (levantado pelo Daniel): `apps/api/routers/tts.py` expõe `POST /api/tts/synth` com Google Cloud TTS **Chirp3-HD** (voz por slug do agente, fallback Microsoft edge-tts), devolve áudio completo (blob, MP3), não streaming. STT de entrada já resolvido. O cockpit v2 não tem saída em áudio.

---

## 1. O problema real não é a engine — é a entrega

Hoje o Rica espera o áudio **inteiro** ser sintetizado antes de ouvir o primeiro som. O `text:synthesize` da Google é **síncrono**: "recebe resultados depois que todo o texto foi processado" ([doc REST](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize)). Para uma resposta de ~150 palavras (≈15 sentenças), isso é **~10s de espera muda — medido pela Tara** no endpoint real da :8000 (3 execuções: 10,36s · 10,34s · 9,93s), não estimativa minha.

O padrão maduro da indústria não é trocar de engine: é **streaming por sentença**. Dividir o texto, sintetizar a primeira sentença e já entregar o áudio enquanto o resto é gerado. O primeiro som passa a ser o tempo da **primeira** sentença (~1s), não do texto inteiro. É assim que ElevenLabs e OpenAI entregam o "primeiro chunk em centenas de milissegundos" ([ElevenLabs: tempo até o primeiro áudio ≈ tempo de sintetizar o primeiro chunk](https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming); [OpenAI: playback começa antes do arquivo completo](https://developers.openai.com/api/docs/guides/text-to-speech)).

Três caminhos de entrega no navegador, do mais simples ao mais fino:

- **`<audio>` com reprodução progressiva** (o mais simples e o que recomendo): o elemento de áudio com `src` apontando pra rota de streaming toca o MP3 enquanto baixa. Funciona no Safari do iPhone com MP3. Zero código novo de player.
- **Media Source Extensions (MSE)**: o navegador monta um `SourceBuffer` (`audio/mpeg`) e você anexa os pedaços conforme chegam — buffer fino, playback sem gap, controle de underrun. É o padrão maduro quando o streaming é chunked e você quer robustez ([MDN — Media Source Extensions API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)). Recomendado como evolução, não como primeira versão.
- **Web Audio API + PCM cru**: menor latência possível, mas o áudio precisa ser PCM sem header (tipo o LINEAR16 24kHz do StreamingSynthesize da Google) e o player precisa de `AudioContext` — mais código, só se a régua virar "sub-300ms de verdade".

Ponto técnico que importa: **MP3 é feito de frames autossuficientes**, então concatenar sentenças sintetizadas separadas num único stream MP3 toca limpo (pode haver micro-pausa natural entre sentenças — geralmente desejada). Não precisa de re-encode.

---

## 2. StreamingSynthesize da Google — existe, mas é gRPC e PCM

A Google tem streaming nativo: `StreamingSynthesize`, streaming **bidirecional** — você manda texto e recebe áudio progressivamente ([RPC reference v1](https://docs.cloud.google.com/text-to-speech/docs/reference/rpc/google.cloud.texttospeech.v1)). Detalhes que decidem a escolha:

- O input aceita `text` com sentenças completas — "frases completas e terminadas geram melhor prosódia". Ou seja: **serve sim pra texto pronto**, não só pra fluxo em tempo real.
- O áudio volta como **LINEAR16, 24kHz, sem header** — não é MP3. Pro navegador, ou embrulha em WAV, ou manda PCM pra Web Audio. Mais complexo que servir MP3.
- É **só gRPC** — não existe equivalente REST; a reference REST do v1 expõe apenas `text:synthesize` (blob) e `text:synthesizeLongAudio` (textos longos). Nosso `tts.py` usa REST via `httpx`, então adotar StreamingSynthesize é adicionar o client `google-cloud-texttospeech` (gRPC) no backend.

**Veredito sobre a pergunta:** o StreamingSynthesize resolve o problema, mas o **chunking por sentença sobre a REST que já temos resolve o mesmo problema com bem menos código** — e mantém MP3, que o `<audio>` reproduz progressivamente sem player novo. StreamingSynthesize fica guardado como a evolução se o Rica quiser sub-300ms.

---

## 3. As engines, comparadas em pt-BR

Régua: latência até o primeiro som, qualidade em português do Brasil, custo por minuto, e se precisa instalar coisa nova.

### Google Chirp3-HD — o que já temos
- **Qualidade pt-BR: a referência.** Vozes brasileiras nativas dedicadas (`pt-BR-Chirp3-HD-Orus` etc.) — é a voz que a frota já usa no Telegram. Trocar de engine = a tropa perde a identidade vocal.
- **Latência:** sem streaming nativo na REST — sintetiza tudo antes. Primeiro som = texto inteiro. (Resolvível por chunking, ver seção 1.)
- **Custo:** US$ 30 por 1 milhão de caracteres, confirmado contra a página oficial em jun/2026 ([texttolab](https://texttolab.com/blog/google-cloud-tts-pricing), página oficial [cloud.google.com/text-to-speech/pricing](https://cloud.google.com/text-to-speech/pricing)). **1 milhão de caracteres grátis por mês** — ~1.000 respostas de 150 palavras sem pagar nada.
- **Instalação:** nenhuma — o código já está pronto.

### OpenAI gpt-4o-mini-tts
- **Qualidade pt-BR: ok, mas é o ponto fraco.** As 13 vozes são "otimizadas para inglês; o texto em outros idiomas funciona" ([guia oficial](https://developers.openai.com/api/docs/guides/text-to-speech)). Não achei fonte de avaliação dedicada de pt-BR; a régua honesta é "funciona, sem garantia de sotaque fino".
- **Latência: ótima.** Streaming nativo por chunks (`stream_format: audio`) ou SSE (`stream_format: sse`), primeiro chunk em ~300–600ms, playback começa antes do arquivo completo ([guia](https://developers.openai.com/api/docs/guides/text-to-speech)). Máximo 4.096 caracteres por chamada.
- **Custo:** ~US$ 15 por milhão de caracteres (~US$ 0,015/min) ([texttolab — OpenAi TTS pricing](https://texttolab.com/blog/openai-tts-pricing)). Mais barato que a Google, mas com vozes genéricas.
- **Instalação:** SDK novo (`openai`), chave nova. E precisa mapear as 7 vozes da frota pra vozes novas — a identidade vocal muda.

### ElevenLabs
- **Qualidade pt-BR: excelente** — `eleven_multilingual_v2` é referência em português. Flash models com ~75ms de inferência ([latency optimization](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization)).
- **Latência: a melhor do grupo.** Streaming por HTTP chunked (`/v1/text-to-speech/{voice}/stream`), parâmetro `optimizeStreamingLatency` 0–4, ~150–250ms de TTFB (time-to-first-audio) em regiões geograficamente próximas ([conceito de streaming](https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming)).
- **Custo: o mais caro.** API avulsa: Flash US$ 60/1M caracteres, Multilingual v2 US$ 120/1M; planos com assinatura mensal (Starter US$ 5 com 30k créditos) ([texttolab — ElevenLabs pricing](https://texttolab.com/blog/elevenlabs-pricing)). Para volume interno baixo, o custo fixo não compensa.
- **Instalação:** SDK/chave novos. Identidade vocal nova (ou clonagem da voz Chirp3 — trabalho extra).

### Microsoft edge-tts — o fallback que já temos
- **Qualidade pt-BR: boa** (vozes `pt-BR-Francisca/Antonio` Neural).
- **Latência: streaming nativo** — o `communicate.stream()` do código atual já rende chunks de áudio progressivamente enquanto gera. É a prova de que streaming no nosso backend é barato de fazer.
- **Custo: zero.**
- **Instalação:** nenhuma — está no código.
- **Risco:** é uso não-oficial dos endpoints do Edge (sem SLA), pode quebrar a qualquer momento. Serve como fallback (como está hoje), não como engine principal.

### Locais: Kokoro e Piper
- **Kokoro** (82M parâmetros, Apache-2.0): tem vozes **pt-BR** nativas (`pf_*` feminina, `pm_*` masculina), mas o inglês é o idioma mais polido — pt-BR "existe e funciona", sem avaliação dedicada ([hexgrad/kokoro](https://github.com/hexgrad/kokoro), [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx)). Roda em CPU ~6× mais rápido que a reprodução (0,16× RTF num M3 Pro); versão int8 (~90MB) para CPU. Instala: `pip install kokoro-onnx` + modelos + espeak-ng.
- **Piper**: voz pt-BR oficial `pt_BR-cadu-medium` (finetune do inglês "lessac", CC0) — qualidade "média", VITS (~63MB) ([rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices)). Leve o bastante pra Raspberry Pi. Instala: `pip install piper-tts` + modelo.
- **O problema comum a ambos:** competiriam pelos **2 vCPU da VPS** com os 6 agentes da frota — e a Hostinger **limita CPU automaticamente** quando a VPS sustenta carga alta por ~180min (memória `hostinger-limitacao-cpu`). Sintetizar em CPU na mesma máquina da frota é disputar o mesmo recurso que já vive apertado. E a identidade vocal da tropa se perde mesmo assim (vozes novas).

**Resumo em uma linha por engine:**
- **Chirp3-HD**: melhor pt-BR + voz da frota + streaming via chunking. É o que temos.
- **gpt-4o-mini-tts**: streaming nativo barato, mas pt-BR sem garantia e voz muda.
- **ElevenLabs**: melhor latência e pt-BR, custo fixo alto, voz muda.
- **edge-tts**: streaming grátis de fallback, não-oficial.
- **Kokoro/Piper**: grátis e local, mas disputam CPU da frota e pt-BR é secundário.

---

## 4. Voz nativa (Realtime / gpt-4o-audio-preview) — não faz sentido aqui

O Rica abriu a porta pra alternativa melhor que "texto vira MP3": o agente falando direto, sem passar por texto. Analisei com honestidade:

- **O que é:** modelos que geram áudio como modalidade própria — `gpt-4o-audio-preview` (texto/áudio como input → áudio de saída, via Chat Completions/Responses) e a **Realtime API** (fala-para-fala em tempo real, WebSocket, duplex).
- **Por que não faz sentido AQUI:** os agentes são **Claude Code e Codex**, modelos que não têm modalidade de áudio. O texto da resposta **já está decidido e pronto no JSONL**. Pra "falar com voz nativa" teríamos que re-passar o texto pronto pra um modelo de áudio — o ganho seria só a prosódia que o texto não carrega, marginal pra "ler a resposta do agente". E o `instructions` do gpt-4o-mini-tts (tom, emoção, ritmo) já entrega esse controle por centavos.
- **Custo ~2.000× maior:** gpt-4o-audio-preview cobra US$ 80 por milhão de tokens de áudio de saída ([openrouter — gpt-4o-audio-preview](https://openrouter.ai/openai/gpt-4o-audio-preview)); Realtime mini US$ 20/M, flagship US$ 64/M ([futureagi — Realtime](https://futureagi.com/llm-cost-calculator/openai/gpt-4o-realtime-preview/)). Nossa régua é custo por resposta — e a diferença é de centavos por **milhar** de respostas.
- **Latência e infra:** modelo completo rodando + WebSocket + conexões simultâneas com rate limit. Mais lento e mais complexo que TTS dedicado em streaming.

**Veredito:** voz nativa faz sentido quando o modelo que *decide a resposta* é o mesmo que *fala* (assistente de voz de ponta a ponta). Não é o nosso caso: quem decide é Claude/Codex (sem voz), o texto existe. É trocar TTS de US$ 0,00003 por um multimodal de US$ 0,07 com roupa de inovação. **Recomendo não seguir** — mas registrado como o Norte caso um dia os agentes virem modelos de voz nativa.

---

## 5. Custo real por resposta típica (~150 palavras ≈ 1.000 caracteres ≈ 45s de fala)

- **Google Chirp3-HD**: **US$ 0,00003** (US$30/M). E os primeiros 1M chars do mês são grátis.
- **OpenAI gpt-4o-mini-tts**: **US$ 0,000015** (~US$15/M).
- **ElevenLabs**: **US$ 0,00006** (Flash) a **US$ 0,00012** (Multilingual v2) — mais a assinatura mensal mínima.
- **edge-tts**: **US$ 0,00**.
- **Kokoro/Piper (local)**: **US$ 0,00** em software — custo real é a CPU da frota que eles disputam.
- **Voz nativa** (`gpt-4o-audio-preview`): **US$ 0,072** por resposta (900 tokens de áudio × US$80/M, assumindo 20 tokens/s — régua do Realtime; não achei fonte exata de conversão pro preview). **Realtime mini**: ~US$ 0,018 só de áudio de saída.

A régua de decisão honesta: custo **não é** o fator que decide — todas as opções de TTS custam centavos por **milhar** de respostas. O que decide é **latência, qualidade pt-BR e não quebrar a voz da frota**.

---

## 6. Duração antes do fim — o contratempo do streaming

Pergunta que decide o contrato da rota: a UI precisa saber a **duração** do áudio antes de ele terminar de chegar (barra de progresso, arrastar pra posição, onda sonora). No streaming chunked, o `<audio>` não sabe a duração até o fim do stream. O que os padrões oferecem:

- **`HTMLMediaElement.duration` retorna `Infinity`** em stream sem duração conhecida (live/streaming), e `loadedmetadata` não garante duração finita — o valor real só aparece quando o stream fecha ([MDN — HTMLMediaElement.duration](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/duration)).
- **Não existe header HTTP padrão de duração.** `Content-Duration` é definida em **RFC 3803 como header MIME** (para conteúdo `audio/*`/`video/*`), não como header HTTP; a tentativa de usá-la no HTTP foi uma proposta *provisional* da Xiph.org que nunca entrou no padrão, e a antecessora `X-Content-Duration` foi deprecada — só o Firefox antigo a lia ([RFC 3803](https://datatracker.ietf.org/doc/rfc3803/), [wiki Xiph — ContentDuration](https://wiki.xiph.org/index.php?title=ContentDuration)).
- **MP3 só expõe a duração no início se o encoder gravar a tag Xing/Info** (contagem de frames na primeira frame do arquivo). O encoder precisa saber o total *antes* de codificar — num TTS streaming incremental ele não sabe, então a tag não vem ([como calcular duração de VBR MP3 sem baixar tudo](https://stackoverflow.com/questions/41732725/how-to-calculate-bitrate-for-a-vbr-mp3-without-downloading-the-entire-file/42018122#42018122)).
- **MSE não fornece a duração — ele a recebe.** Com Media Source Extensions você seta `mediaSource.duration` quando o total é conhecido (aí barra e seek funcionam) e usa `setLiveSeekableRange` para limitar o seek em stream "live"; sem o total conhecido, MSE não adivinha ([MDN — MediaSource](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource)).

**Veredito: duração exata antes do fim não é entregue por nenhum padrão de streaming de áudio.** O máximo que o streaming entrega:

- **Estimativa** — o backend calcula no início (contagem de caracteres calibrada pela velocidade real da voz: a 1ª sentença sintetizada mede a velocidade e projeta o total), manda como header customizado (ex. `X-Estimated-Duration`) ou como primeiro evento; a barra nasce com a estimativa e **corrige pro valor real quando o stream fecha** (o `duration` fica finito no fim).
- **Duração exata antecipada só se o backend souber o total antes** — sintetizar tudo primeiro (blob: volta aos ~10s de espera) ou resposta em duas etapas (endpoint de metadata que sintetiza e reporta a duração; depois o áudio). As duas anulam o ganho de primeiro som.

**Consequência pro contrato (achado pro Rica/Hiro):** se a UI precisar da onda sonora com duração correta *antes* de tocar, streaming puro não atende. A decisão é: (a) aceitar **estimativa + correção no fim**, ou (b) primeira versão em **blob** e streaming numa segunda fase. Se a onda puder ser desenhada conforme o áudio chega (progressiva, do que já foi decodificado), streaming + estimativa resolve — a barra estica conforme a duração se confirma. É trabalho de UI, e é a pergunta que fecha o contrato da rota com o Hiro.

---

## 7. Recomendação

**Manter o Google Chirp3-HD (a voz da frota, pt-BR nativo) e resolver a latência por streaming no servidor — o backend divide o texto em sentenças, sintetiza e devolve o áudio progressivamente via `StreamingResponse` (chunked HTTP), com o `<audio>` do navegador fazendo reprodução progressiva (MSE como evolução).** Primeiro som em ~1s em vez de ~10s (medido pela Tara), sem trocar engine, sem instalar nada, sem custo novo e sem mudar a identidade vocal de cada agente.

**Motivo em três linhas:** a dor do Rica é esperar o áudio inteiro — e isso se resolve na entrega, não na engine. O Chirp3-HD já é o melhor pt-BR, custa praticamente zero e é a voz que a tropa já tem; o chunking por sentença (mesma REST que já usamos) corta o primeiro som pra ~1s. Só subo a régua pra StreamingSynthesize (gRPC, sub-300ms) ou gpt-4o-mini-tts se o Rica pedir latência menor que isso — aceitando, no segundo caso, trocar a voz da frota.

**Próximo passo sugerido:** rota `POST /api/tts/synth/stream` com o mesmo contrato do `tts.py` atual (voz por slug, fallback edge), generator de sentenças, `StreamingResponse` MP3. Vou implementar e medir o tempo até o primeiro som antes de soltar.

---

## Fontes

- [Google REST `text:synthesize` (síncrono, gera tudo antes)](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize)
- [Google `StreamingSynthesize` (gRPC bidi, LINEAR16 24kHz sem header)](https://docs.cloud.google.com/text-to-speech/docs/reference/rpc/google.cloud.texttospeech.v1)
- [Google Cloud TTS pricing (Chirp3-HD US$30/M, 1M grátis/mês)](https://cloud.google.com/text-to-speech/pricing) — números confirmados em [texttolab, verificados contra a página oficial jun/2026](https://texttolab.com/blog/google-cloud-tts-pricing)
- [OpenAI — Text to speech (streaming, vozes otimizadas p/ inglês, 4.096 chars)](https://developers.openai.com/api/docs/guides/text-to-speech)
- [OpenAI gpt-4o-mini-tts pricing (~US$15/M)](https://texttolab.com/blog/openai-tts-pricing)
- [ElevenLabs — audio streaming (primeiro chunk ≈ primeira síntese)](https://elevenlabs.io/docs/eleven-api/concepts/audio-streaming)
- [ElevenLabs — latency optimization (Flash ~75ms, TTFB 150–250ms)](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization)
- [ElevenLabs pricing (US$60–120/M, planos)](https://texttolab.com/blog/elevenlabs-pricing)
- [edge-tts (uso não-oficial dos endpoints Edge)](https://github.com/rany2/edge-tts)
- [Kokoro — 82M, Apache-2.0, vozes pt-BR `pf_*`/`pm_*`](https://github.com/hexgrad/kokoro)
- [kokoro-onnx (wrapper CPU, int8 ~90MB)](https://github.com/thewh1teagle/kokoro-onnx)
- [Piper — voz pt-BR oficial `pt_BR-cadu-medium`](https://huggingface.co/rhasspy/piper-voices)
- [OpenAI gpt-4o-audio-preview (US$40/M input, US$80/M output de áudio)](https://openrouter.ai/openai/gpt-4o-audio-preview)
- [OpenAI Realtime pricing (mini US$20/M out, flagship US$64/M)](https://futureagi.com/llm-cost-calculator/openai/gpt-4o-realtime-preview/)
- [MDN — Media Source Extensions API (buffer progressivo de áudio)](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)
- [MDN — HTMLMediaElement.duration (Infinity em stream sem duração conhecida)](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/duration)
- [RFC 3803 — Content-Duration definida como header MIME, não HTTP](https://datatracker.ietf.org/doc/rfc3803/)
- [wiki Xiph — ContentDuration (proposta HTTP provisional, nunca entrou no padrão)](https://wiki.xiph.org/index.php?title=ContentDuration)
- [Duração de VBR MP3 — a tag Xing/Info exige saber o total antes de codificar](https://stackoverflow.com/questions/41732725/how-to-calculate-bitrate-for-a-vbr-mp3-without-downloading-the-entire-file/42018122#42018122)
- [MDN — MediaSource.duration (só seta a duração quando o total é conhecido)](https://developer.mozilla.org/en-US/docs/Web/API/MediaSource)
