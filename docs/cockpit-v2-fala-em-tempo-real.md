# Cockpit V2 — fala em tempo real (transcrição ao vivo)

> Investigação pedida pelo Daniel em 20/08/2026, respondida a ele nominalmente. Não toca em `apps/`.
> Objetivo: transcrever ENQUANTO o Rica fala no composer, palavra por palavra, como o claude.ai faz — com o consumidor (agente) ocupado ou não.

---

## 1. Veredito em uma linha

**Caminho recomendado: browser → OpenAI Realtime direto, com ephemeral token, áudio PCM16 24 kHz, e o caminho de arquivo de hoje como queda-livre.** O back não precisa de WebSocket nenhum — só de uma rota REST nova que cunha o token curto. Deepgram Nova-3 é o drop-in mais barato (mesmo formato de encanamento) se o preço ou a estabilidade da doc do OpenAI incomodar.

---

## 2. As APIs de STT em tempo real hoje — com `curl` e preço de tabela

### 2.1 OpenAI Realtime — transcrição ao vivo (`gpt-live-transcribe` / `gpt-realtime-whisper`)

**O que é:** a API Realtime ganhou sessão de transcrição dedicada (não é o modelo de conversa). A doc oficial (guides/realtime-transcription) descreve:

> "Connect with WebSocket for server-side audio pipelines or WebRTC for browser audio."
> https://developers.openai.com/api/docs/guides/realtime-transcription

