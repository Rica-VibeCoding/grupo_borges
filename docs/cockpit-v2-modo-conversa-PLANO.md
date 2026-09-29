# Cockpit v2 — modo conversa por voz (PLANO GUIA)

> **Se você chegou aqui depois de um `/clear`: este arquivo é o ponto de retomada.** Leia o banner,
> vá para a primeira fase não fechada e siga. Fontes: pesquisa em `docs/modo-conversa/pesquisa-desenho.md`
> (Canário, 26/09/2026); mapa do código no §"O que já existe".
>
> **ESTADO (27/09/2026 ~17h00 BRT — atualizar a cada fase):** Fases 0, 1 e 2 **fechadas**. **Fase 3 com código completo**
> e **Fase 4 em curso** (tudo publicado na 3008, janelas do Pavan). Depois do primeiro teste no iPhone o Rica pediu, e
> entrou: tela limpa (`bfbb44c`, fone e "Mostrar texto" na folha), um toque inicia e um toque para (`43b23a4`, pesquisa
> `pesquisa-toque.md`), escuta que emudecia no iPhone volta sozinha (`803a1d9`) e gestos no lugar dos botões (`d14df38`:
> esquerda vai ao chat, cima abre configurações, direita no chat volta). 1067 testes verdes; relatos em `relatos/fase3-ui.md`.
> Na manhã de 27/09: o freio sai sempre — o `/interromper` limpa o pedido que o Claude Code devolve à caixa e grava o
> fim no stream (`8bb6c2a`, `7d749a9`, API reiniciada) — e o fim sem fala espera 800 ms antes de fechar (`6a41df9`).
> Depois, a moldura passou a colar no vidro nos quatro lados: antes o pé subia a faixa segura e sobrava parede embaixo (`917e27f`,
> publicado na 3008 com janela do Pavan). Em seguida, a barra do chat enxugou — microfone e ⧉ fora, foto centrada
> quando o nome não cabe — e os gestos passaram a ser os do Rica: no chat, esquerda abre a voz e direita abre a tropa;
> na voz, direita volta ao chat (`e4488f1`, briefing `fase3-barra-do-chat.md`, publicado na 3008). No iPhone o gesto
> saiu "duro" e, refeito seguindo o dedo entre rotas, deixou tela preta (a rota chegava depois da mola). Às 16h52 de
> 27/09: **chat e voz na mesma tela** — pager com scroll-snap nativo, URL por `replaceState`, direita abre e esquerda
> fecha a tropa, gesto/toque fora/`≡` sem empilhar histórico (`6bef077`, briefing `fase3-pager-chat-voz.md`, publicado
> na 3008). Nova regra: link de UI só vai ao Rica depois do APROVADO da cadeira `teste` (`fase3-cadeira-de-teste.md`,
> relato `fase3-teste.md`). Rica aprovou no iPhone.
> **Fase 4 (rodada da voz):** itens 1, 2, 4, 5, 6 e 7 em produção em 28/09 (`9421f00`); faltam MiniMax (3) e a voz
> enxuta da Dani (8). Estado e próxima lista em `modo-conversa/fase4-rodada-da-voz.md`.
> - Fase 2: 977 testes e `type-check` verdes no PC; E2E 4/4 com o `canarinho` (relato `fase2-tela.md`). A revisão
>   achou 3 defeitos na máquina, e a coordenação achou uma brecha no conserto; os quatro foram fechados com teste
>   antes (`briefings/fase2-logica-conserto.md`, relato `fase2-logica.md`). As provas de `docs/modo-conversa/e2e/`
>   ficaram no PC, fora do repo.
> - Cadeiras no PC: `logica` em 17%, `tela` em 57% (`/new` antes de nova tarefa).
> - **Ordem do Rica (26/09): na VPS só a coordenação.** Teste e `type-check` rodam no PC; a VPS aplica o diff e
>   commita. Poupar RAM.
>
> **Retomar depois de `/clear` — nesta ordem:**
> 1. Ler este banner, as fases 3 e 4 e a seção "Mecânica das cadeiras".
> 2. Fase 3 (código completo; falta o Rica escolher o visual no iPhone). Histórico: escrever `briefings/fase3-ui.md`, commitar, `git pull` no PC. Subir a sessão `ui`
>    no `psmux -L conversa`, com Claude Code em `claude-opus-5-5`. A primeira entrega é pesquisa de referência
>    e **2 ou 3 direções visuais em captura**, que vão ao Rica pelo Telegram ANTES de qualquer código. Só a
>    direção aprovada vira código. A `tela` (57%) sai de cena ou recebe `/new`; a `logica` só entra se a UI
>    pedir estado novo.
> 3. Fase 4: combinar com o Pavan a janela de build da 3008 (R3), e o Rica testa no iPhone: 3 turnos, tela bloqueada, eco no alto-falante, fala por cima de fone, tosse. Defeito
>    volta para a cadeira dona pela mecânica.

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

