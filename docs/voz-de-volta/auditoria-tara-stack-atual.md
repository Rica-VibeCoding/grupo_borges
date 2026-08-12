# Auditoria Tara — stack atual de voz

Data da auditoria: 11/08/2026.

Escopo: leitura do código e medição do serviço em execução. Nenhum arquivo de produção foi alterado e este documento não propõe uma implementação.

As referências de código estão no formato arquivo:linha. As afirmações sobre bibliotecas e provedores apontam para a documentação externa consultada; as medições identificam o método usado.

## Resultado curto

O backend já entrega uma rota TTS funcional que devolve MP3 binário completo, e o v1 já possui botão manual por bolha, reprodução exclusiva e descarte correto do Blob. O v2 já tem a entrada de voz inteira — captura, STT, entrega e renderização de mensagem STT — mas não tem cliente, player ou política de TTS de saída. O ponto de marcação de mensagem falada já existe, porém é heurístico e falha para o executor Codex. (apps/api/routers/tts.py:121-186; apps/web/components/chat-messages.tsx:615-718; apps/cockpit/components/shell/composer.tsx:262-315; apps/api/orchestrator/synthetic_message.py:32-52)

O achado que bloqueia desenhar o contrato sem cuidado é o limite: a rota aceita texto de até 8.192 caracteres, mas o Google documenta limite de 5.000 bytes por chamada síncrona. O código não mede bytes nem divide o texto antes da chamada Google; nesse caso a falha do Google vira fallback Edge, com voz potencialmente diferente e latência adicional. (apps/api/routers/tts.py:86-90; apps/api/routers/tts.py:121-139; [Google Cloud — SynthesisInput](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/SynthesisInput))

## 1. Contrato real de POST /api/tts/synth

O router TTS é montado com o prefixo /api e declara a rota interna /tts/synth; portanto, a rota efetiva é POST /api/tts/synth. (apps/api/main.py:221; apps/api/routers/tts.py:153-154)

### Corpo aceito

- text é obrigatório, declarado como string com mínimo 1 e máximo 8.192. O teto é aplicado antes da limpeza de Markdown. (apps/api/routers/tts.py:86-90)

- slug é opcional, inicia vazio, aceita no máximo 40 caracteres e, quando não vazio, somente letras minúsculas, dígitos, sublinhado e hífen. (apps/api/routers/tts.py:90-94; apps/api/routers/tts.py:104-109)

- voice é opcional. Quando fornecido, precisa obedecer ao padrão de segmentos como pt-BR-Chirp3-HD-Orus ou pt-BR-FranciscaNeural; não há teto de tamanho nem outra validação declarada para ele. (apps/api/routers/tts.py:23-27; apps/api/routers/tts.py:92-102)

- rate e pitch são strings opcionais sem Field, regex ou validador. Se vierem vazias, a rota usa as configurações da aplicação. (apps/api/routers/tts.py:93-95; apps/api/routers/tts.py:160-162; apps/api/config.py:87-90)

- Depois da validação, text passa por strip_for_tts. Se a limpeza produzir string vazia, a rota responde 400 com texto vazio após limpeza. (apps/api/routers/tts.py:154-158)

### Limpeza antes da síntese

strip_for_tts não é uma conversão geral de Markdown: é uma sequência de regexes simples, aplicada nesta ordem.

- Blocos cercados por três crases são substituídos pelo texto falável “(bloco de código)”; código inline perde somente as crases e preserva o conteúdo. (apps/api/routers/tts.py:43-45; apps/api/routers/tts.py:59-61)

- Tags HTML são removidas; links Markdown preservam o rótulo e removem o destino; marcadores de cabeçalho, negrito e itálico com asteriscos ou sublinhados são retirados. (apps/api/routers/tts.py:45-51; apps/api/routers/tts.py:62-69)

- O marcador inicial de blockquote é removido por linha; URLs HTTP ou HTTPS soltas viram a palavra “link”; caracteres nas faixas de emoji, dingbat, variation selector e ZWJ são apagados. (apps/api/routers/tts.py:52-56; apps/api/routers/tts.py:70-72)