- **Formato aceito:** PCM16 mono little-endian 24 kHz, base64. A doc configura `"format": {"type": "audio/pcm", "rate": 24000}` e envia via `input_audio_buffer.append`. A API reference confirma: "The Realtime API supports PCM audio at a 24kHz sample rate." (https://developers.openai.com/api/reference/resources/realtime)
- **Devolve parcial além do final? Sim.** Eventos `conversation.item.input_audio_transcription.delta` (texto novo conforme fala) e `.completed` (transcrição final). Aviso da doc: "Ordering between completion events from different speech turns isn't guaranteed. Use `item_id` to match transcription events to committed input items."
- **VAD do lado do servidor? Sim.** "To let the server detect and commit turn boundaries, configure voice activity detection instead." (a alternativa é `"turn_detection": null` + commit manual via `input_audio_buffer.commit`). Nuance da API reference: turn detection "must be disabled for `gpt-realtime-whisper` transcription sessions" — no modelo de transcrição, VAD automático nem sempre é permitido; o `gpt-live-transcribe` da doc usa commit manual no exemplo.
- **Autenticação browser:** ephemeral secret, nunca a chave. A doc mostra o browser conectando com subprotocolo `openai-insecure-api-key.<token>` (https://developers.openai.com/api/docs/guides/realtime-websocket), com a ressalva: "in client-side environments like web browsers, we recommend using WebRTC instead."
- **Preço (tabela oficial, por minuto):** `gpt-live-transcribe` **US$ 0,017/min**; `gpt-realtime-whisper` ("Live transcription") **US$ 0,017/min**; referência: `gpt-transcribe` (arquivo, o que o script de hoje usa) **US$ 0,0045/min**. Fonte: https://developers.openai.com/api/docs/pricing

**Confirmado com `curl` (sem chave, distinguindo "existe" de "não existe"):**

| Endpoint | Resposta | Leitura |
|---|---|---|
| `POST /v1/realtime/client_secrets` | 401 "Missing bearer…" | **existe** (é a rota do ephemeral token) |
| `POST /v1/realtime/translations` | 401 | **existe** |
| `POST /v1/realtime` | 401 | **existe** |
| `POST /v1/realtime/sessions` | 404 "Invalid URL" | **NÃO confirmado** (doc descreve) |
| `POST /v1/realtime/transcription_sessions` | 404 "Invalid URL" | **NÃO confirmado** (doc descreve) |
| `POST /v1/audio/transcriptions` | 401 | existe (caminho de arquivo de hoje) |

> ⚠️ A doc oficial e a OpenAPI spec descrevem `/v1/realtime/sessions` e `/v1/realtime/transcription_sessions` como criadores de sessão com `client_secret`, mas a API viva respondeu 404 "Invalid URL" nas duas — sem chave não dá para fechar a divergência. Ver §8 (o que não confirmei).

### 2.2 Deepgram Nova-3 — alternativa mais barata, STT puro

- **Endpoint WS:** `wss://api.deepgram.com/v1/listen` com parâmetros `model`, `interim_results`, `endpointing`, `encoding`, `sample_rate`, `language`. `POST /v1/listen` respondeu 401 no curl → rota viva.
- **Devolve parcial? Sim.** `interim_results=true` → eventos com `is_final:false` (parcial) e `is_final:true` (final); `speech_final` marca a fala completa (https://developers.deepgram.com/docs/streaming).
- **VAD/endpointing:** parâmetro `endpointing` e `utterance_end_ms` do lado do servidor.
- **Ephemeral token p/ browser: existe.** `POST /v1/auth/grant` devolve `access_token` (JWT) + `expires_in`; TTL padrão 30s, máx 3600s. A doc diz: "WebSocket sessions can outlive the token TTL — the token only needs to be valid during the initial WebSocket connection." (https://developers.deepgram.com/guides/fundamentals/token-based-authentication). `POST /v1/auth/grant` respondeu 400 "Invalid credentials" no curl → rota viva. A chave não vai ao browser.
- **Preço (tabela oficial, por minuto, Nova-3):** streaming **Multilingue** US$ 0,0058/min (promocional) / US$ 0,0092/min (normal); **Monolíngue** US$ 0,0048 / US$ 0,0077. Batch multilingue US$ 0,0052. Crédito novo: US$ 200. Fonte: https://deepgram.com/pricing. Para pt-BR, a taxa conservadora é a multilingue; com `language=pt` fixo pode cair na monolíngue (não confirmei).

### 2.3 Outras que existem (preço não verificado nesta investigação)

AssemblyAI (streaming, partials), Google Cloud STT (streaming, partials), Groq (whisper via WebSocket). Não medi preço nem contrato — se precisar, é uma rodada de pesquisa à parte.

---

## 3. Por onde passa o áudio (b) — o desenho que custa MENOS encanamento

**Recomendado — browser → provider direto, token efêmero:**

```
[Microfone] → AudioWorklet (PCM16 24 kHz, base64)
        │
        └──── WS direto ────→  OpenAI wss://…/v1/realtime  (ou Deepgram wss://…/v1/listen)
        │                          ▲
[Rica] → POST /api/stt/ephemeral ──┘  (FastAPI: cunha o token, chave NUNCA sai do servidor)
```

- O back **continua sem WebSocket**: a rota nova é só `POST /api/stt/ephemeral` que chama `POST /v1/realtime/client_secrets` (OpenAI) ou `POST /v1/auth/grant` (Deepgram) e devolve `{ token, expires_at }`. O browser abre o WS contra o provider.
- **Alternativa (proxy via FastAPI) custa mais:** exigiria WebSocket no back (starlette), receber PCM16 do browser e reenviar ao provider nos dois sentidos, mais reautenticação e backpressure. Só se justifica quando o provider não tem token efêmero — não é o caso de nenhuma das duas.
- **Decisão de provider (mesmo encanamento, muda a rota de minting):**
  - OpenAI: mesmo fornecedor da casa (o STT de hoje já é OpenAI), sem chave/contrato novos. Custo ~3× o arquivo (US$ 0,017 vs US$ 0,0045/min) — para minutos/dia do Rica, centavos.
  - Deepgram: ~2–3× mais barato, STT puro e maduro, mas chave e contrato novos.

---

## 4. Captura PCM16 no browser em 2026 (c)

- **ScriptProcessorNode está deprecado** (MDN): "Avoid using this feature in new projects… replaced by AudioWorklets and the AudioWorkletNode interface." https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode
- **Caminho:** `getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true}})` → `AudioContext` → `MediaStreamAudioSourceNode` → `AudioWorkletNode` → converte Float32→Int16 → `port.postMessage` → base64 → `input_audio_buffer.append`.
- **Não confiar em `new AudioContext({ sampleRate: 24000 })`:** o iOS Safari tem bug documentado (WebKit 251350) em que o worklet entrega MENOS amostras/segundo que o rate configurado; e vários browsers ignoram o rate do `getUserMedia`. Padrão comprovado (OpenAI DevDay fórum, gptme, melody): **capturar no rate nativo e reamostrar para 24 kHz DENTRO do worklet** (interpolação simples é o suficiente para STT; reamostrador com estado + IIR low-pass para eliminar alias). Fontes: https://timetobuildbob.com/blog/voice-in-the-browser-building-real-time-audio-for-gptme/ · https://wiki.webkit.org/show_bug.cgi?id=251350
- **Firefox:** a console oficial do Realtime esbarrou em "AudioNodes from AudioContexts with different sample-rate is currently not supported" — o resample explícito no worklet resolve também.
- **A premissa de vocês sobre PCM16 se sustenta:** o descarte do webm com `start(100)` (primeiro chunk com header EBML atrasa/perde) valeria também para webm/opus em streaming — sem header o WS recebe áudio sem container e o STT morre igual. PCM16 cru não tem header: é o caminho robusto. Não reabri a medição; confirmei a lógica dela.

---

## 5. Queda de rede no meio (d)

- **O WS não recupera sozinho:** os deltas recebidos até a queda ficam no cliente; o evento `.completed` da última fala pode nunca chegar. Nenhuma das duas APIs retoma o fluxo perdido.
- **Regra do desenho:** nunca deixar meia frase sem saber. Deltas aparecem no rascunho marcados como **não confirmado** (indicador "transcrevendo…"), e o texto só vira firme quando o `.completed` (ou `is_final:true` + `speech_final`) chega para aquele `item_id`.
- **Queda no meio da captura:** buffer PCM16 fica retido no cliente (ring buffer do worklet/thread). Ao cair, empacota o buffer como WAV e despacha pelo **caminho de arquivo de hoje** (`POST /{slug}/transcription`, o que tem teto de 30s) — mesma gravação, segunda via. O Rica vê o aviso de que o tempo real caiu e o resto termina pelo caminho antigo.
- **Detalhe do provider:** o Deepgram fecha o WS após ~10s de silêncio (precisa de keepalive; fonte de prática: https://docs.openclaw.ai/providers/deepgram). O OpenAI tem política própria de idle. O desenho deve mandar keepalive/`input_audio_buffer` mínimo em silêncio.

---

## 6. Fallback (e) — sim, mesmo gesto, dois caminhos

Mantém o toque curto gravando travado (`10e3b85`) e o gesto de hoje como superfície única. Internamente: (1) WS ao vivo enquanto saudável; (2) se WS falhar ou estourar tempo sem conectar, o caminho de arquivo atual assume. Invariantes preservadas: o texto cai no **rascunho editável** (pode digitar durante a captura — `emCaptura`) e **nada é despachado sem o Rica mandar** (`mesclaTranscricao`).

---

## 7. Riscos

1. **iOS Safari + AudioWorklet** (bug 251350) — o Rica usa o cockpit no celular; é o teste que mais decide. Mitigação: reamostragem explícita no worklet.
2. **Divergência doc × API viva do OpenAI** (§2.1) — os endpoints de sessão descritos na doc respondem 404. Mitigação: spike com chave real antes de construir (15 min).
3. **Custo** — realtime é ~3× o arquivo (OpenAI) ou ~1,4× (Deepgram streaming vs batch). Irrelevante no volume do Rica (centavos/dia), relevante se virar produto.
4. **Provider novo** (se Deepgram) — chave, contrato e billing novos; o OpenAI já está na casa.
5. **VAD do modelo de transcrição** — em `gpt-realtime-whisper` o turn detection é desligado por regra; o desenho não pode depender de VAD automático, tem de suportar commit manual.

---

## 8. O que eu NÃO consegui confirmar

- **URL exata do WebSocket de transcrição do OpenAI.** A doc de conversa mostra `wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1`; a doc de transcrição não mostra a URL de conexão. Provável: `wss://api.openai.com/v1/realtime?model=gpt-live-transcribe` — **não confirmado**.
- **`POST /v1/realtime/sessions` e `/v1/realtime/transcription_sessions`** (a doc os descreve como minting de `client_secret`) retornaram 404 "Invalid URL" no curl sem chave, enquanto `client_secrets` retorna 401 (existe). Não dá para dizer se é rota morta, gated por versão ou precisa de chave. **Fica um teste de 15 min com chave real.**
- **Se o Deepgram cobra taxa monolíngue com `language=pt` fixo** (a tabela separa monolíngue/multilingue).
- **Preço e contrato de AssemblyAI / Google STT / Groq** (não pesquisei nesta rodada).
- **Comportamento exato de idle do WS do OpenAI** em silêncio prolongado (sem fonte oficial que eu tenha verificado).

---

## 9. Furos no levantamento que você me passou

- **Suas linhas batem com o repo principal, não com o canário.** Conferi em `grupo_borges`: `agents.py:3578` (`_VOICE_STT_TIMEOUT_S = 30`), `:3988` (`_transcribe_agent_audio`), `composer.tsx:421` (`mesclaTranscricao`), `usa-gravador.ts:285` (comentário do timeslice). O canário está com drift (o worklet/linha diferem) — não é erro seu, é branch.
- **`stt-openai.sh` não fica em `apps/`**: é `~/.claude/scripts/stt-openai.sh` (casa nova) ou o caminho no ze-claude (`agents.py:3568-3569`). Se forem tocar no script, é lá.
- **"O back não tem WebSocket" não bloqueia o tempo real** — é o reframe central deste doc. Com ephemeral token, o WS mora no browser ↔ provider; o back só cunha o token por REST. O item 2 deixa de ser o gargalo.
- **Um risco novo que você não mediu:** o **iOS Safari + AudioWorklet** (bug 251350). Sua medição do muxer era no caminho de arquivo; o caminho de tempo real passa por uma peça nova (worklet no celular) que precisa de teste próprio no iPhone do Rica.

---

## 10. Próximo passo

**Spike de 1h com chave real** (antes de qualquer código em `apps/`):
1. Confirmar `POST /v1/realtime/client_secrets` → WS → `conversation.item.input_audio_transcription.delta` com `model=gpt-live-transcribe` (ou confirmar que `/v1/realtime/transcription_sessions` funciona com chave e fechar a divergência).
2. Gravar 2 frases no iPhone do Rica via AudioWorklet (24 kHz) e conferir que o resample não quebra no iOS.
3. Com isso, o desenho deste doc vira contrato de implementação.

Fonte primária do desenho: este doc. Arquivo irmão do `cockpit-v2-composer.md`.

---

## 11. Spike executado — Daniel, 20/08, com chave real

O §8 pedia "15 min com chave real". Rodei. Script em `/tmp/f3-spike/spike.mjs`
(Node 22, `WebSocket` global — de propósito: é a MESMA API que o browser tem,
então o que passa aqui passa lá). Áudio de entrada: frase em pt sintetizada e
convertida com `ffmpeg` para PCM16 24 kHz mono, 7,18s, enviada em pedaços de
100ms com ritmo de fala real.

**Funciona ponta a ponta.** 24 deltas durante a fala, o primeiro 1,6s depois de
abrir o canal, e o final saiu idêntico à frase:

```
2.706s  Δ " O"     3.103s  Δ " Rica"    3.722s  Δ " isto"   5.145s  Δ " trans"
8.377s  áudio terminou de subir
9.207s  ✓ FINAL: "Oi, Rica, isto é um teste da transcrição em tempo real, …"
```

Os deltas chegam ENQUANTO o áudio sobe — o atraso é de menos de 1s contra a
palavra falada, não contra o fim da gravação. É o que o Rica pediu.

### O que o spike CORRIGE no levantamento acima

1. **`/v1/realtime/sessions` e `/v1/realtime/transcription_sessions` estão
   mortas mesmo** — o 404 sem chave não era portão. Com chave, quem cunha é
   `POST /v1/realtime/client_secrets` com `{"session":{"type":"transcription",…}}`,
   e devolve `{value:"ek_…", expires_at}` com **TTL de 600s** (não 30s). A doc
   que descreve as outras duas está velha.
2. **O VAD não é recusado só no `gpt-realtime-whisper` — é recusado nos DOIS.**
   Medido: `gpt-live-transcribe` + `turn_detection:{type:"server_vad"}` falha já
   no minting, HTTP 400 `"Turn detection is not supported for this
   transcription model."`. O risco 5 vale mais largo do que o doc diz —
   **e para nós não é risco nenhum**: quem marca começo e fim aqui é o gesto do
   Rica (segurar/soltar, tocar/tocar), não o silêncio. `input_audio_buffer.commit`
   no `pointerup` é exatamente o desenho que já temos.
3. **O subprotocolo do browser funciona**: `new WebSocket('wss://api.openai.com/v1/realtime',
   ['realtime','openai-insecure-api-key.'+ek])` conectou, `ws.protocol` voltou
   `realtime`. A URL do §8 estava certa **sem** o `?model=` — o modelo já vem
   preso na sessão que cunhou o token. Nenhuma chave permanente no cliente.
4. **`gpt-realtime-whisper` também streama** (21 deltas na mesma frase), mas
   comeu vírgulas que o `gpt-live-transcribe` acertou. Mesmo preço. Usar o
   `gpt-live-transcribe`.
5. **Preço conferido na tabela oficial** (não só no doc): `gpt-live-transcribe`
   e `gpt-realtime-whisper` US$ 0,017/min; `gpt-transcribe` US$ 0,0045/min;
   **`gpt-4o-transcribe` US$ 0,006/min — este é o que o `stt-openai.sh` usa
   hoje**, então a conta real é 0,017 contra 0,006, ~2,8×, cerca de um centavo
   de dólar a mais por minuto falado.

### O que continua sem prova

**iOS Safari + AudioWorklet** (risco 1). O spike alimentou PCM16 já pronto, de
arquivo — não passou pela captura. A peça nova do celular do Rica é a única do
caminho que segue não medida, e só o iPhone dele fecha isso.
