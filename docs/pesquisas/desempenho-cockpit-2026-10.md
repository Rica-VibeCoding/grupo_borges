# Desempenho do cockpit — medição e análise

Pergunta do Rica (02/10/2026): *"o cockpit está alinhado com as melhores práticas
para ser rápido na navegação como um todo? Não é app de alta produção, mas quero
saber se algo BARATO pode ser corrigido e elevar a experiência e o consumo de
hardware."*

**Resposta curta: o cockpit executa rápido. O que dói é o peso do transporte —
1,8 MB numa carga fria, dos quais ~1,0 MB são recuperáveis por compressão HTTP,
que hoje está desligada e sem substituto.**

Nada foi editado. `next build` não foi rodado — o relatório de bundle que o
próprio build já grava foi **lido** (`.next/diagnostics/route-bundle-stats.json`).

---

## Como foi medido

- **Cliente:** Chrome real do PC do Rica (perfil do agente, via `browser-harness`
  / CDP), viewport 1440×900, aba **visível e com foco** (`visibilityState:
  visible`, `hasFocus(): true`) — aba de fundo tem `setInterval` estrangulado
  para 1×/min e mediria CPU falsamente baixa.
- **Servidor:** produção, `next start` na :3008, publicada na :3446 pelo
  `tailscale serve`. Sem throttling de rede; throttling de CPU via
  `Emulation.setCPUThrottlingRate`.
- **Carga fria** = `Network.clearBrowserCache` + `cacheDisabled`. **Quente** = F5
  com cache ligado.
- **Métricas** por `PerformanceObserver` (LCP, CLS, longtask, paint) e resource
  timing (`transferSize` = bytes na rede, `encodedBodySize` = corpo).
- **Heap** medido com `HeapProfiler.collectGarbage` antes de cada leitura — sem
  isso o número é lixo não coletado, não memória retida.
- Data da medição e do build: **02/10/2026**, `deploymentId` `8176e6d9b100`.

## Números

| Fase | LCP | load | req | rede | heap | long tasks |
|---|---|---|---|---|---|---|
| `/` fria | 412 ms | 940 ms | 51 | **919 KB** | 9 MB | 0 |
| `/` quente | 232 ms | 300 ms | 50 | 49 KB | 9 MB | 0 |
| `/agente/pavan` fria | 436 ms | 1266 ms | 71 | **1822 KB** | 12 MB | 0 |
| `/agente/pavan` quente | 916 ms¹ | 237 ms | 67 | 67 KB | 11 MB | 0 |
| `/agente/pavan` fria, CPU 4× | 480 ms | 1550 ms | 70 | 1817 KB | 19 MB | 1 × 101 ms |
| clique entre agentes (rota) | — | — | 4 | **7 KB** | — | 0 |

¹ LCP quente maior que o frio não é regressão: com cache, o HTML pinta em 200 ms e
o **maior** elemento passa a ser o conteúdo da conversa, que chega pela API depois.
É o número que importa (o que o Rica vê), mas mede outra coisa.

**Ocioso** (`/agente/pavan`, aba visível, sem turno rodando): CPU **0,29 %** em
60 s (`TaskDuration`); heap retido **11,0 → 11,1 MB** em 2 min com GC forçado;
nós do DOM 635 → 635. **Não há vazamento.** Nenhum `<canvas>` montado na rota do
feed. `requestAnimationFrame` disponível a 60 fps.

**Clique → rota trocada + 2 quadros:** 157 / 177 / 154 / 166 / 136 / 134 ms
(mediana ~160 ms). Abaixo do limiar de "bom" do INP.

**Polling em ocioso:** `/api/fleet` a cada 5 s (90 KB/min), `/api/delegacoes` a
cada 3 s (11 KB/min, 20 req/min), `/api/vps` a cada 10 s (7 KB/min). Em bytes, é
ruído; em requisições, ~22/min.

---

## Ordenado por ganho ÷ custo

### 1. Não existe compressão HTTP — ~1,0 MB por carga fria · BARATO · ALTA

**Medido:** `/agente/pavan` fria transfere **1822 KB**; `/` transfere **919 KB**.
Nem um byte vem comprimido: `Content-Encoding` ausente em JS, CSS e HTML.
O corpo de 117 KB do HTML do agente é servido inteiro.

**Peso do JS de primeira carga, do relatório do próprio build**
(`.next/diagnostics/route-bundle-stats.json`):

- `/agente/[slug]` — 1 409 KB crus → **431 KB com gzip (−69 %)**.
- `/` — 642 KB crus → **191 KB com gzip (−70 %)**.
- `/faxina` — 569 KB → 166 KB. `/_not-found` e `/conversa/[slug]` — 545 KB → 158 KB.

O HTML do agente: 117 KB → **15 KB (−87 %)**.

**Causa:** `apps/cockpit/next.config.ts:194` — `compress: false`. O
`tailscale serve` (que publica a :3446) não comprime nada, e não há proxy reverso
instalado na VPS (nem nginx, nem caddy, nem haproxy — conferido). É exatamente o
anti-padrão que a doc oficial descreve: desligar a compressão do Next só se
**outra camada** já comprime; hoje ninguém comprime.

