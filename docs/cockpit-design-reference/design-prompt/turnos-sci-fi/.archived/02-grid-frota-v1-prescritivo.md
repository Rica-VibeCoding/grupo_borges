# Turno 2 — 6 cards da frota + header com filter bar + painel KPI lateral + footer técnico

> **Continuação do turno 1.** Você já entregou 1 card horizontal denso do Daniel com paleta SciFi. Agora replique pros **6 agentes da frota real**, adicione **header com filter bar (9 dropdowns)**, **painel lateral direito de KPIs**, e **footer técnico**. A área abaixo dos cards fica vazia — o kanban vem no turno 3.

## Decisões já firmadas (não mexer)

- **Sans (display, role descriptive)**: Geist Sans. NUNCA Inter/Roboto/Helvetica.
- **Mono (DOMINANTE — IDs, slugs, paths, status, headers, números)**: JetBrains Mono.
- **Paleta dark**: bg `#060b18` · panel `#0d1b2a` · card `#112240` · border `#1a3a5c` · text `#e0f7fa` · muted `#5d9bb8` · accent `#00b8d4` · accent-hot `#00f0ff` (só focus/pulse) · running `#00b8d4` · success `#23a86b` · warning `#ff6b35` · danger `#ff5252` · idle muted.
- **Paleta light**: bg `#eef1f5` · panel `#e8ecf2` · card `#f4f6f9` · border `#c4cdd8` · text `#0a1628` · muted `#5a6a7e` · accent `#0097a7`.
- **Geometria**: cantos retos ou `rounded-sm` (~2px) máx. **NUNCA `rounded-md`+**. Hairlines 1px SEMPRE.
- **Stack target**: Tailwind 4 + Radix primitives + componentes custom + augmented-ui em frames pontuais.
- **NUNCA**: Inter/Roboto · `rounded-md`+ · purple/violet · scanlines distractivas · glow excessivo · neon em larga superfície · emoji em UI (só avatar) · shadcn padrão.

## Layout geral

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ HEADER (sticky top, hairline border-bottom)                                          │
│  grupo_borges                                            [search] [settings] [theme]│
├─────────────────────────────────────────────────────────────────────────────────────┤
│ FILTER BAR (9 dropdowns + button)                                                   │
│  TIME ▾  ENV ▾  REGION ▾  STATUS ▾  ROLE ▾  MODEL ▾  OWNER ▾  PRIORITY ▾  LABEL ▾   │
│                                                                          [+ FILTER] │
├──────────────────────────────────────────────────────────────────────┬──────────────┤
│ ROW — 6 CARDS (gap 12px)                                             │ KPI PANEL    │
│  ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐                   │              │
│  │pavan ││daniel││lucas ││vinic.││felipe││barsi │                   │ ACTIVE       │
│  └──────┘└──────┘└──────┘└──────┘└──────┘└──────┘                   │ AGENTS       │
│                                                                       │   4 / 6      │
│  (área abaixo VAZIA — kanban vem no turno 3)                         │              │
│                                                                       │ ERRORS (24h) │
│                                                                       │   3          │
│                                                                       │              │
│                                                                       │ LAST SYNC    │
│                                                                       │ 2026-05-10   │
│                                                                       │ 14:22:01     │
│                                                                       │ -03:00       │
│                                                                       │              │
│                                                                       │ SYSTEM       │
│                                                                       │ HEALTH  OK   │
├──────────────────────────────────────────────────────────────────────┴──────────────┤
│ FOOTER (mono 10px, opacity 0.5, hairline border-top)                                 │
│  workspace: grupo_borges · env: prod · region: sa-east-1     user: ops_console      │
│                                                              role: admin    v1.0.0  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Mock data — use literalmente (frota real do Rica)

