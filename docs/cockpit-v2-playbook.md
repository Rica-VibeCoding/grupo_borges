# Playbook — Cockpit v2

> Reconstrução da camada visual do cockpit. Alvo estético: app do Codex / ChatGPT (dark, chat no centro, moderno).
> Decidido pelo Rica em 2026-07-30. Líder da frente: Pavan. Executores: Daniel ×N, Tara (Codex), Hiro (Kimi).
> **Estado:** em construção — seções marcadas `⏳ pesquisa` aguardam retorno das frentes.

## 1. O que muda e o que NÃO muda

**Não muda:** o backend. `apps/api` (FastAPI, 16.222 linhas, 53 arquivos, 11 routers, 49 endpoints) permanece exatamente onde está. O v2 aponta pro mesmo back e por isso nasce com dado vivo da frota.

**Muda:** só a camada de apresentação de `apps/web` (19.178 linhas, 82 arquivos).

### Morre

- `app/globals.css` — 4.140 linhas de tema sci-fi/matrix
- `augmented-ui` (dependência; só aparece em `globals.css`)
- os componentes visuais de `components/` (37 arquivos) — o layout deles não sobrevive ao redesenho
- `lib/cockpit-css.ts`, `lib/pane-chrome.ts` — helpers acoplados ao tema antigo
- `components/v2/` — pasta órfã de uma tentativa anterior (2 arquivos, maio/julho); não confundir com este v2

### Sobrevive inteiro (≈3.100 linhas, zero reescrita)

Essa é a razão de **não** começar do zero:

- `lib/api.ts` (663) — cliente dos 49 endpoints
- `lib/render-items.ts` (528) — monta os itens renderizáveis do stream do Claude Code
- `lib/use-messages-stream.ts` (474) — SSE de mensagens, reconexão, watchdog
- `lib/cockpit-types.ts` (453) — contratos
- `lib/chat-payload-classifier.ts` (409) — classifica payload do CC (texto, tool_use, tool_result, thinking)
- `lib/use-fleet-stream.ts` (401) — SSE do estado da frota
- `lib/use-pane-stream.ts`, `use-agent-send.ts`, `use-subsessions.ts`, `use-voice-recorder.ts`, `tts-context.tsx`, `fleet-context.tsx`, `selected-agent-context.tsx`, `subagent-activity-context.tsx`, `toast-context.tsx`, `mcp-filter.ts`, `agent-sort.ts`, `tool-name.ts`, `format-time.ts`, `ids.ts`

Regra: **lógica de dado e de stream se importa; nada de visual se importa.**

## 2. Decisão revogada (formalizar)

`docs/cockpit-design-reference/DECISOES.md` (2026-05-10) é a origem do visual atual e cravou:

- "Console Operacional Sci-Fi Sóbrio" · paleta cyan `#00b8d4` sobre navy `#060b18`
- JetBrains Mono em ≥70% da tela
- cantos retos, `rounded-sm` máximo, hairlines de 1px, sem sombra
- **"Componentes custom escritos do zero — NÃO shadcn (queremos personalidade, não convenção)"**
- `augmented-ui` para clip-corners

O pedido de 2026-07-30 inverte cada um desses pontos: estética ChatGPT/Codex, cantos generosos, tipografia de produto, e **shadcn via MCP em vez de componente à mão**. Aquele documento passa a ser **histórico**; este playbook o substitui como referência de design.

Motivo de registrar: documento de decisão que ninguém revoga continua sendo lido como regra viva e contamina o trabalho novo.

## 3. Débito que o v2 já nasce sem

`docs/refactor-playbook.md` tem 10 hotspots do chat atual diagnosticados pelo Daniel (JP-18, 2026-05-18) com arquivo e linha. São arquiteturais, não cosméticos — e é por isso que reconstruir a camada de apresentação vale mais que polir a atual:

1. árvore inteira de `renderItems` reconstrói a cada chunk SSE (`chat-messages.tsx:511`) — O(N) × 50 chunks/s
2. zero virtualização (`chat-messages.tsx:585`)
3. markdown + `rehype-highlight` reprocessam por render (`chat-messages.tsx:449`)
4. auto-scroll em `useLayoutEffect` sem rAF/throttle (`chat-messages.tsx:533`)
5. sem indicador "agente digitando" dentro do feed
6. expand do `OneLineChip` empurra o scroll (não reserva espaço)
7. textarea mede `scrollHeight` a cada tecla (`chat-panel.tsx:375`)
8. cap rígido de 134px no textarea (`chat-panel.tsx:380`)
9. timer de subagente re-renderiza o container a 1Hz (`chat-messages.tsx:524`)
10. reconexão do `EventSource` espera 30s no timeout de NAT (`use-messages-stream.ts:316`)

`docs/chat-patterns-research.md` já traz as contramedidas pesquisadas (2026): `useOptimistic` do React 19 para envio otimista, sentinel + `IntersectionObserver`/`ResizeObserver` para scroll, agregação de chunks em ref com um `setState` por frame, `react-virtuoso` só se passar de ~300–500 itens. **Não repesquisar isso.**

