# 2026-05-10 — Design prompt: acertos + divisão de frentes

> Memo enxuta pra retomar do zero pós-compactação. Tudo aqui é decisão fechada.

## Atualização operacional — 2026-05-12

Este documento nasceu antes do port principal para `grupo_borges/apps/web/`.
O estado vivo agora é:

- **Frontend:** implementado no monorepo `/home/clawd/repos/grupo_borges`, com Next.js 16 + Tailwind 4 + Radix primitives + componentes custom. Não é mais skeleton aguardando handoff.
- **Backend:** evoluiu além da Fase 1. Já há dispatch manual auditável, stdout de tmux no card/modal, claim atômico, heartbeat/stale detection e dispatcher automático opcional ligado por env na VPS.
- **Hooks HTTP:** `PostToolUse` está configurado nos 6 workspaces principais (`pavan`, `daniel`, `lucas`, `vinicius`, `felipe`, `barsi`) apontando para `http://localhost:8000/hooks/PostToolUse`; o banco confirma eventos recebidos dos 6. A expansão para lifecycle completo (`UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`) segue opcional.
- **Designer:** os turnos canônicos foram entregues. `entregas/05-polish-v1.html` é a referência visual completa; `entregas/03-modal-v2.html` é a referência do modal aberto.
- **Tara:** existe como executora pareada Codex em `agents.yaml`, mas a frota operacional principal da UI continua centrada nos agentes de área.

## Divisão de trabalho (firmada)

- **Daniel-VPS** (sessão `tmux: daniel` em `clawd@vps:~/repos/grupo_borges`) — backend e integração operacional.
- **Daniel-CC PC / Tara-Codex** — apoio de frontend/refactor/validação conforme tarefa. O handoff Designer já virou implementação em `grupo_borges/apps/web/`.

Não duplicar trabalho. Sync via git (mesmo monorepo `grupo_borges`).

## Aspiração visual

**Console Operacional Sci-Fi Sóbrio.** Apollo Guidance + bridge de Foundation (Apple TV) + control-room IBM dos 70 + Severance UI. **NÃO** Cyberpunk hollywood. Densidade alta, monospace dominante, hairlines como linguagem visual.

## Paleta — derivada do `scifi-theme.css` do Hermes (MIT)