## Rodada de 29/09 — contratos aprovados para os ajustes A–J

Pavan coordena os commits e a publicação; Tara entrega diferenças e caminhos por etapa.
Nenhum serviço de produção é reiniciado para testar. A retomada do Daniel permanece.
Ordem vigente: G → I → H → D → C; E saiu do escopo. J tem módulos separados da segunda Tara.

- **F — prioridade:** a fala intermediária precisa começar antes do fim do turno. Medir o caminho
  JSONL → API → navegador → áudio antes de alterar a origem. `jsonl_watcher._jsonl_lifecycle`
  classifica estado, não filtra texto. Preferir corrigir a primeira retenção demonstrada;
  `MessageDisplay` só entra se necessário, alimentando o fluxo da API, nunca chamando TTS.
- **G — gravação preservada:** resposta recebida enquanto o Rica grava fica na fila de saída.
  Não desligar o detector, perder amostras ou sobrepor áudio; liberar a reprodução ao terminar
  ou soltar a fala, sem ressuscitar resposta descartada por interrupção.
- **A — configuração:** o cabeçalho da voz abre o painel do chat na mesma rota, sem desmontar
  conversa. Computador usa a gaveta à direita; gesto e preferências do celular permanecem.
- **B — esforço:** reaproveitar o controle e mostrar o nível realmente observado. Padrão baixo
  automático fica fora da rodada se não houver troca isolada da sessão: `/effort` pode afetar
  a configuração global e o proxy só aplica na próxima inicialização. Não reiniciar para contornar.
- **D — entrada ocupada:** fila local por agente/sessão, preservada na recarga, entrega uma fala
  por vez após ociosidade confirmada. A API revalida antes de colar. Entrega incerta não repete
  automaticamente; aba fechada não drena. Não confiar na absorção da fila nativa do CC.
- **C — toque:** interromper turno e áudio é diferente de encerrar a conversa. Preservar a fala
  enviada, seguir ouvindo e guardar complementação até o agente realmente poder recebê-la.