Critério de aceite do v2: os 10 itens acima resolvidos por construção, não por remendo.

## 4. Layout alvo (definido pelo Rica)

### Tela 1 — Chat

- **Esquerda:** a tropa (lista de agentes), no lugar onde o ChatGPT põe as conversas
- **Centro:** o chat. Peça principal, responsivo, com as medidas do ChatGPT (largura de coluna, gaps, radius) — copiadas, não inventadas, para não gastar um dia polindo
- **Direita:** gaveta que abre com os painéis que o cockpit já tem hoje — contexto, MCPs, quotas, effort, permissão, sandbox, subagentes, sparkline, statusline

### Tela 2 — Tasks

Kanban em tela/aba separada, como o Codex separa chat e tarefas. Reaproveita `kanban-board.tsx`, `task-*.tsx`, `reviews-panel.tsx` no comportamento, não no visual.

### Modo voz — decidido

Sistema de áudio completo, incluindo falar com a tropa por voz como no app do ChatGPT/Claude: push-to-talk (aperta e solta) e um modo voz full-screen com visualizador bonito, "meio 3D".

**Não é greenfield.** Já existe: `lib/use-voice-recorder.ts` (191 linhas — `getUserMedia` → `MediaRecorder` → blob, fallback de mimeType `audio/webm;codecs=opus` → `audio/mp4` para iOS, `AudioContext.resume()`, 24 barras via `getByteFrequencyData`), `lib/tts-context.tsx` (`synthText` + `playExclusive`), `routers/tts.py` (Chirp3-HD, voz por agente), `POST /{slug}/voice` (upload → `stt-openai.sh` → `send-keys` no tmux). Falta: o gesto press/release, a tela cheia com visualizador, e opcionalmente um segundo caminho para conversa contínua.

Há uma **cópia inline duplicada** do gravador em `components/chat-panel.tsx:340-780`. Duas implementações do mesmo áudio é onde bug de iOS renasce — matar a cópia na mesma leva.

#### HTTPS: já está resolvido, mas há uma regra de ouro

`http://<IP>:porta` **não é secure context** — a lista de origens confiáveis é fechada e não inclui faixa de IP privado. Em origem insegura `navigator.mediaDevices` é `undefined`, então a chamada estoura `TypeError` em vez de pedir permissão: parece bug de código, é falta de HTTPS.

O cockpit **já é servido por HTTPS**: `tailscale serve` publica `https://srv1061129.tailfe77db.ts.net:3443` → `http://127.0.0.1:3007`, com certificado Let's Encrypt real provisionado pelo Tailscale. Secure context legítimo, sem instalar CA em nada, funciona no iPhone que já está no tailnet.

**Regra:** abrir o cockpit sempre pelo nome `.ts.net`, **nunca** pelo IP `100.x`. Abrir pelo IP mata o microfone. Se houver atalho salvo com IP, trocar — é a causa número um de "o mic não funciona" que vai aparecer. Também: nenhuma URL absoluta `http://` para a VPS (mixed content); as chamadas do front já são relativas.

Não usar Funnel só para ganhar HTTPS — o `serve` já resolve dentro do tailnet.

#### Latência: dá para cortar pela metade

Medido na VPS, áudio de 5,5s em pt-BR:

- `stt-openai.sh` como está hoje (força ffmpeg → mp3): **1,71 s**
- curl direto, mesmo mp3, `gpt-4o-transcribe`: 1,33 s
- curl direto, **webm/opus cru** (o que o browser já grava) + **`gpt-transcribe`**: **0,64 s**

Tirar o ffmpeg e mandar o webm direto é a melhor relação custo-benefício de todo o playbook, e `gpt-transcribe` é mais barato ($0,0045/min contra ~$0,006).

> ⚠️ **Pré-requisito — bug latente no `stt-openai.sh`.** O script tem `set -euo pipefail` + `trap cleanup EXIT`, e `cleanup()` termina em `[[ -n "$TMP_MP3" ]] && rm -f "$TMP_MP3"`. Quando **não** há conversão, `TMP_MP3` está vazio, o teste devolve 1 e **o script sai com exit 1 mesmo tendo transcrito corretamente** (reproduzido: exit 1, stdout com a frase certa). O router trata `returncode != 0` como HTTP 502 `stt_failed`. Hoje fica escondido porque `agents.py:2038` salva o upload como `.oga`, forçando o ffmpeg. No instante em que alguém "otimizar" mandando `.webm`, o endpoint de voz passa a dar 502 em 100% dos casos. **Corrigir o `cleanup` antes da otimização** — e vale para a frota, o script é o mesmo que a skill `voz` usa.

#### Arquitetura de captura

