# Entregas do Claude Designer — Cockpit grupo_borges

Snapshots HTML standalone dos outputs do Claude Designer no projeto `Cockpit grupo_borges — Spec & Padrões` (URL: `https://claude.ai/design/p/019e1329-d50a-7583-a0d3-3b5bbefdc096`). Cada arquivo aqui é um "save standalone" baixado do Designer — runnable em qualquer browser sem internet.

A versão **viva e editável** vive no projeto do Designer. Esta pasta é só **referência local versionada** pra:
- Abrir e comparar entregas offline (sem precisar logar no Designer)
- Checar regressões visuais entre iterações de um mesmo turno
- Servir de base de comparação para o port já feito em `grupo_borges/apps/web/`

**Atualização 2026-05-12:** o port principal para Next.js já aconteceu no monorepo `/home/clawd/repos/grupo_borges`. Estes HTMLs agora são referência histórica/visual, não plano aberto de implementação.

## Princípio de versionamento — supersedência incremental

Cada turno do plano sci-fi sóbrio **inclui o anterior + adiciona uma camada nova**. O turno 4 (kanban) renderiza header + filter + KPI + 6 cards + kanban — ou seja, cobre tudo do turno 1 (card individual) e do turno 2 (chrome + frota). O turno 5 vai cobrir tudo isso + estados marginais (SSE error, loading, focus, motion).

Por isso, quando um turno novo entrega algo que já cobre os anteriores, **os snapshots dos turnos cobertos viram não-canônicos** e vão pra `.archived-versions/` (não deletar — git preserva, pasta marca "não é a versão atual de referência").

**Exceção: snapshots com foco visual único.** O turno 3 (modal aberto sobre cockpit simplificado) é o **único snapshot que mostra o modal renderizado por padrão**. Os outros turnos têm o modal acessível via interação, mas não renderizado. Por isso o `03-modal-v1.html` continua canônico mesmo depois do turno 4 — ele é o único lugar onde se vê o modal "aberto puro" sem precisar clicar.

## Mapping turno → arquivo

| Turno | Arquivo canônico | Status | O que cobre |
|---|---|---|---|
| 05 — Polish (cockpit completo + estados marginais) | `05-polish-v1.html` | ✅ entregue 2026-05-10 — validado via Playwright em 4 estados (live dark, loading dark, SSE off dark, SSE off light) | header + filter bar + KPI panel + 6 cards + kanban tabular + footer + banner SSE + loading scan + focus rings + toast + prefers-reduced-motion + a11y. **Cobre turnos 1+2+4+5.** |
| 03 — Modal de detalhe (Missão · Skills · Docs · Tabelas) | `03-modal-v2.html` | ✅ pós-Send 1 (2026-05-10) — close button limpo + separador pt-BR | modal aberto por padrão sobre versão simplificada do cockpit. **Único snapshot que renderiza modal por padrão.** |

## Fixes acumulados — RESOLVIDOS

Os 7 fixes acumulados ao longo dos turnos 2+3+4 foram aplicados em 2 rodadas (Tweaks free no kanban, 1 Send no modal):

**Kanban (5 via Tweaks free):**
1. ✅ Badge multi-instância: `+2`/`×N` → `[N]` clicável em todos os 6 cards (`<button class="multi-badge">[${a.instance_count}]</button>`)
2. ✅ Footer Barsi offline: ternário `instance_count === 0 ? '—' : ...` — `tmux:—` quando 0
3. ✅ Reconciliar counts RUN: `06` consistente em KPI EXEC + kanban topline `kbRun` + coluna `RUNNING (06)` + footer global `RUN 06`. Segmented filter `RUN 02` mantido (semântica distinta = agentes em status running, não tasks).
4. ✅ Vinicius excerpt: `STANDBY` → `IDLE`
5. ✅ Bonus `+TR` no header ARCHIVED: removido (`meta:""`)

**Modal (2 via 1 Send consolidado):**
6. ✅ Close button `✕ ESC` empilhado: pseudo-element `::after { content:"ESC" }` removido — botão só com `✕` (footer do modal mantém keyhint `[ESC] close`)
7. ✅ Separador francês: `1 143 rows` → `1.143 rows` (panel-eyebrow + TOTAL ROWS na aba Tabelas)

Send budget consumido nesta rodada: **1 Send** (modal). Kanban resolveu inteiro free via Tweaks.

## Histórico — snapshots arquivados

Arquivos em `.archived-versions/` foram canônicos no momento da entrega mas estão cobertos por snapshots posteriores. Mantidos por valor histórico (git já preserva, mas a pasta marca "não é versão atual").

