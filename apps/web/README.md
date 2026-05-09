# `@grupo_borges/web` — Cockpit UI

Frontend do cockpit `grupo_borges`. Hospedado em Vercel; consome a API FastAPI rodando na VPS atrás de Tailscale.

> **Estado atual:** skeleton aguardando handoff bundle do Claude Design. Implementação efetiva acontece quando o bundle chegar (Etapa C do plano em `daniel/cockpit-bridge.md`).

## Stack acordada

- **Next.js** 16.x (App Router, Turbopack default)
- **React** 19.x
- **TypeScript** 5.7+ strict
- **Tailwind** 4.x (`@theme inline` em `app/globals.css`, sem `tailwind.config.js`)
- **shadcn/ui** via `pnpm dlx shadcn@latest add` quando precisar de componente
- **lucide-react** pra ícones
- **EventSource** nativo pra SSE (sem lib)

## Como vai consumir o backend

**Importante**: Vercel hospeda só o HTML/CSS/JS. As chamadas `/api/agents`, `/api/stream`, `/api/tasks` saem **diretamente do navegador do Rica** pra `https://api.<tailnet>.ts.net/...`. Pré-requisito: dispositivo do Rica está na tailnet (PC + iPhone já estão).

Env vars (Vercel → Project → Environment Variables):

```
NEXT_PUBLIC_API_URL=https://api.<seu-tailnet>.ts.net
```

CORS no backend já lista `https://grupo-borges.vercel.app` (ajustar quando o subdomínio Vercel real for criado).

## Convenções (espelham `daniel/AGENTS.md`)

- **Arquivos**: kebab-case (`agent-card.tsx`)
- **Componentes**: PascalCase no export, kebab-case no arquivo
- **Server Actions**: `lib/actions/<dominio>.ts` com `'use server'`
- **Hooks**: `hooks/use-<nome>.ts`
- **Types**: `types/` com branded IDs (`type AgentSlug = string & { readonly __brand: 'AgentSlug' }`)
- **Imports relativos curtos**: `@/components/...`, `@/lib/...`, `@/types/...`

## Estrutura esperada (após handoff)

```
apps/web/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # cockpit (tela única)
│   ├── globals.css           # @theme inline com paleta + fonts
│   └── api/                  # (opcional) BFF helpers se precisar
├── components/
│   ├── ui/                   # shadcn (Card, Dialog, Tabs, Avatar, Badge, Tooltip)
│   ├── agent-card.tsx        # 1 dos 6 cards no topo
│   ├── agent-modal.tsx       # modal 4-tabs
│   └── kanban-board.tsx      # kanban horizontal
├── lib/
│   ├── api.ts                # fetch /api/agents, EventSource /api/stream
│   ├── theme.ts              # toggle light/dark + persist localStorage
│   └── time.ts               # "há X min" auto-update
├── hooks/
│   ├── use-agents.ts         # state agentes + reconnect SSE
│   └── use-keyboard.ts       # ESC/Enter/Tab handlers
└── types/
    └── domain.ts             # AgentSlug, TaskStatus, etc
```

## Rodar localmente

Pré-requisitos: Node 22+, pnpm via corepack.

```bash
cd apps/web
corepack pnpm install
corepack pnpm dev               # Next 16 com Turbopack em :3000
```

Apontar pro backend local na VPS via SSH tunnel:

```bash
ssh -L 8000:127.0.0.1:8000 clawd@<vps>
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 corepack pnpm dev
```

## Endpoints consumidos (do backend FastAPI em `apps/api`)

| Método | Rota | Uso |
|---|---|---|
| GET  | `/api/agents`            | Lista 6 agentes + state agregado |
| GET  | `/api/agents/{slug}`     | Detalhe + state |
| GET  | `/api/stream`            | SSE — `task_events` em tempo real |
| GET  | `/health`                | Probe (não usado pela UI) |

POST `/hooks/{event_kind}` é interno do CC, não da UI.

## Build & deploy

Vercel auto-deploy ao push (após criar o projeto). Preview por PR.

```bash
corepack pnpm build              # build local
corepack pnpm start              # serve build local em :3000
```

## Não fazer

- ❌ Adicionar `tailwind.config.js` (Tailwind 4: tema mora em `@theme inline` do CSS).
- ❌ Pages Router (`pages/`) — App Router only.
- ❌ `getServerSideProps`/`getStaticProps` — usar Server Components async + `fetch({ next: { tags, revalidate } })`.
- ❌ `useFormState` — usar `useActionState` (R19).
- ❌ `next/router` — usar `next/navigation`.
- ❌ Importar emojis em UI (só no avatar do agente, vindo do `/api/agents`).
- ❌ Inter como fonte primária (handoff vai trazer Geist Sans ou similar).

## Próximos passos

1. Daniel-CC PC entrega prompt em `daniel/fabrica-de-software/cockpit-grupo-borges/design-prompt/prompt.md` ✅
2. Rica usa Claude Design → exporta handoff bundle
3. Daniel-VPS recebe bundle, implementa Next.js aqui
4. Daniel-CC PC valida UI live via Playwright + Vercel preview URL
5. Promote pra production