**Por que não é só trocar `false` por `true`:** o middleware de compressão do
próprio Next comprime `text/event-stream` e **segura os eventos pequenos no
buffer do zlib**. Medido em teste isolado com o
`next/dist/compiled/compression` do projeto:

```
SEM no-transform:  Content-Encoding: gzip | eventos chegam em 420, 1302 ms (escritos em 400/800/1200)
COM no-transform:  Content-Encoding: cru  | eventos chegam em 406, 807, 1208 ms
```

Três eventos escritos viraram **dois** pedaços, o segundo atrasado. É o mesmo
defeito que o comentário do `next.config.ts` descreve ("os chunks pequenos ficam
presos no decoder do browser") — o guarda existe por um motivo real.

**Conserto barato:** o middleware honra `Cache-Control: no-transform`
(`shouldTransform` no bundle do `compression`). As duas rotas de SSE **já
devolvem `x-accel-buffering: no`** (boa prática da própria doc do Next), só falta
o `no-transform`:

1. `compress: true` em `next.config.ts:194`.
2. `no-transform` no `Cache-Control` das respostas SSE — em `/api/stream` (hoje
   `no-store`) e `/api/agents/<slug>/messages/stream` (hoje `no-cache`). Pode ser
   no FastAPI (mais direto) ou via `headers()` do `next.config.ts` para
   `/api/:path*`.

**Conferir depois de publicar:** `curl -H 'Accept-Encoding: gzip' -D-` no chunk
`0fxbrzkriodx2.js` (tem de voltar `content-encoding: gzip`) e na rota de stream
(tem de voltar **sem** `content-encoding`, com os eventos chegando um a um).

**Fonte:** [next.config.js: compress — Next.js v16.2.9](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/05-config/01-next-config-js/compress.mdx)
("*Next.js uses gzip to compress rendered content and static files when running
with `next start`… You should set the `compress` option to `false` to allow nginx
to manage compression*") e
[self-hosting.mdx, `X-Accel-Buffering`](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/02-guides/self-hosting.mdx).
Conferido via Context7 na v16.2.9 (projeto está na 16.2.6).

---

### 2. O `?dpl=` joga fora o cache imutável a cada deploy · CARO · ALTA

Os estáticos saem com `Cache-Control: public, max-age=31536000, immutable` — mas
a URL carrega `?dpl=<deploymentId>` (`/_next/static/chunks/0fxbrzkriodx2.js?dpl=8176e6d9b100`).
Como a chave de cache inclui a query, **todo deploy rebaixa tudo**.

E com árvore suja o id muda em **todo build**, por construção:
`next.config.ts` devolve `${id}-wip${Date.now().toString(36)}` quando há arquivo
sujo nas entradas do build. Hoje houve **3 deploys** entre 20:28 e 21:53 (as
pastas `.next-antes-*` no disco). O Rica com a aba aberta paga **1,4 MB de JS por
deploy** — mesmo quando nenhum chunk mudou.

**Não vale corrigir agora:** o `deploymentId` é a proteção anti-version-skew que
resolveu um incidente real (08/08, seletor de foto morto por chunk hasheado que
não existia mais). Tirar o parâmetro reintroduz aquilo. **O item 1 já amortece
este por 3×** (431 KB em vez de 1409 KB por re-download) — resolver o 1 primeiro
é o melhor custo-benefício para este também.

---

### 3. `motion` inteiro no caminho crítico · MÉDIO · ALTA

Nenhum arquivo importa `framer-motion`, todos importam `motion/react`
(`motion@12.43.0`). **Nenhum uso de `LazyMotion`/`m`** — 19 arquivos, cada um
puxando o runtime completo. O chunk que carrega o runtime é o
`0ec1mixtfxh59.js` (162 KB), presente no first-load de `/agente/[slug]`. Três
arquivos usam **um único** `motion.div` (`gaveta/esqueleto.tsx:8`,
`gaveta/filtros-de-conversa.tsx:9`, `shell/campo-do-composer.tsx:9`).

O padrão `LazyMotion` + `m` existe exatamente para isso (carregar só o motor de
animação necessário). Ganho estimado: **~40 KB gzip**. Custo: mecânico, mas toca
19 arquivos — por isso fica abaixo do item 1.

**Fonte:** [motion — Reduce bundle size (`LazyMotion`)](https://motion.dev/docs/react-reduce-bundle-size).

---

### 4. Markdown no chunk compartilhado do cliente · MÉDIO · MÉDIA

`0fxbrzkriodx2.js` tem **604 KB** e é o maior chunk do app: **43 % de todo o JS
de primeira carga** de `/agente/[slug]`. Ele não é uma biblioteca — é o pacote
compartilhado da rota (contém o código do app: `composer`, `gaveta`, `feed`,
`delegacoes`) junto com `react-markdown` + `remark-gfm` + `cmdk` + partes do
`motion`. Não dá para atribuir um número exato a cada biblioteca sem um build de
análise; a leitura mostra que o pipeline de markdown é de longe o mais pesado.

`components/renderers/markdown.tsx:290` já é `memo` e já tem variante leve
(`COMPONENTES_LEVES:243`). O que ainda dá para fazer é trazer o `ReactMarkdown`
por `next/dynamic`, tirando o parser do first-load — o feed pinta o texto e o
markdown entra depois. Custo baixo, ganho estimado ~50 KB gzip.

---

### 5. Imagens sem `next/image` · BAIXO · MÉDIA

Zero `next/image` no projeto; três `<img>` crus: `feed/cartao-anexo-imagem.tsx:108`,
`renderers/markdown.tsx:141`, `shell/miniatura-anexo.tsx:148`. Nas cargas medidas
o custo foi irrelevante (**32 KB** no total de imagens da rota do agente) e há
comentário justificando a escolha (a rota já entrega o arquivo normalizado, com
cache `immutable`). **Não é problema hoje.** Só passa a pesar se o Rica abrir no
celular uma conversa com foto grande de celular — aí vem o arquivo inteiro, sem
redimensionamento.

---

### 6. Timers de 1 s por item do feed · BAIXO · o ganho medido é zero

Quatro lugares criam `setInterval` de 1 s **dentro de item de lista**:
`feed/delegacoes.tsx:87`, `feed/marca-do-grupo.tsx:129`,
`feed/marco-da-troca.tsx:95`, `feed/linha-viva.tsx:51`. Somam-se
`sincroniza-altura-do-viewport.tsx:168` (500 ms, sempre montado no shell) e
`conversa/use-apoio-da-ferramenta.ts:43` (250 ms).

**O código cheira, mas a medição não sustenta prioridade:** CPU ociosa de
**0,29 %**. Cada tick re-renderiza um nó de texto, e é isso que o comentário em
`linha-viva.tsx:14` já diz. Não gaste esforço aqui antes do item 1.

---

### 7. WebGL · BAIXO · o ganho medido é zero

A esfera é WebGL cru (`conversa/webgl-tela.ts`, sem Three.js) e **não estava
montada** na rota do feed (0 `<canvas>`, heap estável, CPU 0,29 %). O
`pager-do-agente.tsx:14` já a traz por `next/dynamic` com pré-carga em ocioso, e
um `IntersectionObserver` desmonta fora de vista.

Um risco latente, não medido em uso: o **fallback CSS** de
`esfera-conversa.tsx:279` e `moldura-conversa.tsx:195` chama
`requestAnimationFrame` **sem critério de parada** — numa máquina sem WebGL ele
roda enquanto o componente estiver montado, ao contrário do caminho WebGL, que
dorme quando assentado.

---

### 8. Fontes · já está bem

Duas variáveis Geist por `next/font/local` (68,0 + 69,7 KB), `display: 'fallback'`
escolhido por medição e documentado em `app/fonts.ts`. 141 KB são o terceiro maior
item da carga fria, mas woff2 já vem comprimido — compressão HTTP não os toca, e
a decisão de auto-hospedar está justificada. **Nada a fazer.**

---

## Caro, e não vale para este app

- **Remover o `deploymentId`/`?dpl=`** — reintroduz o version-skew de 08/08 (item 2).
- **Proxy reverso para compressão** — virou desnecessário depois que o item 1
  mostrou que o próprio Next resolve com `no-transform`; instalar nginx/caddy
  seria custo maior pelo mesmo ganho.
- **CDN / service worker / pré-render** — app privado de tailnet, HTML dinâmico
  por `fetchFleet()` no `app/layout.tsx:47`, cache de estático já `immutable`.
  Nada disso se paga.
- **Virtualizar a gaveta e o histórico** — hoje 635 nós de DOM na rota do agente.
  O feed (que é a lista longa) **já é virtualizado**
  (`feed/feed.tsx:84`, `@tanstack/react-virtual`).
- **React Compiler** — mexeria em 165 arquivos `'use client'` para um ganho que a
  medição não pede (0 long tasks, 0,29 % de CPU ociosa).
- **`next build --profile` numa cópia** — o relatório oficial já existe em
  `.next/diagnostics/route-bundle-stats.json`.

## O que não deu para medir

- **INP por clique.** O Chrome só atribui `interactionId` a entrada real de
  usuário; `.click()` por JS e `Input.dispatchMouseEvent` não geram entrada
  confiável (o harness registra que `mousedown` nem chega ao renderer). O que dá
  para afirmar: **zero long tasks** em todas as cargas e navegações medidas, e
  clique→rota trocada em ~160 ms — abaixo dos 200 ms de "bom" do INP.
  Fonte: [web.dev — INP](https://web.dev/articles/inp) (bom ≤ 200 ms, ≤ 500 ms
  "precisa melhorar", acima disso "ruim").
- **"5 min parado num chat com turno vivo".** O cockpit do agente `pavan` estava
  sem turno rodando durante a medição. Foram 2 min de heap retido com GC forçado
  (11,0 → 11,1 MB): sem vazamento. Um turno vivo muda o volume de streaming, mas
  não o mecanismo.
- **Celular.** Tudo foi medido no Chrome do PC. O celular do Rica é o outro
  consumidor e o mais sensível a bytes — o item 1 vale mais lá, não menos.