- **Push-to-talk → o que já existe** (`MediaRecorder` → POST). 0,64 s, cobra só o que foi falado, sem WebRTC e sem token efêmero. Fazer PTT sobre WebRTC seria pagar sessão para transcrever 4 segundos de fala.
- **Modo voz contínuo → WebRTC + sessão de transcrição.** `session.type: "transcription"` com `gpt-live-transcribe` transcreve **sem** LLM da OpenAI no caminho — os agentes continuam sendo Claude Code. Ganha VAD de servidor (`server_vad` e `semantic_vad`), deltas parciais e jitter buffer de graça. O browser fala direto com a OpenAI; a VPS só emite o token efêmero (`POST /v1/realtime/client_secrets`, ~15 linhas no FastAPI) — **nenhum áudio passa pela VPS**, o que importa numa máquina que já sofre com CPU. Custo $0,017/min de sessão aberta.
- **WebSocket streaming pela VPS → descartado.** Mais código (AudioWorklet, PCM16, resample, backpressure, reconexão) e ainda repassaria frames de áudio pela VPS continuamente — exatamente o tipo de CPU contínua que já disparou o freio da Hostinger.

Os dois caminhos terminam no **mesmo destino** (`send-keys` no tmux): o front alimenta a mesma função de envio, só muda quem produz o texto.

#### Orb e botão

- **Orb: Canvas 2D, não three.js.** O `package.json` do front hoje não tem nenhuma biblioteca 3D nem motor de animação; um orb em react-three-fiber custa ~150–230 KB gzip para **uma** tela. Gradiente radial + blob deslocado por ruído + `blur()` já lê como "meio 3D" — a sensação de volume vem do sombreamento, não da geometria. Se quiser pronto, **ElevenLabs UI `Orb`** (MIT, 2.3k estrelas, instala estilo shadcn, arquivo vira nosso) é o único bem mantido com licença limpa — mas puxa `three` + `@react-three/fiber` + `drei`. Alternativa intermediária: **OGL** (Unlicense, ~34 KB gzip).
- **Alimentar o orb com RMS de `getByteTimeDomainData`**, não com a média das barras de FFT — RMS no domínio do tempo representa sonoridade percebida. `smoothingTimeConstant` (default 0,8) faz o orb "respirar".
- **Erro de performance a não repetir:** o hook atual faz `setState` com array de 24 posições a 60 fps, ou seja ~60 re-renders por segundo. Aguenta uma barrinha; em tela cheia é desperdício. No modo voz: nível em `useRef`, desenho dentro do `requestAnimationFrame`, **zero `setState` por frame** — só a máquina de estados (idle/gravando/processando) vai para o React.
- **Botão: ElevenLabs UI `VoiceButton`** (MIT) — já tem os 5 estados (idle, recording, processing, success, error), orientado a props, sem acoplamento com backend deles.
- **Ignorar o kokonutui "AI Voice"**: as barras usam `Math.random()` em `setInterval`, sem `AnalyserNode`. É skin, não áudio.
- Se usar r3f: `frameloop="demand"` e **desmontar o canvas** ao sair da tela cheia, não apenas esconder — GPU de celular divide memória com a CPU.

#### Gesto press/release — detalhes que quebram

- Pointer Events (`pointerdown`/`pointerup`), não mouse+touch separados, com `setPointerCapture` para não perder o `pointerup` se o dedo sair do botão.
- `touch-action: none` + `user-select: none` no botão, senão o iOS entra em seleção de texto / menu de long-press no meio da gravação.
- `pointercancel` = **cancelar sem enviar** (chamada entrando, notificação, gesto do sistema).
- Atalho de teclado: filtrar `event.repeat`.
- **iOS não persiste permissão de mic como o desktop** — conceder uma vez por carregamento. Em push-to-talk isso significa que o primeiro aperto paga o diálogo + abertura do device e **perde o começo da fala**. Mitigação: pedir o stream uma vez ao entrar no modo voz e **manter o `MediaStream` vivo** entre apertos (o hook atual dá `track.stop()` a cada gravação). Custo: o indicador laranja de microfone fica aceso — decisão de produto.
- O hook atual é `toggle()` ("segundo clique cancela"). Push-to-talk é semântica diferente: estender com segunda API, não reescrever.

#### Playback do TTS

- Áudio disparado por **gesto** (push-to-talk, enviar) sempre toca. Áudio disparado por **evento SSE** sem interação recente pode ter o `play()` rejeitado — e o `playExclusive` atual faz `.catch(() => {})`, **engolindo a rejeição em silêncio**, de onde nasce o "o TTS quebrou". Correções: desbloquear na primeira interação da sessão e **reusar a mesma instância de `HTMLAudioElement`** trocando só o `src`; e quando o `play()` rejeitar, mostrar "toque para ouvir" em vez de sumir com o áudio.
- **Tempo até o primeiro som: fila por frase.** Quebrar o texto, sintetizar a primeira frase, começar a tocar, sintetizar as próximas em paralelo e enfileirar. Sem MSE, sem gRPC, sem mudar o contrato do endpoint, e funciona no iOS. `MediaSource` está descartado (no iPhone só existe `ManagedMediaSource`, com exigências próprias, por ganho nenhum).
- Detalhe: `tts.py` manda `pitch` e `speakingRate` no `audioConfig`, mas as vozes Chirp3-HD não suportam pitch nem SSML. Funciona hoje porque é ignorado; é ruído a limpar.

