# Turno 1 — Foundation visual + 1 card único

> **Contexto pra Claude Design:** este é o primeiro de 5 turnos. Hoje quero travar o **tom visual** ("Console Operacional Sci-Fi Sóbrio") e a **anatomia de 1 card único** (o agente Daniel). Não tente desenhar a tela inteira ainda — turnos seguintes vão adicionar grid de 6 cards + filter bar + painel KPI, modal de detalhe, kanban tabular e polimento. Mas esse primeiro turno é o que define a vibe — se acertar aqui, o resto flui.

## 1. O que estamos construindo

Cockpit interno pra orquestrar **6 agentes Claude Code (CLI)** que rodam 24/7 numa VPS Linux, cada um numa sessão `tmux`. Cada agente é especializado (dev sênior, marketing, CFO read-only, consigliere, etc). Hoje os handoffs entre eles passam por Telegram — quero substituir por **interface visual única** que mostra estado vivo.

Uso é **interno e privado** (apenas eu, Rica). Backend FastAPI já existe atrás de Tailscale Serve. UI vai pra Vercel; navegador na tailnet bate direto na VPS.

Plataforma alvo: **desktop primeiro** (1440×900 e ultrawide). Mobile-friendly secundário.

**Leitura intensa, escrita pontual.** Vou olhar várias vezes ao dia pra responder em 1 segundo: quem está rodando, quem travou, quem ficou ocioso.

## 2. Filosofia visual — Console Operacional Sci-Fi Sóbrio

**Sci-fi sim, mas SÓBRIO.** Pensem **Apollo Guidance Computer + bridge de Foundation (Apple TV) + terminal control-room IBM dos anos 70 + Severance UI**. Não Cyberpunk 2077 nem Star Trek LCARS hollywood. **Nada de scanlines fortes, glow exagerado, ou cores neon saturadas.**

A vibe é "este monitor existe há 20 anos e ainda funciona perfeitamente". Densidade alta, monospace dominante, hairlines como linguagem visual primária.

**Anexos de referência (2 imagens em anexo neste prompt — ambas em `refs/`):**

1. `hud-3-cockpit-mockup.jpg` — mockup do próprio cockpit grupo_borges em layout sci-fi sóbrio: deep navy + cyan accent, presence bar de 6 cards horizontais densos no topo, kanban tabular denso embaixo (5 colunas Backlog/Running/Review/Done/Archived com IDs em mono colorido), painel KPI lateral direito, footer técnico com workspace/env/region/user/role/version. **Esta é a referência ESTRUTURAL/VISUAL mais próxima da direção final.** Use pra calibrar densidade, paleta, vocabulário de elementos HUD (filter bar com 9 dropdowns minúsculos, contadores ACTIVE AGENTS/ERRORS/LAST SYNC/SYSTEM HEALTH, IDs `BK-2187`/`RN-2182`/`RV-2176`/`DN-2169`/`AR-2149` em mono).
2. `hud-1-dashboard-gauges.jpg` — dashboard HUD com gauges circulares, gráficos statistic graph, mapa global, paleta deep navy + cyan/teal/azul mid. Vocabulário visual sci-fi puro — extrair tonalidade de gradients sutis, contraste de elementos HUD sobre fundo navy.

**Importante:** este turno pede só **1 card único**, NÃO o layout inteiro. Use as referências pra calibrar paleta/densidade/tom — não pra copiar layout. Extrair vocabulário, não estrutura.

## 3. Decisões duras (não mudar nos próximos turnos)

### Stack-alvo (Claude Code vai implementar com isso)

- **Next.js 16** + **Tailwind 4** (`@theme inline`, sem `tailwind.config.js`)
- **Radix UI primitives** pra Dialog/Tabs/Tooltip/Select (a11y free, sem visual)
- **Componentes custom** escritos do zero — **NÃO shadcn** (queremos personalidade, não convenção)
- **augmented-ui** pra clip-corners sci-fi em frames pontuais (modal, painel lateral KPI)
- **Lucide icons** + complementar com **Phosphor (Thin variant)** pra ícones técnicos

No HTML standalone que você gerar: Tailwind classes diretas + CSS custom properties pra paleta + naming semântico (Card, FilterBar, KPIPanel, KanbanRow — não "DialogPrimitive").

### Tipografia

- **Mono (DOMINANTE — IDs, slugs, paths, status, headers de coluna, modelos, timestamps, números, contadores)**: **JetBrains Mono**.
- **Sans (apenas pra título/body/role descriptive em prose)**: **Geist Sans** ou similar distintivo. **NUNCA Inter, Roboto, Helvetica, system fonts.**
- **Hierarquia**: H1 ~22px / H2 ~16px / Body ~13px / Mono caption ~11px / Mini-mono ~10px uppercase pra labels HUD.
- Letter-spacing levemente apertado em mono caption (-0.02em pra labels uppercase).