- As entidades &amp;, &lt;, &gt;, &quot; e &#39; são convertidas ou apagadas, espaços e tabs consecutivos viram um espaço, três ou mais quebras de linha viram duas, e o resultado é aparado nas pontas. (apps/api/routers/tts.py:73-83)

### Escolha de voz

A precedência é: voice explícita, voz da frota pelo slug conhecido, settings.tts_voice e, se essa configuração for vazia, DEFAULT_GOOGLE_VOICE. (apps/api/routers/tts.py:112-118)

- daniel e tara usam pt-BR-Chirp3-HD-Orus; pavan usa Algieba; lucas, Algenib; felipe, Iapetus; barsi, Charon; e vinicius, Puck. (apps/api/routers/tts.py:31-40)

- slug desconhecido ou vazio não cai no mapa. No código de configuração, o valor padrão de settings.tts_voice é pt-BR-FranciscaNeural; logo, sem slug conhecido e sem override, o default efetivo de configuração é Edge Neural, não Chirp3-HD. (apps/api/routers/tts.py:116-118; apps/api/config.py:85-90)

- Uma voice explícita vence o slug mesmo que não seja uma voz Google ou Edge utilizável; a rota valida apenas o formato do nome. (apps/api/routers/tts.py:97-102; apps/api/routers/tts.py:112-118)

### Engine, formato de áudio e resposta

O Google é tentado somente quando existe google_tts_api_key e a voz resolvida começa exatamente com pt-BR-Chirp3-HD. A chamada é REST síncrona para text:synthesize, tem timeout de 20 segundos e pede MP3 com pitch 0 e speakingRate 1.0 fixos. Portanto, rate e pitch recebidos no corpo não chegam ao Google. (apps/api/routers/tts.py:121-138; apps/api/routers/tts.py:160-171; [Google Cloud — text.synthesize](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize))

O Google devolve ao backend um JSON cujo campo audioContent é base64; o código o decodifica para bytes. A resposta que o cliente recebe nunca é esse JSON nem base64: é o conteúdo binário completo, com media_type audio/mpeg. (apps/api/routers/tts.py:135-138; apps/api/routers/tts.py:186; [Google Cloud — text.synthesize](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize))

O fallback Edge instancia edge_tts.Communicate, acumula somente chunks cujo type é audio em memória e devolve os bytes acumulados. A rota também os anuncia como audio/mpeg. (apps/api/routers/tts.py:141-150; apps/api/routers/tts.py:175-186)