## 5. Base de componentes — decidido

Princípio do Rica: **quase nada à mão.** Pegar o que já existe de bom em 2026 e completar com shadcn via MCP.

Restrição dura: nosso chat **não** usa Vercel AI SDK nem provider de LLM no front. As mensagens chegam por SSE do FastAPI e são payloads do Claude Code. Base que exija o runtime do AI SDK está descartada.

### Decisão: híbrido — `assistant-ui` no chat + shadcn no chrome da aplicação

**Achado que pesou:** o shadcn passou a ter componentes de chat nativos em junho/2026 — `message-scroller`, `message`, `bubble`, `attachment`, `marker` (confirmados no registry via MCP `shadcn`; changelog `ui.shadcn.com/docs/changelog/2026-06-chat-components`). Cobrem bolha, linha e rolagem com stick-to-bottom pensado para streaming, e são agnósticos de SDK. Mas **não têm composer e não têm nada de tool call** — exatamente a parte caríssima no nosso caso.

**Chat — `assistant-ui`** (MIT, `@assistant-ui/react` 0.15.1, publicado 29/07/2026, peer `react ^18 || ^19`):

- `useExternalStoreRuntime` é o encaixe: as mensagens continuam vivendo no nosso estado React alimentado por `EventSource`; `convertMessage` traduz o payload do CC; `isRunning` reflete o run; `onNew` chama nossa API. Zero protocolo novo, zero provider no front. O exemplo oficial `with-external-store` roda Next 16 + React 19 + Tailwind 4.
- Instalação é **copy-paste via CLI do shadcn** — o `thread.tsx` gerado (~21,5k caracteres) vira arquivo nosso, editável. A lógica vem do npm; o visual fica no repo. É o modelo que o Rica pediu.
- Ganho direto sobre os payloads do CC: `reasoning` (thinking colapsável), `tool-group` (agrupa tool calls consecutivas em container colapsável, auto-expand durante streaming), `tool-fallback` (estados running/cancelled/requires-action), `diff-viewer` (para o tool Edit), `markdown-text` + `shiki-highlighter`.
- Painéis da gaveta quase prontos: `mcp-config` (dependências só de shadcn), `context-display` (aceita `usage` externo — alimentado pela nossa FastAPI), `model-selector` (com reasoning effort, sobre `command` + `popover`), `message-timing`.
- `getExternalStoreMessages` devolve o payload cru, então a nossa classificação atual pode ser chamada dentro de um renderer sem reescrita.

**Chrome — shadcn:** `sidebar` na esquerda (`collapsible="icon"`; no mobile ele já renderiza dentro de um `Sheet`), segundo `sidebar side="right" collapsible="offcanvas"` **ou** `resizable` para a gaveta, mais `tabs`, `command`, `scroll-area`, `tooltip`, `sonner`.

Encaixe limpo entre as duas: o `threadlist-sidebar` do assistant-ui é construído **sobre** o `sidebar` do shadcn, e o `assistant-sidebar` sobre o `resizable`. Mesmo registry, mesmo `components.json`, mesmas CSS variables.

### Desempate: a adoção foi contestada e sobreviveu — com duas condições

Uma opinião independente (sem ver este plano) recomendou o oposto: **construir a camada de mensagens sob controle próprio** e usar biblioteca só para capacidades pontuais. O argumento: nosso chat não é uma sequência `user/assistant` convencional, e uma biblioteca de chat tende a impor a abstração errada, obrigando a deformar as 3.100 linhas maduras. Ela listou sete critérios eliminatórios. Dois deles são exatamente os hotspots 1 e 2 do nosso débito — atualização granular e virtualização — então foram verificados no código do pacote (`@assistant-ui/react` 0.15.1, `core` 0.3.1, que embarcam o `src/`).

**Atualização granular: passa, e com folga.** O assistant-ui re-renderiza **só a mensagem que mudou**, e o desenho é por-item de propósito: o conversor é um `WeakMap` chaveado pela identidade do **nosso** objeto (se a identidade não mudou, ele nem chama nosso `convertMessage`); a lista assina apenas `messages.length`, não o conteúdo; cada mensagem tem subscription própria; os componentes de mensagem são `memo` com comparador explícito; e a store faz bail-out por `Object.is`. É **mais** granular que uma lista React ingênua — não reintroduz o hotspot. Custo residual honesto: com N mensagens montadas há N selectors por chunk (leituras baratas, O(N)), mas re-render O(1).

> ⚠️ **Condição 1 — a armadilha que anula tudo isso.** Se o handler de SSE fizer `messages.map(...)` recriando todos os objetos a cada chunk — que é o padrão mais comum e provavelmente o que faríamos por reflexo — a identidade dos vizinhos muda, o `WeakMap` é invalidado e voltamos exatamente ao hotspot de hoje. **O update tem que preservar a identidade dos objetos que não mudaram.** Isso não está na documentação deles; saiu de leitura do código. É o item nº 1 da implementação e o primeiro teste a escrever.