### Paleta — derivada do `scifi-theme.css` do Hermes (MIT)

**Dark (alvo principal):**

```
--bg:               #060b18   /* deep navy quase preto */
--panel:            #0d1b2a   /* azul-noite */
--card:             #112240   /* azul mid */
--card-2:           #153258   /* azul mid-light pra hover/active */
--border:           #1a3a5c   /* hairline visível */
--border-subtle:    #142d4a   /* hairline interna */
--text:             #e0f7fa   /* cyan-ice quase branco */
--muted:            #5d9bb8   /* azul-acinzentado */

--accent:           #00b8d4   /* CYAN SÓBRIO — uso primário */
--accent-hot:       #00f0ff   /* CYAN NEON — só em focus ring/pulse de status */
--accent-subtle:    rgba(0, 184, 212, 0.08)
--accent-border:    rgba(0, 184, 212, 0.25)

/* Status colors */
--status-running:   #00b8d4   /* mesmo cyan accent */
--status-success:   #23a86b   /* verde contido */
--status-warning:   #ff6b35   /* laranja */
--status-danger:    #ff5252   /* vermelho contido */
--status-idle:      #5d9bb8   /* muted */
```

**Light (cold steel):**

```
--bg:               #eef1f5
--panel:            #e8ecf2
--card:             #f4f6f9
--border:           #c4cdd8
--text:             #0a1628   /* deep navy */
--muted:            #5a6a7e
--accent:           #0097a7   /* teal escuro */
```

### Geometria

- **Cantos**: `rounded-sm` (~2px) MÁXIMO. Vários elementos com 0px (cantos retos puros) — header, KPI frame, status pill. **NUNCA `rounded-md`+, NUNCA `rounded-full` (exceção: dot do status).**
- **Borders**: 1px hairline SEMPRE. Pra dar pegada HUD em frames específicos (modal, KPI panel), opcional **augmented-ui clip-corner** em 1-2 cantos (top-left + bottom-right é o pattern).
- **Sombras**: ausentes no normal. Modal aberto: glow contido com cyan, não drop-shadow tradicional.
- **Spacing**: 8pt grid (8/12/16/24/32). Densidade alta — 12px é o padding "respirador" típico, não 24.

### Iconografia

**Lucide icons** primary (14-16px nos cards, 18-20px no header). Pra ícones HUD-feel (radar, telemetria), considerar **Phosphor Thin variant** — mas manter peso visual leve.

### Modos

**Dark default + light obrigatório.** Toggle (Sun/Moon Lucide) no header. Persistir em `localStorage`. Animação 150ms ao trocar.

## 4. Anatomia de UM card (faça só esse, não os 6)

Use como protótipo o agente **Daniel Singh** (slug `daniel`). Card horizontal denso, **não cardinho bonito vertical**:

```
┌─────────────────────────────────────────────────────────┐
│ [🚀] Daniel Singh                          ● RUNNING   │
│      daniel                                             │
│      Dev sênior — Líder de área                         │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ PREVIEW:                                                │
│ ✓ Refactor connection-per-call em store.py             │
│   Próximo: smoke test contra ~/.claude/projects/        │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│ opus-4.7 · cc                              [2]   há 12s │
└─────────────────────────────────────────────────────────┘
```

**Detalhes:**

- **Frame**: background `--card`, border 1px `--border`, `rounded-sm` (~2px) ou 0. Padding 12px. Largura ~220px (cabe 6 numa linha em viewport 1440px com gaps de 12px).
- **Avatar 36×36 `rounded-sm`** (não round!): emoji 🚀 centralizado em background `--accent-subtle`. Alternativa pra agentes sem emoji: iniciais `DS` em **JetBrains Mono peso 600 14px** sobre `--card-2`.
- **Status pill** top-right: dot 6px (cor do status) + label uppercase 10px em **JetBrains Mono peso 500** ("RUNNING"). Sem background; só dot + label.
  - **Pulse no dot quando running**: opacity oscila 0.6 ↔ 1.0 + um leve box-shadow cyan (alpha 0.15-0.25, blur 4px). Sutil, não disco-club. Period 1.6s.
