# Refactor Playbook — Cockpit

Bússola pra atacar débito técnico sem parar o produto.

## 1. Diagnóstico antes de refactor

Não refatora às cegas. Lista onde dói antes:
- telas travadas
- fluxos lentos
- código que sempre dá bug quando mexe

Sem essa lista, refactor vira coçar onde não dá coceira.

## 2. Fatia por vertical, não por camada

Dev sênior quebra por vertical: a aba CHAT do cockpit é uma fatia inteira — do componente até o fetch e o backend. Ataca uma vertical por vez, em commits pequenos.

Outra técnica: **strangler fig** — código novo nasce ao lado do velho e vai estrangulando aos poucos, sem big-bang.

## 3. Ritmo: refactor misturado com feature

Sem pausa de 2 semanas pra "só refatorar" — quase nunca dá certo, estoura prazo.

- **Regra do escoteiro:** cada vez que mexer num arquivo pra qualquer coisa, deixa ele um pouco melhor.
- **Hotspots maiores viram task** no backlog do cockpit (DS-XX). Intercala — uma semana feature, uma tarde refactor.

---

## Hotspots vivos

> Lista mantida pelo Daniel. Quando uma tela travar, um fluxo doer ou um arquivo ficar tóxico de mexer, registra aqui. Cada item eventualmente vira DS no cockpit.

### Aba CHAT do cockpit — JP-18 (2026-05-18, Daniel)

Categoria: **render/scroll** = o caro · **input lag** = teclado · **streaming** = chunk-by-chunk · **latência percebida** = espera visível · **layout shift** = pulo de scroll.

1. **[render] Toda a árvore renderItems reconstrói a cada chunk** — `chat-messages.tsx:511-512` roda `buildToolResultLookup` + `buildRenderItems` + `coalesceSidechainGroups` em O(N) toda vez que `messages` muda; `use-messages-stream.ts:234-237` faz `messages.concat(payload)` por chunk. Em streaming chunk-by-chunk de 50 chunks/s, é 50× sobre a thread inteira. WhatsApp/Telegram fazem append incremental.
2. **[scroll] Sem virtualização** — `chat-messages.tsx:585-664` mapeia `items.map(...)` direto pro DOM. Sessão de 500+ eventos enche o DOM e scroll mobile vira slideshow. Falta `@tanstack/react-virtual` ou similar.
3. **[render] Markdown + rehype-highlight reprocessam por render** — `chat-messages.tsx:449-455` instancia `<Markdown rehypePlugins={[rehypeHighlight]}>` em cada AssistantBubble; `MD_COMPONENTS` é literal mas fica fora do memo de cada bubble. `highlight.js` é pesado e roda no client. Resultado: bolha de assistant com bloco de código piora cada render do container.
4. **[streaming + scroll] Auto-scroll sem throttle/rAF** — `chat-messages.tsx:533-542` faz `el.scrollTop = el.scrollHeight` num `useLayoutEffect` com dep `items.length`. Cada chunk dispara layout sync; em iOS WebKit isso é o gatilho clássico de jank visível.
5. **[latência percebida] Sem indicador "agente digitando"** — `chat-messages.tsx` só renderiza eventos JSONL commitados; não há bolha placeholder enquanto o agente compõe a resposta. Header tem dot/"trabalhando" (`chat-panel.tsx:118-172`) mas zero feedback dentro do feed.
6. **[layout shift] Expand do OneLineChip empurra o scroll** — `components/one-line-chip.tsx` + `chat-messages.tsx:636-647`: abrir chip insere ReactNode inline sem reservar espaço; quem está scrolado no meio perde a referência. WhatsApp não tem o problema (mensagens imutáveis); Telegram pre-aloca.
7. **[input lag] Auto-grow textarea mede scrollHeight por keystroke** — `chat-panel.tsx:375-382` força reflow em todo `setText`; combina com `syncSlashFromCaret` (`chat-panel.tsx:391-408`, regex `detectSlashContext` síncrono) em todo `onChange`. Em iOS Safari c/ teclado nativo, atrasa o eco do caractere.
8. **[input/mobile] Cap rígido de 134px no textarea** — `chat-panel.tsx:380` `Math.min(h, 134)`. Mensagem de 20 linhas vira "caixa postal" com scroll interno. WhatsApp expande até quase o topo da tela; Telegram até ~40% viewport.
9. **[render] Timer de subagent active re-renderiza o container inteiro a 1Hz** — `chat-messages.tsx:524-528` faz `setNowMs(Date.now())` no nível do `ChatMessages`; todo `items.map` re-renderiza pra atualizar "Subagent rodando Xs". O relógio devia viver dentro do `SidechainChip`/`SidechainClusterChip`.
10. **[latência percebida] EventSource reconnect espera 30s no NAT timeout** — `use-messages-stream.ts:316-322` o watchdog só detecta após 30s sem heartbeat. Em mobile (lock/unlock do iPhone, troca Wi-Fi↔4G) a UI fica em "error" por 30s+ antes do backoff entrar. WhatsApp reconecta em ~2-3s via socket nativo.
