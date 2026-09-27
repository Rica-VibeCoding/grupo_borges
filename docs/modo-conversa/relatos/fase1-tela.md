# Fase 1 — relato da trilha TELA

Cadeira `tela` · 26/09/2026 · sem commit, conforme o briefing.

## O que fiz

- Criei a rota `apps/cockpit/app/conversa/[slug]/page.tsx`, separada do chat e do composer.
- Criei `components/conversa/` com a tela, onda, integração da máquina, detector, fila de voz,
  sons locais, Wake Lock e extração dos textos novos do assistente.
- Integrei a máquina real de `lib/conversa/maquina.ts`; não ficou stub temporário.
- Um único toque em **Começar conversa** chama, no mesmo gesto, `destravaNoGesto`, Wake Lock e
  `MicVAD.start()`/microfone. Há trava síncrona contra toques repetidos.
- O Silero usa `@ricky0123/vad-web` 0.0.31, `model: 'v5'` e os três tempos de `TEMPOS`.
- A fala encerrada vira WAV por `utils.encodeWAV`, passa por `postAgentTranscription` e segue por
  `postAgentInput(slug, texto, { origin: 'stt' })`.
- Cada texto novo do assistente chama `pedeFala`; a fila conserva a ordem e só religa o detector
  depois de `isRunning` cair e a reprodução terminar.
- Executei tique, frase-ponte, aviso de demora e aviso falado de erro decididos pela máquina.
- Wake Lock é readquirido no `visibilitychange`; queda da captura vira estado de erro visível e falado.
- Adicionei o atalho de microfone à barra do agente, com alvo de toque de 44 px.
- Adicionei o glob de `lib/conversa/*.test.ts` e `components/conversa/*.test.ts` ao `npm test`.
- Adicionei o script `scripts/copy-vad-assets.mjs` e os ganchos de instalação/dev/build. Os binários
  gerados ficam em `public/vad/`, ignorados pelo git.
- Dependência única adicionada: `@ricky0123/vad-web` 0.0.31.

## Provas

- `npm --prefix apps/cockpit test`: **950 testes · 950 passaram · 0 falharam**.
- `npm --prefix apps/cockpit run type-check`: **verde**.
- Tela aberta em `http://localhost:3009/conversa/pavan`, em 393 × 852 e desktop.
- Estado **preparando** apareceu com o botão travado; depois virou **Começar conversa**.
- Iniciar e encerrar foram exercitados com `MediaStream` sintético silencioso: mostrou **Pode falar**,
  microfone aberto e voltou a **Começar conversa**, sem enviar nada ao agente real.
- Atalho da barra medido no celular: 44 × 44 px, inteiro dentro da viewport.

## Tempo de carga do motor

- Chrome do PC, cache limpo, servidor local: **0,4 s** do mount até `MicVAD.new` pronto.
- Recursos medidos: modelo v5 2.327.524 bytes / 12 ms; WASM 14.239.897 bytes / 82 ms;
  módulo do WASM 24.381 bytes / 21 ms; worklet 2.480 bytes / 3 ms.
- Carga quente mostrada pela própria tela: **0,2 s**.
- Achado: ONNX Runtime 1.30 também exige `ort-wasm-simd-threaded.mjs`; o copiador leva esse quarto
  arquivo. Sem ele, o motor falha antes de buscar o WASM.

## Dúvidas e furos vistos

- O contrato não tem motivo para falha da síntese/TTS. A tela mostra o aviso local e emite
  `vozTerminou`, para não prender a máquina em `falando`.
- `apps/cockpit/.env.development.example` aponta para `srv1061129...:3445`, que respondeu 502 no PC.
  O hostname vigente `borges.tailfe77db.ts.net:3445` respondeu 200; usei-o só no arquivo local ignorado.

## Não fiz

- Não rodei conversa de três turnos com um Zé real, teste de eco nem bloqueio físico do iPhone — são
  o teste da coordenação previsto no briefing.
- Não toquei backend, `reprodutor-unico.ts`, composer, feed nem `lib/conversa/`.
- Não fiz build e não commitei.

## Revisão da coordenação

### 1. Retry depois da falha do microfone

- Extraí o ciclo do MicVAD para `controlador-detector.ts` e escrevi o teste antes do conserto;
  ele falhou junto com o caso de desligar durante a abertura.
- Toda falha de `start()` agora tenta destruir a instância quebrada e cria outra antes de devolver o
  erro à máquina. Isso cobre `NotAllowedError`, `SecurityError`, `NotReadableError` e outras quedas.
- A destruição é defensiva: o MicVAD 0.0.31 pode falhar ao destruir a primeira instância incompleta,
  mas isso não impede a criação da substituta.
- No navegador, forcei a primeira `getUserMedia` a rejeitar com `NotAllowedError`; o segundo toque
  fez uma nova chamada, abriu o stream e chegou a **Pode falar**.

### 2. Encerrar durante a abertura

- O controlador guarda a promessa de `liga()`; `desliga()` espera `start()`/`resumeStream` terminar
  e só então chama `pause()`.
- Há cobertura separada para a primeira abertura e para a retomada de um stream pausado.
- No navegador, atrasei `getUserMedia` em 450 ms e encerrei após 60 ms. A tela voltou ao início e a
  faixa criada depois do clique terminou em `readyState: ended`.

### 3. Fala de erro no retry

- O gesto de **Tentar novamente** cancela primeiro a fala local e só depois destrava áudio, pede Wake
  Lock e despacha `comecar`.
- Um teste de ordem falhou antes do conserto e passou depois dele.

### 4. Aviso de voz perdida