Localização do tema fonte: `~/study/hermes/hermes-workspace/src/scifi-theme.css` (clones em `C:\Users\RicardoBorges\study\hermes\`).

**Dark (alvo principal):**

| Token | Valor |
|---|---|
| `--bg` | `#060b18` (deep navy quase preto) |
| `--panel` | `#0d1b2a` |
| `--card` | `#112240` |
| `--border` | `#1a3a5c` (hairline visível) · `--border-subtle` `#142d4a` |
| `--text` | `#e0f7fa` (cyan ice) · `--muted` `#5d9bb8` |
| `--accent` | `#00b8d4` (cyan SÓBRIO — uso primário) · `--accent-hot` `#00f0ff` (só focus/pulse) |
| status running | `#00b8d4` (mesmo cyan accent) |
| status warning | `#ff6b35` |
| status danger | `#ff5252` |
| status success | `#23a86b` |

**Light:** bg `#eef1f5` · text `#0a1628` · accent `#0097a7`.

## Tipografia

- **JetBrains Mono dominante (≥70%)** — IDs, slugs, paths, status, headers de coluna, modelos, timestamps, números, contadores.
- **Geist Sans** — apenas em título/body/role descriptive em prose.
- **NUNCA Inter, Roboto, Helvetica, system fonts.**

## Geometria

- Cantos retos ou `rounded-sm` (~2px) **MÁX**. NUNCA `rounded-md`+ (sci-fi sóbrio = cantos retos).
- 1px hairlines SEMPRE.
- Sem sombras, exceto modal aberto (sutil com glow cyan, não drop-shadow).
- 8pt grid (8/12/16/24/32). Densidade alta — 12px é padding "respirador" típico.

## Stack-alvo (Daniel-VPS implementa)

- **Next.js 16** + **Tailwind 4** (`@theme inline`)
- **Radix UI primitives** (Dialog/Tabs/Tooltip/Select) — a11y free, sem look
- **Componentes custom** escritos do zero — **NÃO shadcn** (queremos personalidade, não convenção)
- **augmented-ui** pra clip-corners sci-fi em frames pontuais (modal, painel KPI)
- **Lucide icons** + **Phosphor (Thin)** pra ícones técnicos

## Estrutura da tela (layout fixo)

Header sticky → filter bar (9 dropdowns HUD) → 6 cards horizontais densos em row → painel KPI lateral direito → kanban tabular denso (5 colunas Linear-issue-list) → footer técnico.

> Layout estrutural NÃO muda. Componentes ganham a vibe sci-fi sóbrio.

## Approaches do prompt — coexistem

Pasta: `daniel/fabrica-de-software/cockpit-grupo-borges/design-prompt/`

- **Approach A — `turnos-sci-fi/` (USAR PRIMEIRO)** — meu, prescritivo, 5 turnos sequenciais sci-fi sóbrio:
  1. `01-foundation.md` — paleta + 1 card único do Daniel
  2. `02-grid-frota.md` — 6 cards + filter bar + KPI panel + footer
  3. `03-modal.md` — 4 tabs com clip-corner sci-fi
  4. `04-kanban.md` — tabela densa Linear-issue-list, IDs em mono colorido
  5. `05-polish.md` — SSE banner, scan-line, focus rings, prefers-reduced-motion

- **Approach B — `turnos/01-briefing.md` (fallback)** — Daniel-VPS, function-only, 187 linhas. Dá função/dados/arquitetura, deixa Designer concluir paleta/tipografia. Estrutura ligeiramente diferente: pílulas multi-instância na presença bar, sparkline dentro de cartão, gauge no footer, drag obrigatório.

Se Approach A travar o Designer, B é fallback natural.

## Refs (anexar no Claude Design)

- `design-prompt/refs/`: vercel-marketing.png · raycast-marketing.png · geist-ui.png (capturados via Playwright das marketing pages — referência tonal sóbrio).
- `~/Downloads/pasta ui/` (1.jpg, 2.jpg, 3.jpg, 4.jpg) — vocabulário sci-fi adicional. **3.jpg** é o mais próximo da direção final (já tem nomes da frota, layout tabular do kanban) — anexar como referência principal.

## Estado do backend (Daniel-VPS já entregou)

Endpoints prontos pra UI consumir:
- `GET /api/agents` — lista 6 agentes + state agregado
- `GET /api/agents/{slug}` — detalhe + state
- `GET /api/agents/{slug}/instances` — pílulas multi-instância (Literal status)
- `GET /api/agents/{slug}/sparkline` — série horária `?hours=1-168` default 24, gap fill no servidor, `HOUR_BUCKET_FMT` constante shared
- `GET /api/tasks` CRUD completo (filtros, idempotency_key 409, patch parcial)
- `GET /api/stream` — SSE polling 250ms
- `POST /hooks/{event}` — receptor 27 eventos CC (5 críticos sinalizados)
- `GET /api/fleet` — snapshot agregado usado pelo frontend
- `POST /api/tasks/{id}/dispatch` — dispatch manual auditável para tmux
- Dispatcher automático opcional — consome tasks `ready` quando `GB_AUTO_DISPATCH_ENABLED=1`

Repo: `Rica-VibeCoding/grupo_borges` no GitHub (criado pelo Daniel-VPS pós-smoke).

## Frontend

`grupo_borges/apps/web/` está implementado. A UI atual usa os snapshots Designer como referência histórica, mas a fonte viva é o código Next no monorepo.

## Caminho histórico de uso pro Rica

1. Abre chat novo em `claude.com/design`.
2. Cola `turnos-sci-fi/01-foundation.md` + anexa 3 PNGs de refs/ + 4 imagens de `~/Downloads/pasta ui/`.
3. Itera no card do Daniel até dark+light ficarem refinados.
4. Cola `02-grid-frota.md` no mesmo chat. Cada turno tem "Decisões já firmadas" no topo pra re-ancorar.
5. Repete até turno 5.
6. **Send to local coding agent** → bundle vai pro Daniel-VPS implementar em `apps/web/`.

Esse fluxo já foi executado; manter como histórico do processo de design.

## Próximas frentes

- Reconciliar checklist visual/a11y do `05-polish.md` contra a UI viva, sem tratar o briefing como plano aberto automaticamente.
- Se necessário, expandir hooks além de `PostToolUse` para lifecycle completo.
- Manter `turnos-sci-fi/` e `entregas/` como referência/histórico visual; implementação acontece em `/home/clawd/repos/grupo_borges`.