**Virtualização: não vem montada, mas tem caminho oficial.** A doc diz literalmente que não existe componente de thread virtualizado pronto. Existe guia oficial + exemplo rodável (`examples/with-virtualized-thread`) com **`@tanstack/react-virtual`** em Next 16 / React 19 / Tailwind 4, apoiado em duas APIs feitas para isso: `unstable_useThreadMessageIds()` (identidade de array estável em updates só-de-conteúdo — exatamente o input que um virtualizer precisa) e `ThreadPrimitive.Unstable_MessageById` (memoizada, tolera id que desapareceu). Alturas variáveis funcionam via `measureElement`, renderizando em fluxo normal com padding representando as regiões desmontadas. As duas APIs estão marcadas `unstable/experimental`.

No caminho default nada é desmontado, mas o `thread.tsx` gerado já vem com `content-visibility:auto` + `contain-intrinsic-size`, então o browser pula layout e paint do que está fora da viewport. O preço de virtualizar depois: abandona-se o `ThreadPrimitive.Viewport` (o auto-scroll dele assume tudo montado) e reimplementa-se auto-follow com `ResizeObserver`, guarda de medição no `scrollToFn` e jump no início do run — sem a guarda, os dois escritores de scroll brigam e a view balança durante o streaming.

> **Condição 2 — medir antes de virtualizar.** O próprio guia abre com "você provavelmente não precisa disto". Montar no caminho default, medir no celular do Rica com sessão real de 500+ eventos, e só então virtualizar. Nossa faixa de uso (500–2000 itens com blocos de código, celular, VPS fraca) é a faixa em que a doc deles manda virtualizar — então é trabalho previsto, não surpresa.

**Plano de fuga confirmado (o que mais importava).** Dá para usar os componentes de apresentação sem o runtime deles: `diff-viewer`, `tool-group` e `tool-fallback` colam **puros** (props puras, sem contexto de runtime — e o código dos autores tem comentário explícito dizendo que renderizar standalone é caso de uso previsto); `reasoning` custa **uma linha** (trocar um `useAuiState` por uma prop `isStreaming`); só `markdown-text` **não** cola, porque exige escopo de part — nesse caso ficamos com o renderer atual ou `streamdown`. Ou seja: não há aprisionamento. Se o runtime decepcionar, ficamos com o que interessa.

### Decisões tomadas de propósito

- **Ficamos em Radix, não Base UI.** `shadcn init` novo tem Base UI como default (`base-nova`); o cockpit é Radix. Misturar = duas stacks de primitives no bundle. Usar a URL simples `https://r.assistant-ui.com/{name}.json`.
- **Não usar o `thread-list` do assistant-ui para a lista de agentes.** Os 7 agentes são sessões vivas, não conversas; o `ExternalStoreThreadListAdapter` obriga a sincronizar `currentThreadId` (armadilha documentada: mensagem indo para o thread errado) por ganho pequeno. Coluna esquerda = `sidebar` + roteamento próprio.
- **Gaveta da direita não é modal no desktop.** Segundo `sidebar` persistente em vez de `sheet`/`drawer`, para não travar o chat — e ele já cai em `Sheet` sozinho no mobile.
- **`context-display` puxa `@assistant-ui/react-ai-sdk`** no item do registry; passando `usage` próprio, remover o import na mão.
- **Pinar versão exata** do `assistant-ui` — 0.x, publica quase diário, tem APIs `unstable_`.
- **Kanban não existe no shadcn oficial** (busca no registry: zero itens). Fica para depois do chat, com `dnd-kit` — atenção: `@dnd-kit/core` estável está parado em 6.3.1 (2024-12) e o ativo `@dnd-kit/react` é 0.5.0 pré-1.0; alternativa madura é `@atlaskit/pragmatic-drag-and-drop` (Apache-2.0).

### Clonar um app de chat inteiro: descartado, e por licença

Auditamos os quatro maiores para ver se valia partir de um deles:

- **LibreChat** (41k estrelas, MIT) — é o único que realmente tem a paleta do ChatGPT: rampa de cinza idêntica, `#212121` no canvas, `#171717` na sidebar, `#ececec` no texto, e até classes órfãs `bg-token-*` e `agent-turn` herdadas do DOM da OpenAI. Mas o layout é o ChatGPT de 2023 — sem bolha de usuário, thread em 47rem, composer de 44px. Serviria como referência de paleta, não como base.
- **Open WebUI** (147k estrelas) — licença é BSD-3 **mais uma cláusula 4** que proíbe alterar ou remover a marca "Open WebUI" acima de 50 usuários sem licença comercial. Geometria também é própria (thread de 58rem, bolha à direita). **Fora.**
- **LobeHub / lobe-chat** (81k estrelas) — "LobeHub Community License": Apache-2.0 **mais cláusula 1.b**, que exige licença comercial para desenvolver e distribuir obra derivada. Além disso não usa Tailwind (antd + antd-style). **Fora.**
- **HuggingFace chat-ui** (10,8k, Apache-2.0) — design system próprio, sem relação de medida com o ChatGPT. Nada a aproveitar.