- O sucesso ao religar o detector não apaga mais o aviso de falha da voz do Zé.
- O aviso permanece visível durante a escuta e só é limpo no próximo toque explícito de início.
- A falha também toca um tique local; se esse som não estiver disponível, o aviso visual continua e
  a máquina recebe `vozTerminou`, sem ficar presa.
- Um teste de política reproduziu primeiro o apagamento e depois provou a persistência.

### 5. `speechSynthesis` no Safari

- `resume()` não é destrave: a especificação só o define como retomada de uma fila pausada.
- No código atual do WebKit para iOS, `speak()` dentro de um gesto remove
  `RequireUserGestureForSpeechStart` da instância; `resumeSynthesis()` não mexe nessa restrição.
- O mesmo código remove a restrição antes de enfileirar e não rejeita texto vazio nesse ponto.
- Portanto, o toque inicial agora chama `speak()` com uma frase vazia e volume zero. As frases-ponte
  e de demora posteriores usam a instância já destravada.
- Fontes: [implementação do WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechSynthesis.cpp),
  [bug 223473 corrigido no WebKit](https://bugs.webkit.org/show_bug.cgi?id=223473) e
  [especificação Web Speech API](https://webaudio.github.io/web-speech-api/).
- A conclusão foi validada por especificação e código oficial; a reprodução física no Safari do
  iPhone continua pertencendo à medição da coordenação.

### Provas finais da revisão

- Testes vermelhos antes dos consertos: **0/2** no ciclo do detector e **0/2** nas políticas locais.
- `npm --prefix apps/cockpit test`: **957 testes · 957 passaram · 0 falharam**.
- `npm --prefix apps/cockpit run type-check`: **verde**.
- Browser com áudio sintético: retry após negação, captura após o segundo toque e encerramento durante
  abertura passaram; nenhum áudio foi enviado a agente real.
- Não toquei backend, `reprodutor-unico.ts`, composer, feed nem `lib/conversa/`; não commitei.

## E2E canarinho

### Primeira execução — texto preso na tela

- Reproduzi antes de qualquer conserto: um único clique abriu o detector, tocou `turno1.mp3`,
  transcreveu e enviou ao Canarinho, mas a tela ficou em **O agente está pensando** por 5 minutos.
- Transcrição: “Canário, teste do modo conversa. Responda só com a palavra.” — faltou o `um` final.
- Envio iniciado em `2026-09-26T23:47:39.986Z`; `POST /api/agents/canarinho/input` respondeu 200
  em 878 ms, com `tmux_delivered: true` e `event_boundary_id: 1441653`.
- O Canarinho respondeu “Pronto.” em 5 s, às `2026-09-26T23:47:45.952Z`, nos eventos
  `1441665`/`1441666`. O defeito observado foi a tela não consumir o texto que já existia no stream.
- A frase-ponte disparou após 5,0 s e o aviso de demora após 20,0 s. Não houve pedido de TTS porque
  o texto permaneceu no buffer da tela; encerrei a conversa ao atingir o teto do ensaio.
- Causa medida: o Chrome do harness estava com `visibilityState: hidden`; o stream agrupa eventos
  live no próximo `requestAnimationFrame`, e esse frame não executa com a janela minimizada. Uma
  sonda de 1 s terminou por timeout sem receber o frame.
- Na repetição, troquei `requestAnimationFrame` por `setTimeout(16)` somente no documento do teste.
  Nenhum código de produção foi alterado.

### Execução completa — três turnos

- Um clique às `2026-09-26T23:57:38.520Z` iniciou a conversa. Não houve outro clique entre os três
  turnos; o clique seguinte foi o encerramento, depois da volta final a **Pode falar**.
- **Turno 1:** transcrição “Canário, teste do modo conversa. Responda só com a palavra: Um.”;
  envio `23:57:48.110Z`; resposta “Um.”. Fim físico da fala → envio: **3,239 s**; envio → primeira
  voz: **6,897 s**; fim da voz → detector pronto: **4 ms**.
- **Turno 2:** transcrição “Agora responda só com a palavra: Dois.”; envio `23:58:04.256Z`;
  resposta “Dois.”. Fim físico da fala → envio: **2,876 s**; envio → primeira voz: **4,453 s**;
  fim da voz → detector pronto: **2 ms**.
- **Turno 3:** transcrição “Última, responda só com a palavra: três.”; envio `23:58:17.559Z`;
  resposta “Três.”. Fim físico da fala → envio: **2,059 s**; envio → primeira voz: **4,362 s**;
  fim da voz → detector pronto: **2 ms**.
- Nos três turnos, `POST /api/tts/synth/stream` respondeu 200, entregou um quadro de áudio e o evento
  `done`, sem evento de erro. Cada MP3 tocou seus **2,088 s** e emitiu `ended`.
- O detector permaneceu desligado durante toda voz: a faixa de entrada já estava `ended` em cada
  `playing`, e a próxima `getUserMedia` só ocorreu depois do respectivo `ended`.
- A frase-ponte disparou apenas no turno 1, aos 5,004 s de espera. O aviso de demora não disparou em
  nenhum dos três turnos.

### Palavra final do turno 1

- A transcrição direta do `turno1.mp3` preservou “um”. O WAV produzido pelo Silero também preservou
  “um” quando retranscrito pela mesma rota.
- O segundo ensaio transcreveu esse WAV completo já na primeira passagem. Portanto, o detector não
  cortou o fim da fala; a omissão da primeira execução foi variação da transcrição.
- Os WAVs medidos tiveram 452.652, 325.676 e 352.300 bytes. Ficaram somente no diretório temporário
  local para a contraprova e não entram no repositório.

### Escopo do E2E

- Não simulei eco no alto-falante nem tela bloqueada, conforme o briefing.
- Não alterei código de produção e não commitei.