```json
[
  {
    "slug": "pavan",
    "name": "José Pavan",
    "role": "Consigliere",
    "emoji": "🛠️",
    "model": "opus-4.7",
    "cli": "cc",
    "status": "running",
    "instance_count": 1,
    "last_seen_seconds_ago": 45,
    "pane_excerpt": "$ tmux send-keys -t daniel '[Pavan: pegou a Fase 2?]'\n[Daniel: ack, vou pegar — abrindo o handoff bundle agora]"
  },
  {
    "slug": "daniel",
    "name": "Daniel Singh",
    "role": "Dev sênior — Líder de área",
    "emoji": "🚀",
    "model": "opus-4.7",
    "cli": "cc",
    "status": "running",
    "instance_count": 2,
    "last_seen_seconds_ago": 12,
    "pane_excerpt": "✓ Refactor connection-per-call em store.py\n  Próximo: smoke test contra ~/.claude/projects/ na VPS"
  },
  {
    "slug": "lucas",
    "name": "Lucas Marchetti",
    "role": "Diretor de Marketing",
    "emoji": "🎯",
    "model": "sonnet-4.6",
    "cli": "cc",
    "status": "blocked",
    "instance_count": 1,
    "last_seen_seconds_ago": 1830,
    "pane_excerpt": "Aguardando aprovação do Rica sobre o copy do post Instagram\nÚltimo draft em memory/2026-05-09-post-conecta.md"
  },
  {
    "slug": "vinicius",
    "name": "Vinicius Zanella",
    "role": "Especialista — Lojistas",
    "emoji": null,
    "model": "haiku-4.5",
    "cli": "cc",
    "status": "idle",
    "instance_count": 0,
    "last_seen_seconds_ago": 7200,
    "pane_excerpt": "Conversation compacted at 14:22 — aguardando próxima missão"
  },
  {
    "slug": "felipe",
    "name": "Felipe Conti",
    "role": "Especialista — Comercial",
    "emoji": null,
    "model": "opus-4.7",
    "cli": "cc",
    "status": "idle",
    "instance_count": 1,
    "last_seen_seconds_ago": 600,
    "pane_excerpt": "Pronto pro próximo email da campanha de pré-aprovação\nLojistas pendentes: 14"
  },
  {
    "slug": "barsi",
    "name": "Luiz Barsi",
    "role": "CFO read-only",
    "emoji": null,
    "model": "haiku-4.5",
    "cli": "cc",
    "status": "running",
    "instance_count": 1,
    "last_seen_seconds_ago": 90,
    "pane_excerpt": "Reconciliando fin_movimentos × extrato Conta Simples\n47/89 batidas confirmadas"
  }
]
```

**Observações:**
- Vinicius / Felipe / Barsi sem `emoji` → fallback **iniciais em JetBrains Mono peso 600 14px** sobre `--card-2` (`VZ`, `FC`, `LB`).
- `instance_count: 0` (Vinicius) → não mostrar badge. Outros mostram `[1]` ou `[2]`.

## Header

```
grupo_borges                                            [🔍] [⚙] [🌗]
```

- **Esquerda**: marca `grupo_borges` em **JetBrains Mono peso 500 ~16px**, cor `--text`. Sem ícone.
- **Direita**: 3 ícones Lucide (Search, Settings, Sun/Moon toggle), 18px, opacity 0.6 → 1 no hover. Espaçamento 16px entre eles.
- Padding vertical 16px, horizontal 24px.
- Hairline border-bottom 1px `--border`.
- Sticky top, sem backdrop blur (sci-fi sóbrio = sem efeito vidro, mantém deep navy puro).

## Filter bar

Linha abaixo do header, hairline border-bottom 1px `--border-subtle`, padding 12px 24px.

9 dropdowns + 1 button + 1 button "+ FILTER" (que adiciona filter custom). Usar Radix Select ou seu próprio (estilizado HUD).

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ TIME     │ │ ENV      │ │ REGION   │ │ STATUS   │ │ ROLE     │ ...
│ All    ▾ │ │ prod   ▾ │ │ All    ▾ │ │ All    ▾ │ │ All    ▾ │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

**Cada dropdown:**
- Frame com hairline 1px `--border`, background `--panel`, padding 8px 12px, ~96px largura.
- Cantos retos (zero radius).
- **Label uppercase**: JetBrains Mono peso 500 9px letter-spacing 0.08em opacity 0.6 (ex: `TIME`, `ENV`).
- **Valor**: JetBrains Mono regular 12px cor `--text` (ex: `All`, `prod`).
- Triangle ▾ Lucide ChevronDown 12px opacity 0.6 à direita.
- Hover: border vira `--accent-border` (cyan subtle).
- Active (open): border `--accent` + glow contido (box-shadow `0 0 4px rgba(0,184,212,0.2)`).

**Botão "+ FILTER"** à direita: variant outlined com border `--accent-border`, texto cyan accent, ícone Lucide Plus.

**Conteúdo do dropdown** (pra um exemplo: STATUS):
```
[ All        ✓ ]
  running
  idle
  blocked
  done
  offline
```
Itens em mono 12px, hover background `--accent-subtle`, check Lucide à direita do selecionado.