A documentação de edge-tts consultada via Context7 diz que Communicate.stream() produz dicionários TTSChunk dos tipos audio, WordBoundary e SentenceBoundary; no chunk audio, data são os bytes de áudio. Ela também descreve o formato configurado pela biblioteca como MP3 mono CBR de 24 kHz e 48 kbps. O loop da rota consome corretamente os chunks audio e ignora as fronteiras. (apps/api/routers/tts.py:146-150; [edge-tts via Context7 — stream e chunks](https://context7.com/rany2/edge-tts/llms.txt))

A documentação oficial do Google diz que a escolha de AudioEncoding determina o formato devolvido. No REST v1, os formatos enumerados são LINEAR16 com cabeçalho WAV, MP3 a 32 kbps, OGG_OPUS em contêiner Ogg, MULAW com WAV e ALAW com WAV; este código fixa especificamente MP3. (apps/api/routers/tts.py:127-131; [Google Cloud — AudioEncoding v1](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/AudioEncoding))

### Fallback e falhas

Se não houver chave Google, se a voz não começar com pt-BR-Chirp3-HD ou se a síntese Google lançar qualquer exceção, a rota tenta Edge. Erros Google de HTTP não-200, ausência de audioContent, timeout, JSON ou base64 entram nesse catch genérico. (apps/api/routers/tts.py:121-138; apps/api/routers/tts.py:165-177)

No Edge, uma voz terminada em Neural é preservada. Qualquer outra — inclusive toda voz Chirp3-HD escolhida pelo slug — é substituída por pt-BR-AntonioNeural. Assim, se o Google falhar para tara ou daniel, o fallback não preserva Orus nem consulta settings.tts_voice; ele troca para Antonio. O comentário menciona a voz Neural configurada, mas a função recebe somente a voz já resolvida e não lê settings. (apps/api/routers/tts.py:141-146; apps/api/routers/tts.py:31-40; apps/api/config.py:85-90)

Se o Edge também lançar exceção, a rota responde 500 e inclui o erro Edge e, se houve tentativa Google, a mensagem Google. Se nenhum byte foi produzido sem exceção, responde 500 com TTS gerou áudio vazio. (apps/api/routers/tts.py:175-184)

Não há cabeçalho, campo JSON ou telemetria na resposta que diga qual engine ganhou; o contrato externo expõe apenas bytes MP3. (apps/api/routers/tts.py:165-186)

### Limites documentados versus código

A documentação oficial de SynthesisInput estabelece 5.000 bytes para uma chamada Google. A rota local, ao contrário, aceita até 8.192 caracteres e envia o texto limpo diretamente ao Google, sem aferir UTF-8 nem fragmentar. Logo, um texto válido para o endpoint pode exceder 5.000 bytes no Google e provocar o fallback. Este é um achado, não uma hipótese de biblioteca. (apps/api/routers/tts.py:86-90; apps/api/routers/tts.py:121-131; [Google Cloud — SynthesisInput](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/SynthesisInput))

Para Edge, a documentação consultada via Context7 informa que Communicate faz o particionamento automaticamente, com limite de 4.096 bytes por mensagem WebSocket. Portanto, o teto local de 8.192 não conflita por si com Edge; o problema específico é o caminho Google e sua ausência de limite ou chunking próprio. (apps/api/routers/tts.py:141-150; [edge-tts via Context7 — chunking de 4.096 bytes](https://context7.com/rany2/edge-tts/llms.txt))

## 2. Latência medida na API local

Medição feita em 11/08/2026 contra http://127.0.0.1:8000/api/tts/synth, com slug tara e o mesmo texto em pt-BR de 155 palavras em todas as tentativas. O método foi curl, descartando o corpo depois de baixá-lo por inteiro e registrando time_total; portanto, cada valor é até a resposta completa, não até o primeiro byte.

- Tentativa 1: 10,360369 s, HTTP 200, audio/mpeg, 240.384 bytes.

- Tentativa 2: 10,337700 s, HTTP 200, audio/mpeg, 249.984 bytes.

- Tentativa 3: 9,925910 s, HTTP 200, audio/mpeg, 240.864 bytes.

A média foi 10,207993 s; a amplitude entre a maior e a menor medição foi 0,434459 s. A medição prova o comportamento efetivo da rota completa, mas não isola Google de Edge, pois a resposta não identifica a engine. (apps/api/routers/tts.py:165-186)

## 3. Como o v1 usa TTS

TtsProvider envolve toda a árvore do v1 no layout. Ele mantém enabled, trigger e voice, com default enabled: false, trigger: always e voice vazia. (apps/web/app/layout.tsx:40-42; apps/web/lib/tts-context.tsx:12-21; apps/web/lib/tts-context.tsx:32-70)

No primeiro mount de cliente, o provider lê a chave localStorage cockpit_tts_v1 e mescla o JSON com os defaults; update mescla um patch e persiste o objeto completo. Assim, o storage previsto é exatamente enabled, trigger e voice. Erros de parse ou de acesso ao storage são ignorados. (apps/web/lib/tts-context.tsx:20-21; apps/web/lib/tts-context.tsx:35-48)

O único caminho de síntese do contexto faz POST relativo para /api/tts/synth com text, slug e voice; ao receber sucesso, converte a resposta binária em Blob e retorna uma Object URL. Erro de HTTP, rede ou Blob é reduzido a null, sem causa exposta ao chamador. (apps/web/lib/tts-context.tsx:50-64)

O botão BubbleAudio é inserido em toda part de texto não vazia de uma resposta assistant. Ele não sintetiza no recebimento da mensagem: só chama synthText no clique. Isso vale também para histórico. (apps/web/components/chat-messages.tsx:615-620; apps/web/components/chat-messages.tsx:644-663; apps/web/components/chat-messages.tsx:704-719)

Depois de sintetizar, BubbleAudio cria HTMLAudioElement com a Object URL. Eventos play, pause e ended atualizam o estado visual; clicar no mesmo áudio enquanto toca pausa, e clicar de novo reaproveita a URL já sintetizada. No unmount, ele para o áudio e revoga a URL. (apps/web/components/chat-messages.tsx:627-663)

playExclusive mantém um único HTMLAudioElement global na aba. Iniciar outro pausa e rebobina o anterior; iniciar o atual também o rebobina. A rejeição de el.play(), inclusive bloqueio do navegador, é capturada e silenciada. (apps/web/lib/tts-context.tsx:79-95)

trigger é apenas uma união de tipos com os valores always, on_voice_input e never. Neste uso atual, BubbleAudio não lê settings.enabled nem settings.trigger; ele chama synthText incondicionalmente no clique. A busca no restante de apps/web não encontrou consumidor desses dois campos além de sua declaração, default e persistência. Portanto, trigger não implementa hoje uma política funcional, e enabled também não bloqueia o botão. (apps/web/lib/tts-context.tsx:12-27; apps/web/lib/tts-context.tsx:42-67; apps/web/components/chat-messages.tsx:620-663)

### Reaproveitável no v2

- A decisão de sintetizar sob demanda por resposta, o botão com estados idle/loading/ready e a exclusividade de reprodução são aproveitáveis. Eles evitam custo e sobreposição de falas. (apps/web/components/chat-messages.tsx:615-684; apps/web/lib/tts-context.tsx:79-95)

- A conversão de resposta binária em Blob URL e sua revogação no unmount também é uma base correta para um player v2. (apps/web/lib/tts-context.tsx:50-64; apps/web/components/chat-messages.tsx:627-663)

### Dívida que não deve ser portada

- Não portar a chave cockpit_tts_v1 nem o par enabled/trigger sem antes definir comportamentos observáveis. Eles persistem estado que o v1 não consome. (apps/web/lib/tts-context.tsx:12-21; apps/web/lib/tts-context.tsx:35-48; apps/web/components/chat-messages.tsx:620-663)

- Não portar o silêncio de falha. Tanto synthText quanto el.play() descartam o erro; o usuário não distingue síntese indisponível de bloqueio de reprodução. (apps/web/lib/tts-context.tsx:50-64; apps/web/lib/tts-context.tsx:83-95)

- Não portar a ausência de cancelamento e de deduplicação entre bolhas. A URL é cacheada apenas durante a vida daquele BubbleAudio; não há AbortController para uma síntese que deixou de interessar nem cache por mensagem entre remounts. (apps/web/components/chat-messages.tsx:620-664)

## 4. Caminho da entrada de voz no v2

voz.ts contém o modelo puro da captura: fases, gestos, limiares, decisão ao soltar, MIME aceito e diagnósticos. Ele não acessa React, DOM ou rede. (apps/cockpit/components/shell/voz.ts:1-3; apps/cockpit/components/shell/voz.ts:30-91; apps/cockpit/components/shell/voz.ts:237-288)

usaGravador contém o acesso ao hardware. No pointer down, obtém getUserMedia, cria MediaRecorder e AudioContext, escolhe preferencialmente WebM Opus, WebM, MP4 ou Ogg e inicia a gravação. (apps/cockpit/components/shell/usa-gravador.ts:149-210; apps/cockpit/components/shell/usa-gravador.ts:254-275; apps/cockpit/components/shell/voz.ts:237-253)

Quando MediaRecorder para, o hook normaliza o MIME, cria um File a partir dos pedaços, entra na fase transcrevendo e chama aoGravar(audio). PainelDeCaptura é somente a pele dessa fase; ele recebe fase, aparência, segundos e níveis, sem enviar nada por conta própria. (apps/cockpit/components/shell/usa-gravador.ts:217-252; apps/cockpit/components/shell/captura-voz.tsx:82-110)

No Composer, aoGravar é subirAudio. Após a porta de envio aprovar mídia voz, subirAudio chama envio.enviarVoz(audio); a transcrição retornada aparece temporariamente abaixo do composer com o prefixo visual 🎙. (apps/cockpit/components/shell/composer.tsx:262-305; apps/cockpit/components/shell/composer.tsx:994-1010)

enviarVoz é a mesma máquina de estados de entrega do texto. Ela sonda a fronteira do feed antes do POST, faz postAgentVoice, pega resposta.transcribed e publica o evento enviar usando essa transcrição; a confirmação continua vindo do eco no stream. (apps/cockpit/lib/usa-envio.ts:423-490; apps/cockpit/lib/usa-envio.ts:528-557)

postAgentVoice monta FormData com o campo audio e faz POST /api/agents/{slug}/voice. (packages/cockpit-core/src/api.ts:481-503)

No backend, a rota de voz aceita Ogg, WebM, MP4 e MPEG até 10 MB, executa o script de STT e obtém transcribed. É aqui que a transcrição vira a mensagem efetivamente entregue: para executor Codex, _spawn_codex_agent_turn recebe text=transcribed; para a rota tmux, _send_tmux_or_409 recebe a string 🎙 seguida de transcribed. (apps/api/routers/agents.py:2985-3015; apps/api/routers/agents.py:3418-3455; apps/api/routers/agents.py:3551-3607)

### Ponto natural para marcar “esta mensagem nasceu de voz”

O ponto já existente é a canonização do evento de JSONL. detect_synthetic_kind reconhece uma mensagem cujo texto começa por 🎙 e produz meta com kind: stt e raw_text; _canonical_jsonl_message_event acrescenta esse meta ao payload SSE. (apps/api/orchestrator/synthetic_message.py:5-14; apps/api/orchestrator/synthetic_message.py:32-52; apps/api/routers/agents.py:2658-2675)

O core transforma qualquer mensagem com meta em RenderItem synthetic, e o renderer do v2 desenha stt como a bolha do usuário, preservando rawText com 🎙. Ou seja: a marca visual de entrada por voz já está pronta para o caminho tmux. (packages/cockpit-core/src/render-items.ts:572-588; apps/cockpit/components/feed/corpo-do-item.tsx:212-229)

O encaixe natural para uma marca robusta é esse mesmo campo meta no evento canônico, mas a origem deve nascer no POST /voice e ser carregada explicitamente até os dois ramos de executor. Hoje ela depende do prefixo textual: Codex recebe a transcrição crua e, por isso, não obtém meta.kind: stt; em sentido oposto, um texto digitado que comece com 🎙 também será classificado como stt. (apps/api/routers/agents.py:3584-3600; apps/api/orchestrator/synthetic_message.py:42-52)

## 5. Dependências importadas por tts.py

Os imports de biblioteca externa em tts.py são edge_tts, httpx, fastapi e pydantic; base64, io e re são módulos da biblioteca padrão e não exigem declaração de dependência. (apps/api/routers/tts.py:11-19)

- edge-tts: declarado como edge-tts>=7.0.0, travado no lock em 7.2.8 e presente no interpretador que está servindo a API como 7.2.8. (apps/api/pyproject.toml:11-33; apps/api/uv.lock:214-226)

- httpx: declarado como httpx>=0.27.0, travado e instalado em 0.28.1. (apps/api/pyproject.toml:19-20; apps/api/uv.lock:457-469)

- fastapi: declarado como fastapi>=0.115.0, travado e instalado em 0.136.1. (apps/api/pyproject.toml:11-20; apps/api/uv.lock:229-240)

- pydantic: declarado como pydantic>=2.9.0, travado e instalado em 2.13.4. (apps/api/pyproject.toml:19-23; apps/api/uv.lock:907-919)

A conferência em execução foi feita com importlib.metadata no interpretador do processo que escuta 127.0.0.1:8000, apps/api/.venv/bin/python. As quatro versões retornaram exatamente os valores do uv.lock. Não há lacuna entre o que tts.py importa, o que o projeto declara e o que está instalado.

Não há import nem dependência do cliente google-cloud-texttospeech: o Google é chamado diretamente pela API REST com httpx. (apps/api/routers/tts.py:121-138; apps/api/pyproject.toml:11-33)

## Buracos

- O v2 não tem ainda um consumidor de /api/tts/synth, player de saída, estado de síntese ou política para escolher quais respostas devem falar. No código auditado, TTS de saída continua limitado ao provider e às bolhas do v1. (apps/web/lib/tts-context.tsx:50-64; apps/web/components/chat-messages.tsx:615-718; apps/cockpit/components/shell/composer.tsx:262-315)

- O contrato atual bloqueia a resposta inteira até acumular todos os bytes em memória; a medição de aproximadamente 10,2 segundos é de resposta completa. Não existe streaming de TTS, time-to-first-audio, cancelamento da requisição ou indicação de progresso. (apps/api/routers/tts.py:141-150; apps/api/routers/tts.py:175-186)

- O limite local permite uma chamada Google inválida por tamanho. O desenho v2 precisa decidir entre limitar a entrada TTS a 5.000 bytes após limpeza ou fragmentar por byte e manter a ordem/voz entre fragmentos. (apps/api/routers/tts.py:86-90; apps/api/routers/tts.py:121-139; [Google Cloud — SynthesisInput](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/SynthesisInput))

- O fallback quebra identidade vocal da frota: uma falha Google com voz Chirp3-HD cai em Antonio, sem preservar a voz do slug e sem usar settings.tts_voice. O contrato futuro precisa declarar se isso é aceitável, qual voz Edge corresponde a cada agente e como expor que houve degradação. (apps/api/routers/tts.py:31-40; apps/api/routers/tts.py:141-146; apps/api/routers/tts.py:168-184)

- Rate e pitch são aceitos pela rota, mas só chegam ao Edge; Google fixa valores neutros. O contrato de produto precisa escolher se esses controles existem para ambas as engines ou se saem do payload público. (apps/api/routers/tts.py:93-95; apps/api/routers/tts.py:127-131; apps/api/routers/tts.py:160-162; apps/api/routers/tts.py:141-146)

- A proveniência de voz do v2 é uma heurística de emoji. Ela dá falso negativo para Codex e falso positivo para texto digitado com o mesmo prefixo. Antes de usar on_voice_input para disparar TTS de volta, a origem precisa virar metadado explícito e persistente, não um parser de conteúdo. (apps/api/routers/agents.py:3584-3600; apps/api/orchestrator/synthetic_message.py:42-52; apps/cockpit/lib/usa-envio.ts:29-40)

- O esquema de configuração do v1 não pode ser promovido como requisito. enabled e trigger persistem, mas não governam execução alguma, e erros de síntese ou autoplay ficam silenciosos. (apps/web/lib/tts-context.tsx:12-21; apps/web/lib/tts-context.tsx:42-64; apps/web/lib/tts-context.tsx:83-95; apps/web/components/chat-messages.tsx:620-663)

- A resposta de sucesso não informa qual engine foi usada nem se houve fallback. Além disso, o cliente de referência v1 reduz qualquer resposta não-OK ou erro de rede a null; não existe ainda um contrato de falha pronto para o v2 comunicar síntese indisponível ou qualidade degradada. (apps/api/routers/tts.py:165-186; apps/web/lib/tts-context.tsx:50-64)

## Fontes externas verificadas

- [edge-tts via Context7 — Communicate.stream, tipos de chunk e chunking automático](https://context7.com/rany2/edge-tts/llms.txt)

- [Google Cloud — SynthesisInput, limite de 5.000 bytes](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/SynthesisInput)

- [Google Cloud — text.synthesize, resposta síncrona e audioContent em base64 no JSON upstream](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize)

- [Google Cloud — AudioEncoding v1](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/AudioEncoding)