- **E — retirado:** não implementar tique de ferramenta.
- **I — cabeçalho falado:** as listas de ponte/demora/longa saem nesta rodada. Falar somente
  `input.description` da ferramenta mais recente do turno aos 10/30 s, depois a cada 60 s
  desde o fim audível. Pode repetir o mesmo cabeçalho; sem descrição, ficar calado. Sem cache.
  Rejeitar texto com `/`, `\`, crase, `| $ = { } < >`, mais de 120 caracteres ou sem palavra
  acentuada/marcador português (`tô`, `o`, `a`, `de`, `do`, `da`, `e`, `que`, `pra`).
  Captura/vez segurada bloqueiam; fim do turno desarma e invalida síntese pendente.
- **H — ruído:** configurar `far_field` na sessão de transcrição ao vivo, preservando idioma/modelo.

A e F já foram commitados (`fb1e164`, `c3e9dba`). G: 62 testes da máquina/captura aprovados,
verificação de tipos aprovada; suíte completa com 1422 aprovados, 1 ignorado, nenhuma falha.
Na bancada Chrome com microfone virtual, fala de 12,092 s preservou WAV de 14,176 s
(453676 bytes, 16 kHz, incluindo pré-gravação/silêncio). Resposta preparada durante captura,
primeiro som somente 16 ms após confirmar o envio interceptado. Prova em
`/tmp/tara-voz-bancada/prova-g-valida.json`; não equivale a fala humana nem envio real ao agente.
Vez segurada/erros/fone cobertos por testes puros; recarga durante gravação não preserva amostras.

Prova por item: teste que reproduz a falha, teste da correção e percurso no cockpit de
desenvolvimento, incluindo fala, legenda, recarga, interrupção e ausência de entrega duplicada.
A indisponibilidade do v2 às 04:40:35–04:42:05 UTC está confirmada; sua relação com o erro de
fala relatado não está. A recusa de fala ocupada no cliente existe independentemente disso.

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
  Tela bloqueada e eco → fase 4, no iPhone.

### Fase 2 — esfera e fala por cima
- Esfera reagindo ao volume de quem fala.
- Fala por cima com janela de confirmação: 500 ms de fala para valer, 2 s de silêncio para desclassificar
  e retomar a voz de onde parou. Ligada só com a chave "estou de fone".
- Toque mínimo em `reprodutor-unico.ts` (limpar a fila) — arquivo de outro dono, listar no relato.
- **Fecha quando:** interromper a voz duas vezes de fone; tosse não interrompe.
  ✅ 26/09: E2E 4/4 com o `canarinho` (sem fone, fala de 200 ms pausa e retoma na mesma posição, duas falas
  longas interrompem e viram mensagem); 977 testes. Revisão: a captura que caía em `interrompendo` travava a
  voz, e o resto do turno interrompido voltava a tocar. O `tique` desclassificava 2 s depois do começo da
  fala, e não depois de 2 s de silêncio. Os três foram consertados.

### Fase 3 — UI dedicada (ordem do Rica, 26/09)
- "A melhor UI possível, bem pesquisada, bonita, futurística — quero que me impressione." Feita por uma cadeira
  **Opus 5.5** (pedido dele). Pesquisa de referência antes de desenhar; a esfera e os estados da fase 2 são o
  esqueleto, e a lógica não muda.
- Vem ANTES de publicar, para que o build na VPS saia uma vez só e o iPhone teste a tela final.
- **Fecha quando:** o Rica aprova a tela, vendo no PC ou por captura; a suíte segue verde; o E2E 4/4 roda de novo.

### Fase 4 — publicar e testar no aparelho do Rica
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
- **Na VPS só aplicar e commitar** (ordem do Rica, 26/09: poupar RAM). `npm test` e `npm run type-check` rodam
  no PC, pela cadeira, e o PRONTO dela traz os números. Não commitar `docs/modo-conversa/e2e/`.
- **O diff não está na árvore da VPS** enquanto a fase não fecha: trocar de patch é `git apply -R <velho>` e
  depois `git apply <novo>`.
- **E2E:** só com o agente `canarinho`. Chrome de teste minimizado não entrega a resposta (R5).
- **Cadeira não commita**; commit é da coordenação, com `git commit -- <paths>`.

## Riscos que continuam abertos

- **R6** Interromper o Zé para a VOZ, mas não o TURNO dele: o agente segue gerando o turno velho, e a fala nova
  entra como mensagem no meio do turno (MURAL: `absorbed_mid_turn`). A máquina ignora o resto do turno velho até
  o `zeTerminou` dele, mas a resposta à fala nova pode demorar ou vir colada. Medir no iPhone. Se pesar, a
  interrupção passa a mandar Esc para o agente, o que mexe no backend e passa pelo Rica.

- **R1** iPhone: Modo de Baixo Consumo barra o autoplay; microfone morre com tela bloqueada.
- **R3** Publicar depende de janela de build na VPS.
- **R5** Aba em segundo plano não recebe a resposta: o stream agrupa eventos ao vivo no
  `requestAnimationFrame`, que não roda com a janela minimizada (medido no E2E da fase 1). No iPhone não
  pesa (tela bloqueada já derruba o microfone); no PC, conversa com a janela minimizada fica muda.
- **R4** Resposta longa do Zé vira áudio longo: pode precisar de corte ou resumo falado (decidir na fase 1
  com a tela na mão).
