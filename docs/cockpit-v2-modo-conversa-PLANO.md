# Cockpit v2 — modo conversa por voz (PLANO GUIA)

> **Se você chegou aqui depois de um `/clear`: este arquivo é o ponto de retomada.** Leia o banner,
> vá para a primeira fase não fechada e siga. Fontes: pesquisa em `docs/modo-conversa/pesquisa-desenho.md`
> (Canário, 26/09/2026); mapa do código no §"O que já existe".
>
> **ESTADO (26/09/2026 — atualizar a cada fase):** aprovado pelo Rica (áudio, 26/09). **Fase 0 em curso:**
> transcrição medida e contrato escrito; falta o Silero no Chrome do PC e no Safari do iPhone, pela
> sonda `https://borges.tailfe77db.ts.net:3447` (`/tmp/f0/`, fora do repo; log em `/tmp/f0/log.jsonl`).

## O pedido

Tela separada do cockpit, aberta por um botão próprio, para conversar por voz com um Zé sem clique:
fala → o sistema percebe o fim → envia sozinho → a resposta toca sozinha → volta a ouvir.
**Quem pensa é o Claude Code do agente** (restrição do Rica: modelo de voz que é o próprio cérebro
está fora). A tela atual e o composer ficam intocados. Pedido por voz em 26/09/2026.

## Decisões (com o porquê — não reabrir sem fato novo)

1. **Detecção de fim de fala no navegador com Silero** (`@ricky0123/vad-web`), silêncio de
   **~1,3–1,4 s** e pré-gravação de ~800 ms. A OpenAI recusa detecção no servidor para transcrição
   (HTTP 400, medido 20/08); 900 ms corta quem respira no meio da frase (pesquisa §2).
2. **Transcrição por ARQUIVO, não ao vivo.** O Silero entrega a fala inteira ao terminar; ela vai
   para a rota que já existe, `POST /api/agents/{slug}/transcription` (`agents.py:3574`, 10 MB, mesma
   cadeia OpenAI → Gemini do Telegram). Sem WebSocket aberto: some o custo de sessão ociosa enquanto o
   Zé pensa, o teto de duração da sessão e a reconexão (pesquisa §6). US$ 0,006/min contra 0,017.
   O segundo a mais de transcrição não pesa diante de um cérebro que leva segundos.
3. **Meio-duplex:** o detector fica surdo enquanto o Zé fala. No Chrome o cancelamento de eco não
   cobre o áudio tocado pela página (pesquisa §3). Fala por cima só na fase 2, e só com fone.
4. **Som, não só tela, para a espera:** tique curto ao enviar; frase-ponte local se o primeiro texto
   não chegar em ~5 s (uma por turno); aviso falado se passar de ~20 s. Quem ouve não olha a tela.
5. **Tela acesa:** Wake Lock pedido junto com o microfone e readquirido no `visibilitychange`. Tela
   bloqueada mata o microfone por regra da plataforma; quando cair, avisar na tela **e** por som.
   Não prometer conversa com o celular no bolso.
6. **Cada texto do assistente vai para a voz assim que chega**, pela rota `POST /api/tts/synth/stream`,
   que já limpa markdown e bloco de código (`tts.py:117`).
7. **Nenhuma mudança no backend.** A obra é só `apps/cockpit`.

## O que já existe (mapa medido em 26/09, relativo a `apps/cockpit/`)

- Envio: `postAgentInput(slug, text, {origin:'stt'})` — `packages/cockpit-core/src/api.ts:395`.
- Transcrição por arquivo: cliente em `packages/cockpit-core/src/api.ts` (procurar a rota `/transcription`).
- Fim do turno do agente: `isRunning` de `useCanarioStream` — `lib/spike/use-canario-stream.ts:35`.
- Voz: `pedeFala` (`components/feed/stream-voz.ts:86`) + `components/feed/reprodutor-unico.ts`
  (`destravaNoGesto`, `iniciaSequencia`, `pausa`). A reprodução destrava só dentro de um gesto.
- Atalhos de tela na home: `app/page.tsx:90`. Barra do agente: `components/shell/barra-de-telas.tsx:86`.
- Testes: `node --test` via `npm test` + `npm run type-check`. O glob do `package.json` **não** cobre
  pasta nova: incluir `lib/conversa/*.test.ts`.

