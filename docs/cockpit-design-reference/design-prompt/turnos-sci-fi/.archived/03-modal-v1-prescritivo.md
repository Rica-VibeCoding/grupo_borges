# Turno 3 — Modal de detalhe (4 tabs)

> **Continuação dos turnos 1-2.** Você já tem header + filter bar + 6 cards + painel KPI + footer. Agora torne os cards **clicáveis** — click abre um modal de detalhe com 4 tabs: **Missão · Skills · Docs · Tabelas**.

## Decisões já firmadas (não mexer)

- **Sans**: Geist Sans. **Mono (dominante)**: JetBrains Mono.
- **Paleta dark**: bg `#060b18` · panel `#0d1b2a` · card `#112240` · border `#1a3a5c` · text `#e0f7fa` · muted `#5d9bb8` · accent `#00b8d4` · accent-hot `#00f0ff`.
- **Status colors**: running `#00b8d4` · success `#23a86b` · warning `#ff6b35` · danger `#ff5252` · idle muted.
- **Geometria**: cantos retos ou `rounded-sm` máx. Hairlines 1px SEMPRE. Sem sombras (exceto modal aberto).
- **Stack**: Tailwind 4 + Radix primitives + componentes custom + augmented-ui em frames pontuais.
- **NUNCA**: cantos arredondados grandes, glow excessivo, scanlines distractivas, shadcn padrão.

## Estrutura do modal

Centralizado, max-w-3xl (~768px), max-h 90vh, scroll vertical interno só quando precisar.

**Backdrop**: `rgba(6,11,24,0.7)` (deep navy translúcido) + `backdrop-blur-sm` (4px). Click fora fecha.

**Frame do modal**: background `--panel`, border 1px `--border`, **augmented-ui clip-corner top-left + bottom-right** (`data-augmented-ui="tl-clip br-clip border"`) — pegada HUD sutil. Sombra contida: `box-shadow: 0 24px 48px rgba(0,0,0,0.5), 0 0 1px rgba(0,184,212,0.15)` (cyan subtle ring).

### Header do modal

```
┌─────────────────────────────────────────────────────────────┐
│ [🚀] Daniel Singh                                       [×] │
│      daniel · Dev sênior — Líder de área                    │
└─────────────────────────────────────────────────────────────┘
```

- Avatar 48×48 `rounded-sm` (mesma linguagem do card)
- Nome em **Geist Sans peso 500 ~18px**, cor `--text`
- Slug + role: **JetBrains Mono 11px** opacity 0.6, separado por `·`. Slug em destaque (peso 500), role regular.
- Botão `×` top-right (Lucide X 16px, opacity 0.5 → 1 no hover)

Padding 20px. Hairline border-bottom 1px `--border-subtle`.

### Tabs row

```
┌─────────────────────────────────────────────────────────────┐
│  [MISSÃO]   SKILLS   DOCS   TABELAS                         │
└─────────────────────────────────────────────────────────────┘
```

- 4 tabs em **JetBrains Mono peso 500 11px UPPERCASE** letter-spacing 0.05em
- **Active**: background `rgba(0,184,212,0.12)` (`--accent-subtle` mais visível), texto `--accent`, hairline border-bottom 1px `--accent` (subtle, dentro do pill).
- **Inactive**: texto `--muted`, hover muda pra `--text` opacity 0.85.
- Padding 10px horizontal · 8px vertical por tab.
- **NÃO usar underline animado** — usar background pill estático.
- Cross-fade content 150ms ao trocar.

Padding row: 0px lateral (tabs vão até a borda interna do header), 8px vertical.

### Conteúdo de cada tab

#### Tab 1 — Missão (default ativa)

Markdown render do `SOUL.md` do agente. Use mock realista pro Daniel:

```markdown
## Quem sou

**Daniel Singh.** Dev sênior do Rica em desenvolvimento de software.
Líder da área de dev — Fluyt é o produto principal, mas atendo todo
o portfólio (Conecta Movelmar, Conecta Lojistas, Radar Fluyt, etc).

## Especialização

- Stack: Next.js + Supabase + Vercel
- Monorepo Turbo + pnpm
- Refactor + arquitetura + code review

## Fronteiras

- ✅ Dev/code/deploy/refactor de qualquer repo do Rica
- ❌ Operação dia-a-dia dos outros agentes (cada um cuida do seu)

## Regras pessoais

- Antes de codar feature de framework: Context7 obrigatório
- Reportar com 1-2 linhas de fundamento, sem dump
- Trust internal code; validar só nos boundaries
```

**Tipografia da prose:**
- Body: **Geist Sans regular 13px**, line-height 1.65, max-width prose (~62ch).
- H2 (`## Quem sou`): **JetBrains Mono peso 500 13px UPPERCASE** letter-spacing 0.05em — não Geist Sans aqui (mantém pegada técnica).
- Inline code (`` `Context7` ``): JetBrains Mono 12px, background `--card`, padding 1-3px, hairline border 1px `--border-subtle`.
- Listas: bullets em hairline cyan `--accent` (não círculos preenchidos).
- Strong: peso 600 cor `--text`.
- Links (se houver): `--accent`, underline subtle ao hover.

Padding 24px. Scroll vertical se exceder altura.

#### Tab 2 — Skills

Lista vertical, cada skill em chip horizontal denso:

```
┌─────────────────────────────────────────────────────────────┐
│ ● gmail-api                                  última: há 2h  │
│ ─────────────────────────────────────────────────────────── │
│ ● email-design                               última: há 5d  │
│ ─────────────────────────────────────────────────────────── │
│ ● voz                                        última: ontem  │
│ ─────────────────────────────────────────────────────────── │
│ ● fluyt-backlog                            última: há 30min │
│ ─────────────────────────────────────────────────────────── │
│ ● vercel:deploy                              última: há 1h  │
└─────────────────────────────────────────────────────────────┘
```

- **Dot 6px** cor `--accent` à esquerda (ou ícone Lucide se preferir, mas mantém minimal)
- **Nome da skill** em **JetBrains Mono 12px peso 500** cor `--text`
- **Última invocação** em **JetBrains Mono 11px** opacity 0.5 alinhado à direita
- Hairline divisor `--border-subtle` entre chips
- Padding 12px horizontal · 10px vertical
- Hover: background `--accent-subtle`, dot opacity 1
- Click expande accordion mostrando descrição (opcional, nice-to-have)

#### Tab 3 — Docs

File tree colapsável. Mono 12px, indentação 12px por nível.

```
▼ memory/
  ▶ 2026-05-09/
  ▶ REFERENCIA.md
  ▶ projetos/
▼ fabrica-de-software/
  ▶ INDEX.md
  ▶ design-systems/
  ▶ claude-code/
▶ AGENTS.md
▶ SOUL.md
```

- Triangle (▶ closed / ▼ open) cor `--muted` size 10px
- Folder name em mono peso 500 com `/` no fim
- File name em mono regular
- File com extensão `.md` ganha cor sutilmente diferenciada (talvez `--accent` opacity 0.7) pra criar pista visual de "documento canônico"
- Hover linha: background `--accent-subtle`
- Click folder: expande/colapsa
- Click file: highlight + (futuro) preview lateral. No MVP, só highlight.

Sem preview lateral no MVP — economiza complexidade. Futuro: split-view 50/50.

#### Tab 4 — Tabelas

Lista de tabelas DB. Mono dominante. Mini bar chart à direita pra volume relativo.

```
┌─────────────────────────────────────────────────────────────┐
│ fc_backlog              read/write   |█████████░|  87 rows │
│ fc_changelog            read         |██████░░░░| 142 rows │
│ fc_reunioes             read/write   |███░░░░░░░|  23 rows │
│ email_historico_log     read         |███████░░░| 891 rows │
└─────────────────────────────────────────────────────────────┘
```

- **Nome da tabela**: JetBrains Mono peso 500 12px
- **Permissão**: JetBrains Mono 10px UPPERCASE letter-spacing 0.05em. `READ` cor `--muted`, `READ/WRITE` cor `--accent`.
- **Mini bar**: 80px × 4px height, blocks `█` cyan accent + `░` border-subtle. Reflete volume relativo entre tabelas. JetBrains Mono 10px.
- **Row count**: JetBrains Mono 11px alinhado à direita.
- Hairline divisor entre rows.

## Animação de abertura

**Boot sequence sutil** (não slide-up dramático):

1. Backdrop fade in 150ms
2. Frame border traça do canto superior-esquerdo pro inferior-direito em 200ms (efeito "sistema iniciando") — opcional, se não couber, fade simples 150ms
3. Conteúdo fade in 100ms após o frame

Total ~250-350ms. Cubic-bezier `(0.4, 0, 0.2, 1)` (ease standard).

**Tab change**: cross-fade content 150ms.

## Keyboard navigation

- **ESC**: fecha modal
- **Tab**: navega elementos focáveis (close → tabs → conteúdo)
- **←/→**: navega entre tabs
- **Enter/Space** numa tab: ativa
- **Focus trap**: tab não escapa do modal
- **Focus visible**: outline 1px `--accent-hot` (`#00f0ff`), offset 2px, glow contido (box-shadow blur 4px alpha 0.2)

## prefers-reduced-motion

- Boot sequence vira fade simples 150ms
- Cross-fade tabs vira instantâneo

## Output esperado deste turno

Pegue o card do **Daniel** do turno 2 e faça-o **clicável**. Click abre modal com:

- Header com avatar 48×48, nome, slug, role, close
- 4 tabs (Missão default ativa)
- Conteúdo de cada tab implementado (use o mock acima pro Daniel)
- Frame com clip-corner top-left + bottom-right (augmented-ui)
- Animação boot sequence
- Keyboard nav (ESC, Tab, ←/→) funcional
- Backdrop blur + tint deep navy

Demonstre o modal aberto na tab Missão por padrão.

Os outros 5 cards não precisam ter modal próprio — só Daniel valida o pattern.

## Critério antes de devolver

- [ ] Modal centralizado bem em viewport pequena e grande
- [ ] **Clip-corner sci-fi sutil**, não exagerado (o efeito deve ser percebido só ao olhar de perto)
- [ ] Tipografia da Missão: prose com Geist Sans body + headings em JetBrains Mono UPPERCASE
- [ ] Tabs com **background pill** active (não underline animado)
- [ ] Animação contida — não dramática
- [ ] ESC fecha (testar)
- [ ] ←/→ navega entre tabs (testar)
- [ ] Light mode tão polido quanto dark
- [ ] `prefers-reduced-motion: reduce` desativa boot sequence

Próximo turno (4): adicionar **kanban tabular denso** abaixo dos cards (formato Linear-issue-table, não cards bonitinhos).