- **Nome**: Geist Sans peso 500, ~14px, cor `--text`.
- **Slug `daniel`**: JetBrains Mono 11px, opacity 0.5, lowercase.
- **Role**: Geist Sans regular 12px, opacity 0.7.
- **Separador interno**: 1px solid `--border-subtle` ocupando full width (não margin lateral). Cria 3 zonas: header / preview / footer.
- **PREVIEW label**: JetBrains Mono uppercase 10px peso 500 letter-spacing 0.05em, opacity 0.5. Marca a zona.
- **pane_excerpt**: 2 linhas em **JetBrains Mono 11px** com fade-out gradient na 2ª linha (background → `--card` em mask-image). Cor `--text` opacity 0.85. Pode preservar prefixo `✓` ou `$` quando aplicável.
- **Footer do card**: model + cli em mono 11px opacity 0.6 (`opus-4.7 · cc`). Instance count badge à direita: `[2]` em mono 11px peso 600 com square brackets literais. Timestamp `há 12s` em mono 10px opacity 0.5.

**Hover**: border vai pra `--accent-border` (cyan subtle), `translateY(-1px)`, transition 150ms ease-out. Cursor pointer.

**Focus visible** (Tab): outline 1px `--accent-hot` (`#00f0ff`) com offset 2px, sem glow agressivo (max blur 6px alpha 0.2).

## 5. Anti-padrões — NUNCA fazer

- ❌ Inter, Roboto, Helvetica, system fonts (fontes "AI default")
- ❌ **Cantos arredondados grandes** (`rounded-md`/`-lg`/`-xl`/`-full` exceto dot status) — sci-fi sóbrio quer cantos retos
- ❌ Purple/violet gradients (cliché AI)
- ❌ Sombras pesadas (`shadow-xl`+)
- ❌ Cards genéricos com background diff só (sem hairline) — perdem hierarquia
- ❌ **Glow excessivo** (text-shadow alpha > 0.25, blur > 8px) — vira disco-club
- ❌ **Scanlines** distractivas no background — pega pesado e não combina com sóbrio
- ❌ Saturação alta / **neon saturado em larga superfície** (cyan `#00f0ff` em fundo grande = ruim; cyan `#00b8d4` accent contido = OK)
- ❌ Spinners genéricos (preferir scan-line cyan ou texto + sublinhado de estado)
- ❌ Emoji em UI elements — só no avatar do agente
- ❌ Truncate com `...` brusco — sempre fade-out gradient
- ❌ Tabs com underline animado (turnos seguintes vão pedir background pill estático)
- ❌ Microcopy bobinho ("Oops!", "🚀 Ready!") — texto seco
- ❌ Glow / particles / blur dramático
- ❌ **shadcn-style** padrão (rounded-md, soft shadows, neutral palette) — perde toda a identidade

## 6. Output esperado deste turno

**1 card único do Daniel** centralizado em viewport com background `--bg` (deep navy), com:

- Toggle dark/light no canto top-right da viewport (já funcional, troca `data-theme`)
- Card mostrando todos os elementos da Sec 4 (avatar, nome, slug, role, separadores hairline, PREVIEW label, pane_excerpt com fade, footer com model/cli/instance/timestamp)
- Pulse contido no dot do status running
- Hover state implementado
- Focus ring cyan ao tab

**Forma**: HTML standalone com Tailwind classes. CSS custom properties pra paleta:

```css
@theme inline {
  --color-bg: #060b18;
  --color-panel: #0d1b2a;
  --color-card: #112240;
  --color-border: #1a3a5c;
  --color-text: #e0f7fa;
  --color-muted: #5d9bb8;
  --color-accent: #00b8d4;
  --color-accent-hot: #00f0ff;
  --color-status-running: #00b8d4;
  --color-status-warning: #ff6b35;
  --color-status-danger: #ff5252;
  --color-status-success: #23a86b;
  --font-sans: 'Geist Sans', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
[data-theme="light"] {
  --color-bg: #eef1f5;
  --color-panel: #e8ecf2;
  --color-card: #f4f6f9;
  --color-border: #c4cdd8;
  --color-text: #0a1628;
  --color-muted: #5a6a7e;
  --color-accent: #0097a7;
}
```

Estado em `data-status="running"` no card (facilita CSS state).

## 7. Critério antes de devolver

- [ ] Card lê bem em dark e light mode (testar ambos)
- [ ] Hierarquia visual clara: nome > role > preview > footer (do mais peso ao menor)
- [ ] **Mono dominante** — pelo menos 60% dos elementos textuais em JetBrains Mono
- [ ] Hairline aparece nos lugares certos: card border + separadores internos + (futuro) header/footer
- [ ] Pulse do running NÃO é distractivo (lento, opacity range estreito 0.6-1.0, glow contido)
- [ ] **Cantos retos** ou `rounded-sm` máximo — sem rounded-md/lg
- [ ] Light mode é tão refinado quanto dark — não pode ser afterthought
- [ ] `prefers-reduced-motion: reduce` desliga o pulse

Quando devolver, vou avaliar e abrir turno 2 (replicar pros 6 agentes + header com filter bar + painel KPI lateral + footer técnico).