## Cards row

6 cards horizontais densos (do turno 1) numa row, gap 12px, padding 24px.

**Largura**: ~220px cada (6 × 220 + 5 × 12 = 1380px, cabe em viewport principal subtraindo o painel KPI lateral).

**Estados visíveis (do mock):**
- **running** (Pavan, Daniel, Barsi): dot cyan pulsante
- **blocked** (Lucas): dot laranja `#ff6b35`, sem pulse, label "BLOCKED" em uppercase
- **idle** (Vinicius, Felipe): dot muted, label "IDLE", sem pulse

**Vinicius com `instance_count: 0`**: badge instance ausente.

## Painel lateral KPI

Coluna fixa à direita, largura ~200px, fixa do topo do header até o footer (não rola junto com main content).

Background `--panel`, border-left 1px `--border`. Padding vertical 24px horizontal 20px.

Aqui vale **augmented-ui clip-corner** no topo-direito + bottom-direito do frame — pegada HUD sem ficar excessivo. Use `data-augmented-ui="tr-clip br-clip border"`.

```
┌─────────────────────────┐
│                         │
│ ACTIVE AGENTS           │  ← label uppercase mono 10px opacity 0.5
│                         │
│  4 / 6                  │  ← número grande mono peso 500 28px
│                         │
│ ─────────────────────── │  ← hairline divisor
│                         │
│ ERRORS (24h)            │
│                         │
│  3                      │  ← número grande, cor --status-warning
│                         │
│ ─────────────────────── │
│                         │
│ LAST SYNC               │
│                         │
│  2026-05-10             │  ← mono 11px
│  14:22:01               │  ← mono 11px
│  -03:00                 │  ← mono 10px opacity 0.5
│                         │
│ ─────────────────────── │
│                         │
│ SYSTEM HEALTH           │
│                         │
│  OK                     │  ← mono peso 600 16px cor --status-success
│                         │
└─────────────────────────┘
```

Cada bloco separado por hairline 1px `--border-subtle`. Espaçamento vertical generoso entre blocos (32px).

**ACTIVE AGENTS**: número formato `N / total`. Se algum offline, mostra `4 / 6` em cyan accent.
**ERRORS (24h)**: se 0, cor `--muted`. Se ≥1, cor `--status-warning`.
**SYSTEM HEALTH**: `OK` (success), `DEGRADED` (warning), `DOWN` (danger).

## Footer técnico

Sticky bottom (ou no fluxo, depende da altura da viewport). Hairline border-top 1px `--border-subtle`. Padding 8px 24px.

Tipografia: **JetBrains Mono regular 10px**, opacity 0.5.

Layout horizontal com pares `key: value` separados por `·`:

```
workspace: grupo_borges  ·  env: prod  ·  region: sa-east-1            user: ops_console  ·  role: admin  ·  v1.0.0
```

Esquerda: workspace, env, region.
Direita: user, role, version.

## Behaviors

- **Theme toggle**: clica → troca `data-theme`, anima 150ms.
- **Filter dropdowns**: hover destaca, click abre menu (Radix Select pattern).
- **Cards hover**: do turno 1 mantém.
- **KPI panel**: estático no MVP, mas pulse leve no número ACTIVE AGENTS quando alguém entra running (animação fade scale 200ms).

## Output esperado deste turno

Tela completa exceto o kanban (que vem no turno 3):
- Header + filter bar + 6 cards em row + painel KPI lateral + footer técnico
- Dark e light ambos polidos
- Hover, pulse, theme toggle funcionando
- HTML standalone com Tailwind + CSS custom properties (paleta do turno 1)

A área abaixo dos cards fica VAZIA por enquanto (vamos preencher com kanban no turno 3).

## Critério antes de devolver

- [ ] Em 1 segundo de glance dá pra identificar quem está rodando, quem travou, quem ociou
- [ ] Filter bar tem peso visual mas não compete com os cards (hairlines, mono uppercase)
- [ ] Painel KPI tem hierarquia clara: número grande > label small caps > divisor
- [ ] Footer técnico não compete com nada — pura informação seca
- [ ] Light mode tão refinado quanto dark
- [ ] Densidade boa: nada espremido, nada solto
- [ ] **Mono dominante em pelo menos 70% dos elementos textuais**

Próximo turno (3): adicionar **kanban tabular denso** abaixo dos cards (não cards verticais — formato tabela tipo Linear issues).
