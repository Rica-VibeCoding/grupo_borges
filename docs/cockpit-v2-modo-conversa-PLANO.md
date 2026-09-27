# Cockpit v2 — modo conversa por voz (PLANO GUIA)

> **Se você chegou aqui depois de um `/clear`: este arquivo é o ponto de retomada.** Leia o banner,
> vá para a primeira fase não fechada e siga. Fontes: pesquisa em `docs/modo-conversa/pesquisa-desenho.md`
> (Canário, 26/09/2026); mapa do código no §"O que já existe".
>
> **ESTADO (27/09/2026 ~21h30 BRT — atualizar a cada fase):** Fases 0 e 1 **fechadas** (`5ff9759`).
> **Fase 2 em curso, NADA commitado dela:** o diff mora só no clone do PC (`projetos\grupo_borges`).
> - `logica` **entregou** (31 testes verdes, `docs/modo-conversa/relatos/fase2-logica.md` no clone do PC).
> - `tela` estava terminando o E2E (faltava repetir a 2ª fala longa com fone) — relato parcial em
>   `docs/modo-conversa/relatos/fase2-tela.md` no PC. Contexto dela passou de 50%: compactar antes de nova tarefa.
> - Contrato da fase 2 já commitado (`f2c0ae3`). O `type-check` fica verde com a máquina do PC.
> Provas físicas da fase 1 (eco, tela bloqueada) foram para a fase 3, no iPhone.
>
> **Retomar depois de `/clear` — nesta ordem:**
> 1. Ler este banner e a seção "Mecânica das cadeiras" abaixo.
> 2. Capturar as duas cadeiras (`cap-daniel.ps1`). `tela` ociosa → ler `fase2-tela.md` do PC.
> 3. Trazer o diff do PC para a VPS, aplicar, `npm test` + `type-check`, `code-review` (subagente), consertos
>    pela cadeira dona, commit a partir da VPS, sincronizar o PC. Receita na mecânica.
> 4. Fechar a fase 2 aqui e seguir para a fase 3 (build com o Pavan + iPhone do Rica).

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
7. **Backend: só a rota de transcrição aceitar WAV** (fase 0 achou o 422; aprovado pelo Rica 26/09,
   `efda525`). Fora isso, a obra é só `apps/cockpit`.

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
- [x] Peso medido no pacote (`vad-web` 0.0.31 + `onnxruntime-web` 1.30.0): motor
      `ort-wasm-simd-threaded.wasm` **14,2 MB** + modelo `silero_vad_v5.onnx` **2,3 MB** + ~150 KB de JS
      e worklet. Moram em `public/`. Com gzip o motor cai para **3,6 MB**.
- [x] Silero no **Safari do iPhone** (iOS 18.7, 26/09, sonda fora do repo): carrega, detecta início e
      fim, e as falas transcreveram certas pela rota, com a primeira sílaba inteira ("Estou na chácara.").
      A fala chega ~0,9 s maior que o trecho entre início e fim — é a pré-gravação trabalhando.
      **Primeira carga: ~28 s até ficar pronto** (motor de 13,9 MB baixado sem compressão).
      **R2 fechado.** Chrome do PC não foi exercitado — é a plataforma de referência do `vad-web`, fica
      para a tela real da fase 1.
- **Dois achados que viram requisito da fase 1:**
  1. **`comecar` tem de ser idempotente e o botão travar enquanto carrega.** Sem aviso de progresso o
     Rica tocou quatro vezes, nasceram quatro detectores, e cada frase foi gravada e enviada 4×.
  2. **Carga do motor:** servir o `.wasm` comprimido e começar a baixar ao abrir a tela, antes do toque,
     com estado "preparando" visível. 28 s de tela muda é o que fez o Rica tocar de novo.
- [x] Contrato `lib/conversa/tipos.ts` escrito (estados, eventos, efeitos, tempos).
- **Fecha quando:** números anotados aqui, contrato commitado. ✅ 26/09

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
  ✅ 27/09: 957 testes verdes; 3 turnos seguidos com o `canarinho`, sem clique, envio → primeira voz
  4,4–6,9 s, detector desligado durante toda voz (relato `docs/modo-conversa/relatos/fase1-tela.md`).
  Tela bloqueada e eco → fase 3, no iPhone.

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

## Mecânica das cadeiras (o que custou descobrir em 26/09)

- **PC:** `ssh RicardoBorges@100.118.54.91` (Tailscale). Comando de psmux vai em `.ps1` por `scp`, nunca
  aspas aninhadas. Na home do PC já existem: `cap-daniel.ps1 <sessao> <n>` (captura), `send.ps1 <sessao>
  <arquivo.txt>` (texto com `-l` + Enter separado), `compact.ps1`, `clear.ps1`. Chamar com
  `powershell -NoProfile -ExecutionPolicy Bypass -File <x>.ps1`.
- **Sessões:** `psmux -L conversa`: `logica` = Claude Code com DeepSeek `deepseek-v4-pro[1m]` direto no
  OpenCode Zen (chave do cofre `sk-AZyN…` passada por `-e` no `new-session`, nunca em arquivo; env com
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS`/`AUTO_COMPACT_WINDOW=1048576`). `tela` = **Codex CLI** `codex.cmd -m gpt-6-sol
  -c model_reasoning_effort=medium --dangerously-bypass-approvals-and-sandbox` (ordem do Rica 26/09; o
  `gpt-6-sol` não existe no `claude-code-proxy`; chamar a `.cmd`, o `codex` sem extensão dá erro 193).
- **Despacho:** briefing em `docs/modo-conversa/briefings/`, commitado e puxado no PC antes; mensagem de uma
  linha, sem acento e sem `;`. Codex mostra "Waiting for background terminal" enquanto roda teste — não é ócio.
- **Diff PC → VPS:** no PC, `git add -N <novos>` + `git diff --binary -- <caminhos> > %TEMP%\x.patch` +
  `git reset -q -- <novos>`; `scp` do `AppData/Local/Temp/x.patch`; na VPS `git apply`. Depois do commit na VPS,
  no PC: `git checkout -- <modificados>`, apagar os novos, `git pull --ff-only`.
- **Na VPS:** `pnpm install --frozen-lockfile` (o `postinstall` copia os 4 arquivos do motor para
  `public/vad/`), `npm test` e `npm run type-check` em `apps/cockpit`. Não commitar `docs/modo-conversa/e2e/`.
- **E2E:** só com o agente `canarinho`. Chrome de teste minimizado não entrega a resposta (R5).
- **Cadeira não commita**; commit é da coordenação, com `git commit -- <paths>`.

## Riscos que continuam abertos

- **R1** iPhone: Modo de Baixo Consumo barra o autoplay; microfone morre com tela bloqueada.
- **R3** Publicar depende de janela de build na VPS.
- **R5** Aba em segundo plano não recebe a resposta: o stream agrupa eventos ao vivo no
  `requestAnimationFrame`, que não roda com a janela minimizada (medido no E2E da fase 1). No iPhone não
  pesa (tela bloqueada já derruba o microfone); no PC, conversa com a janela minimizada fica muda.
- **R4** Resposta longa do Zé vira áudio longo: pode precisar de corte ou resumo falado (decidir na fase 1
  com a tela na mão).