Confirmação útil: as cores atuais da bolha de usuário do ChatGPT (`#303030` dark, `#f4f4f4` light) **não aparecem em nenhum** dos quatro. Ninguém reproduz o tratamento atual — mais uma razão para montar a nossa camada visual com os valores da seção 6 em vez de herdar de um clone.

## 6. Medidas e paleta do ChatGPT — valores reais

Obtidos de CSS compilado e snapshots de DOM da própria `chatgpt.com` commitados em repos públicos, não de estimativa. Fontes principais: `agentview/agentview` → `packages/studio/src/tailwindcss-typography/src/openai.css` (folha Tailwind 4 compilada, MIT no `packages/studio`) e `revivalstack/ai-chat-exporter` → `reference-html-dom/` (snapshots verbatim, MIT). Seletores atuais conferidos no userscript `alexchexes` (versão 2026-07-23).

### Largura da coluna do chat — é escada de container query, não media query

```
--thread-content-max-width: 32rem
  @34rem → 40rem
  @64rem → 48rem
mx-auto flex max-w-(--thread-content-max-width) flex-1 text-base gap-4
```

```
--thread-content-margin: spacing(4)
  @37rem → spacing(6)
  @72rem → spacing(16)
px-(--thread-content-margin)
```

Importante: `md:max-w-3xl` / `lg:max-w-[40rem]` / `xl:max-w-[48rem]` com media query é a geração **2024** do ChatGPT. A produção atual usa container query (`@md/thread:`) e a sintaxe de parênteses do Tailwind 4. Copiar o padrão antigo é errar de propósito.

### Composer e sidebar

- `--composer-bar_width: 768px` · `--composer-bar_height: 52px` · `--composer-footer_height: 32px` · `--composer-bar_safe-margins: 20px`
- `--sidebar-width: 260px`

### Paleta dark (valores literais)

- rampa de cinza: `--gray-50 #f9f9f9` · `100 #ececec` · `200 #e3e3e3` · `300 #cdcdcd` · `400 #b4b4b4` · `500 #9b9b9b` · `600 #676767` · `700 #424242` · `750 #2f2f2f` · `800 #212121` · `900 #171717` · `950 #0d0d0d`
- fundo principal: `--main-surface-primary` = `#212121` · secundário `#2f2f2f` · `--main-surface-background: #212121e6`
- sidebar: `--sidebar-surface-primary` = `#171717` · `--sidebar-surface: #2b2b2b` · `--sidebar-body-primary: #ededed`
- mensagem: `--message-surface: #323232d9` (fallback sem transparência: `#2f2f2f`)
- composer: `--composer-surface-primary: #303030`
- texto: primário `#ececec` · secundário `#ffffffb3` · link `#7ab7ff`
- borda: `--border-medium: #00000026`

### Estrutura de DOM atual (para orientar a composição, não para copiar)

`#thread`, `group/thread`, `[data-turn]` por turno, `#stage-slideover-sidebar` com `style="width:var(--sidebar-width)"`, composer em `div#prompt-textarea.ProseMirror` dentro de `.composer-parent`. As classes antigas `agent-turn` e `group/conversation-turn` estão mortas.

### O Codex reusa a paleta do ChatGPT — é um design system só

Amostragem por pixel de `chatgpt.com/codex` (light): fundo `#ffffff`, superfície secundária `#f3f3f3`, bordas `#e1e3e1`/`#dbdbdb`/`#e7e7e7`, texto primário `#0d0d0d`, secundário `#5d5d5d` → `#8f8f8f`, acento `#3481fa`. Os três primeiros de texto/superfície **são tokens da mesma escala de cinza do ChatGPT** já listada acima. Conclusão prática: não há dois sistemas a reconciliar — um só.

Diff e status: adição `#188038` light / `#45b55f` dark · remoção `#c5221f` / `#ff334d` · pill "merged" `#f3e8ff`/`#7e22ce` light e `#2a1538`/`#c77dff` dark. Paleta da IDE (dark): acento `#339cff`, chrome `#0f1112`/`#181a1b`, adição `#81c995`, remoção `#f28b82`.

> Natureza da fonte: esses hexes vêm das **ilustrações do site de documentação** — réplicas Tailwind renderizadas com o hex na classe. É referência forte, mas não é o CSS do produto como os valores do ChatGPT acima. Tratar com esse peso.

### Estrutura do Codex web e da tela de tarefas

Útil para a nossa Tela 2 (Kanban/tasks), porque é exatamente essa a tela que o Codex resolve bem:

- **O Codex web não tem sidebar esquerda.** É coluna única centralizada: `mx-auto max-w-[48rem] px-5 pt-6 pb-5` — o **mesmo 48rem** da coluna do ChatGPT. Nosso layout de 3 colunas vem do app do Claude/ChatGPT, não do Codex; misturar as duas referências é decisão consciente do Rica, não engano.
- Hero: `text-[1.75rem]`, peso normal, line-height 1.2, tracking `-0.035em`.
- Composer: `mt-8`, `rounded-[1.25rem]` (20px), fundo surface-secondary, `shadow-sm backdrop-blur-lg`; `+` e um botão de ambiente à esquerda, microfone e send `size-8 rounded-full` à direita.
- Abas: `Chats · Code reviews · Archive`; aba ativa `border-b-2 border-current font-medium`; busca empurrada com `ml-auto`.
- **Linha da lista de tarefas:** `min-h-[clamp(3.5rem,8cqw,4.25rem)]`, `border-b`, `px-2`, `hover:bg-primary-soft`. Linha 1 = título truncado `font-medium` tracking `-0.012em`; linha 2 = `data · owner/repo · branch` em texto secundário. À direita: pill de status, estatísticas de diff em `font-medium tabular-nums` (`+31` verde, `−1` vermelho — **sinal U+2212, não hífen**), e ação de arquivar que só aparece no hover a `opacity-70`.
- Cabeçalhos de grupo: `Last 7 days` / `Older`, maiúsculas, tracking `0.055em`, cor `#777`.
- Detalhe da tarefa: abas **Diff** e **Logs**, com `Create PR` e `Update Branch` no topo direito. Diff é **unified** no web; split existe só na IDE.
- Detalhe de UI que vale copiar: nas linhas de arquivo alterado, **truncar o diretório e preservar o nome do arquivo inteiro**.

### Duas correções a não repetir

- **Não construir toggle Ask/Code.** Foi removido do Codex por volta de 24/09/2025. A capacidade sobreviveu no protocolo (`run_environment_in_qa_mode`), o controle na tela não. O que existe hoje são seletores por superfície (`Local | Worktree | Cloud`).
- **Tipografia do Codex não está resolvida — e "Söhne" não é fato.** Essa atribuição sai de páginas de SEO. O chrome é uma sans geométrica neutra com `tabular-nums` nas colunas numéricas; mono aparece só em código, diff, caminho e chip de versão. O único dado real de produto é `"Geist Mono", ui-monospace, "SFMono-Regular"` no app desktop. Escolher a nossa sans por critério próprio em vez de tentar adivinhar a deles.

### Limite que respeitamos

Não existe repo open source que seja reimplementação fiel de medida do ChatGPT: quem tem os números tem porque contém o CSS/DOM real da OpenAI; quem reimplementa (inclusive LibreChat, 41k estrelas) diverge no sistema de medida e no máximo acerta a cor. Consequência prática: **usamos esses valores como referência de medida e reimplementamos em Tailwind nosso.** Não importamos a folha da OpenAI para o repo — ela é obra dela, independente da licença do repositório que a contém. Também ficam fora repos sem licença (`GPThemes`, `gptClone`) e copyleft (`CodexPlusPlus` AGPL, `cmux` GPL-3).

Extração via `playwright-pc` no Chrome do Rica continua útil só para **screenshot de referência visual** do Codex — os números já temos.

## 7. Como constrói sem derrubar o que está no ar

O cockpit atual **não pode quebrar** (decisão do Rica).

> ⚠️ **Corrigido pela fusão** (`docs/cockpit-v2-fusao.md`, 30/07). Onde este bloco
> divergir dela, **a fusão vence** — ela é posterior e passou pelo gate.

- app novo em **`apps/cockpit`** (nunca `web2`: nome provisório vira fóssil), porta separada, mesmo backend — strangler fig, como manda o `refactor-playbook.md`
- a lógica que sobrevive sai para **`packages/cockpit-core`**, pacote de workspace com tsconfig próprio — **não** import cruzado entre dois apps Next (alias resolvendo contra tsconfig errado e risco de React duplicado)
- `apps/web` não recebe commit durante a obra. Corolário que a fusão cobrou: existe uma **lista curta de cirurgias permitidas** dentro do core (o hotspot 10 mora em `use-messages-stream.ts:316`), senão "zero reescrita" e "os 10 hotspots resolvidos" se contradizem
- vira o padrão só quando o v2 estiver equivalente e aprovado, por **troca de rota reversível**, com os links antigos redirecionando
- prova real com **agente-canário**, nunca com a sessão viva de ninguém — o envio cai por `send-keys` no meio do trabalho produtivo do Márcio e do Dimy
- **onde constrói:** Oracle (`vps-arm-borges-767247`), medido em 30/07 — 8,6 GB livres contra 4,9 GB da Hostinger, 62 GB de disco contra 20, zero steal, e Next 16 já rodando lá em `aarch64`. Mas **build ARM não atravessa**: código sim, `node_modules` e `.next` não. E o **gate mede contra o back da Hostinger**, onde o produto vive — medir na máquina folgada e virar a chave na apertada fraudaria o próprio gate

## 8. Sequência