## Fases (cada uma fecha com suíte verde, tela exercitada e code review; só então commit)

### Fase 0 — medir antes de construir (coordenação, ~1 h)
- [ ] Silero (`vad-web`) no Chrome do PC e no Safari do iPhone: carrega, detecta início e fim, qual o
      peso dos arquivos (modelo ONNX + wasm) e onde eles moram (`public/`).
- [x] Rota de transcrição com falas de 5 s, 30 s e 60 s: latência e acerto.
      Medido 26/09 na `:8002`, Ogg/Opus: **5 s → 1,5 s · 30 s → 2,3 s · 60 s → 3,9 s**. Texto certo,
      menos o nome próprio ("Fluyt" saiu "Fluid"/"Fluitt").
      **Furo na decisão 7:** o Silero entrega `Float32Array` a 16 kHz e o caminho natural é
      `utils.encodeWAV`; a rota responde **422 `mime não suportado: audio/wav`** (`_VOICE_ALLOWED_MIMES`,
      `agents.py:2951`). Conserto proposto: incluir `audio/wav` na lista (o ffmpeg já converte).
      WAV de 60 s a 16 kHz mono = 1,9 MB, longe do teto de 10 MB.
- [ ] Peso medido no pacote (`vad-web` 0.0.31 + `onnxruntime-web` 1.30.0): motor
      `ort-wasm-simd-threaded.wasm` **14,2 MB** + modelo `silero_vad_v5.onnx` **2,3 MB** + ~150 KB de JS
      e worklet. Moram em `public/`. Falta medir a carga real nos dois aparelhos.
- [x] Contrato `lib/conversa/tipos.ts` escrito (estados, eventos, efeitos, tempos).
- **Fecha quando:** números anotados aqui, contrato commitado.

### Fase 1 — conversa meio-duplex sem clique
- Trilha **lógica** (`lib/conversa/`, puro, com teste): máquina de estados
  `parado → ouvindo → transcrevendo → esperando o Zé → falando → ouvindo`, saídas de erro (microfone
  negado, captura caiu, transcrição falhou, agente ocupado); relógio da espera (tique, frase-ponte 5 s,
  aviso 20 s).
- Trilha **tela** (`app/conversa/[slug]/`, `components/conversa/`): botão de entrada, toque em
  "Começar conversa" que destrava áudio + microfone + Wake Lock no mesmo gesto, integração com Silero,
  transcrição, envio, voz; visual simples (estado escrito + onda).
- **Fecha quando:** `npm test` e `type-check` verdes; conversa de 3 turnos com um Zé meu na 3009;
  tela bloqueada e desbloqueada no meio (a queda é avisada); eco testado no alto-falante.

### Fase 2 — esfera e fala por cima
- Esfera reagindo ao volume de quem fala.
- Fala por cima com janela de confirmação: 500 ms de fala para valer, 2 s de silêncio para desclassificar
  e retomar a voz de onde parou. Ligada só com a chave "estou de fone".
- Toque mínimo em `reprodutor-unico.ts` (limpar a fila) — arquivo de outro dono, listar no relato.
- **Fecha quando:** interromper a voz duas vezes de fone; tosse não interrompe.

### Fase 3 — publicar e testar no aparelho do Rica
- Build da 3008 na VPS em janela combinada com o Pavan (`next build` suspenso por memória desde 25/09).
- Rica testa no iPhone. Ajustes voltam para a fase dona do defeito.

## Cadeiras (PC do Rica, psmux; coordenação no Daniel pela VPS)

- **lógica** → DeepSeek `deepseek-v4-pro`, pelo proxy da VPS via túnel.
- **tela** → Tara `gpt-5.6-sol`. Dona do lockfile: a única instalação (`vad-web`) é dela.
- **Coordenação** (Daniel): contrato, despacho, revisão, commit. Não escreve código de produção.
- Relatos e briefings: `docs/modo-conversa/` (briefings/, relatos/).

## Riscos que continuam abertos

- **R1** iPhone: Modo de Baixo Consumo barra o autoplay; microfone morre com tela bloqueada.
- **R2** Silero no Safari do iPhone ainda não medido (fase 0 decide).
- **R3** Publicar depende de janela de build na VPS.
- **R4** Resposta longa do Zé vira áudio longo: pode precisar de corte ou resumo falado (decidir na fase 1
  com a tela na mão).