| Arquivo | Data | Por que arquivado |
|---|---|---|
| `01-foundation-v3-agent-card-daniel-superseded-by-04.html` | 2026-05-10 17:16 | Card individual em 5 estados — coberto pelos cards renderizados no `04-kanban-v2.html`. |
| `01-foundation-v3-agent-card-daniel-pre-backend-fix.html` | 2026-05-10 ~16:00 | Versão original do v3 antes dos 4 fixes de alinhamento com backend. Bundle standalone empacotado (230KB) — não comparar via git diff, abrir no browser. |
| `02-grid-frota-v1-superseded-by-04.html` | 2026-05-10 17:31 | Frota completa com chrome — coberto pelo cockpit completo do `04-kanban-v2.html`. |
| `03-modal-v1-pre-send-fixes.html` | 2026-05-10 17:51 | Modal antes do Send 1 — tinha close button `✕ ESC` empilhado e separador francês `1 143`. |
| `04-kanban-v1-pre-tweaks.html` | 2026-05-10 18:35 | Kanban antes da rodada de Tweaks — tinha badge `+2`, Barsi `tmux:barsi-0`, counts inconsistentes, Vinicius `STANDBY`, `+TR` no header ARCHIVED. |
| `04-kanban-v2-superseded-by-05.html` | 2026-05-10 19:30 | Kanban pós-Tweaks/Send (snapshot intermediário) — coberto pelo `05-polish-v1.html` que tem cockpit completo + estados marginais. |

## Como abrir local

```powershell
# Windows
start "C:/Users/RicardoBorges/Documents/dev/projetos/ze claude/daniel/fabrica-de-software/cockpit-grupo-borges/entregas/01-foundation-v3-agent-card-daniel.html"
# ou clicar duas vezes no Explorer
```

**O formato varia por entrega**:
- **HTML legível** (~30-50KB, CSS/JS readable inline) — quando o Designer exporta em modo "save" sem empacotar assets. Dá pra ler o JSX/CSS/JS no editor, fazer grep, comparar diffs em git de forma útil. **Esse é o formato preferido**.
- **Bundle standalone empacotado** (~200-400KB, runtime de descompressão + assets gzipped + base64 inline dentro de `<script type="__bundler/...">`) — quando o Designer empacota tudo pra distribuir como arquivo único. Não dá pra ler/editar; só serve pra abrir no browser.

Pra acessar código real quando a entrega é bundle empacotado:
- Abrir o arquivo no Designer (sessão correspondente do projeto).
- Ou fazer "Send to local coding agent" no Designer pra gerar handoff bundle pro Daniel-VPS.

## Versionamento

- **Versão canônica** de cada turno é o arquivo `NN-<nome>-vN-<descricao>.html`. Quando uma nova iteração aprovada chegar, **arquive a anterior** em `.archived-versions/` (criar a pasta quando precisar) e promova a nova.
- **Diff em git só é útil pro formato HTML legível.** Pro formato bundle empacotado, compare visualmente abrindo cada versão no browser (o conteúdo real está em base64 dentro do bundler — diff vira ruído).
- **Não usar `gzip`** — o conteúdo já está comprimido internamente. O ganho de gzip externo é marginal e quebra o "abre direto no browser".
- Estes arquivos **devem ser commitados** (não gitignorar) — fazem parte da documentação do design.

## Plano de migração — status 2026-05-12

Os 5 turnos já foram entregues e o port principal para `grupo_borges/apps/web/` já foi realizado. O checklist abaixo fica como trilha histórica e referência de validação:

1. **Validação visual offline** — abrir cada arquivo no browser local e checar dark/light, hover, animações, que tudo bate com a vibe Hermes neon do briefing.
2. **Handoff Designer → Daniel-VPS** — concluído via bundle/snapshots Designer.
3. **Port pra produção** — concluído em Next.js 16 + Tailwind 4 + Radix primitives + componentes custom no monorepo, mantendo a paleta Hermes em CSS.
4. **Reference docs** — após o port, esses HTMLs ficam como prova histórica da intenção visual. Útil em PR review ("o port manteve a vibe? bate com `01-foundation-v3-...`?").

## Princípios pra Designer continuar a partir das entregas

Quando colar um briefing novo no Designer, o briefing pode citar o arquivo de uma entrega anterior **pelo nome do arquivo no projeto** (ex: `Agent Card · Daniel v3.html`). Arquivos do projeto Designer são compartilhados entre sessões de chat — basta nomear no prompt e ele tem acesso. Não é preciso colar o HTML standalone no briefing (ele é gigante e empacotado).

Quando a referência é só pro Rica revisar offline, basta apontar pro snapshot aqui em `entregas/`.