> ⚠️ **Substituída** pela "Ordem de execução aprovada" de `docs/cockpit-v2-fusao.md`,
> que tem 10 passos e começa pelo baseline. Mantida aqui só como registro do que
> mudou e por quê.

1. Playbook fechado (este documento) — com as 3 frentes de pesquisa incorporadas
2. ~~Mockup navegável aprovado **antes** de existir uma linha de Next~~ → **incoerente, corrigido:** se é navegável e fiel de medida, já é o stack real; se é HTML estático, aprova aparência sem aprovar comportamento. Mockup passa a ser **fatia vertical no stack real, em branch descartável**
3. ~~`apps/web2`~~ → `apps/cockpit`, e o **scaffold é sequencial, feito pelo Pavan sozinho** — paralelizar scaffold é onde nascem os conflitos
4. Equivalência verificada contra os **transcripts congelados** (`fixtures/cockpit-v2/`), não contra impressão de tela: 52 famílias de payload, incluindo as duas de borda que ninguém escreve de propósito
5. Virada

**Feito até agora:** passo 1 da fusão (baseline + contrato de paridade) — commit `07251cf`.

## 9. Divisão do trabalho

Chefia: Pavan. Ninguém commita em `apps/web`.

> **Decisões do Rica em 30/07:** o bug do clear **não** é corrigido no cockpit atual — o v2 nasce certo e pronto. O Daniel trabalha a partir do workspace dele (`ze_claude/daniel`) por enquanto; **quando o repositório do projeto novo for criado, embutir o Daniel dentro dele** (skill `embed-ze`), lembrando que ele roda na **conta Pro** (ricardo.incasa), não na Max da frota.

- **Daniel ×2/×3** — cada sessão em worktree próprio e numa camada distinta (chrome da aplicação, chat, voz), para não brigar por `.git/index`. **A camada visual é dele, com effort `xhigh`** (decisão do Rica, 30/07)
- **Tara (Codex)** — componente isolado com contrato de entrada/saída fechado
- **Hiro (Kimi)** — trabalho repetitivo de volume
- **Pavan** — playbook, revisão, integração, e a decisão final de virada

### O critério estético, e por que ele é um gate separado

> **Rica, 30/07:** *"na hora de criar as telas, a parte artística, eu quero o poder
> máximo no Daniel, extra high. Ele tem que fazer algo extremamente excelente, que eu
> olhe e fale: amei. Esse é o critério — eu tenho que amar. Tem que ser moderno,
> surpreendente, não pode ser alguma coisa mequetrefe."*

Isto **não** entra no gate numérico do "Comportamento observável" — e a tentativa de
traduzir "amei" em métrica seria desonestidade de processo. São dois portões
independentes, e o visual não passa por ser rápido nem o inverso:

- **Gate técnico:** os 12 itens observáveis, medidos, no iPhone do Rica.
- **Gate estético:** juiz único é o Rica, veredito binário, sem recurso a argumento
  técnico. "Está dentro das medidas do ChatGPT" não é defesa contra "não amei".

**A tensão que isso cria com a seção 6, e como se resolve.** A seção 6 manda copiar as
medidas reais do ChatGPT justamente para *não* passar um dia polindo. Mas copiar não
surpreende ninguém — quem abre um clone do ChatGPT reconhece um clone do ChatGPT. A
resolução não é escolher um lado:

- **Esqueleto emprestado, e invisível:** escada de container query, 768px de composer,
  alturas de linha, densidade, área de toque, ritmo de espaçamento. É ergonomia
  resolvida por quem testou com milhões de pessoas — reinventar isso é perder tempo e
  perder qualidade junto.
- **Autoria na pele:** tipografia, cor, profundidade, movimento, os estados vazios, os
  micro-momentos (o que acontece quando um agente começa a pensar, quando uma tool
  falha, quando a voz entra). É aqui que mora o "amei", e é aqui que o Daniel tem
  liberdade — inclusive para divergir do ChatGPT quando a divergência for melhor.

Regra prática: **se a mudança altera medida, justifica; se altera aparência, ousa.**

**Nota operacional sobre "poder máximo":** o effort não é por agente — vem do
`~/.claude/settings.json`, que os 7 dividem (`session_may_diverge: true` no painel
significa que a sessão de pé pode ter outro valor em runtime). O Daniel já está em
`xhigh`. Existe um degrau acima, `max`, aceito pelo painel para agente Claude
(`_AGENT_PAINEL_ALLOWED_EFFORTS`). Subir o degrau sobe para todo mundo, e a frota está
na conta **Pro** por decisão do Rica de 30/07 — cota bem menor que a Max 20x.

Contrato entre camadas precisa estar escrito antes de qualquer sessão paralela abrir. Sem isso, três Daniels produzem três estilos.

## 10. Fontes internas consultadas

- `docs/chat-patterns-research.md` — patterns de chat 2026 (não repesquisar)
- `docs/refactor-playbook.md` — 10 hotspots + método strangler fig
- `docs/cockpit-design-reference/DECISOES.md` — histórico, revogado por este playbook
- `AGENTS.md` (raiz) — regras de implementação do repo
