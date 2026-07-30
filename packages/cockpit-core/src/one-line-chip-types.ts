// Types-only split de one-line-chip.tsx — separados pra que módulos puros
// (lib/render-items.ts, testes node:test) possam importar sem puxar React/
// CSS. O componente real fica em one-line-chip.tsx e re-exporta esses tipos
// pra manter a API estável.

export type OneLineChipKind =
  | 'slash'              // slash command nativo do CC (/model, /clear, …)
  | 'skill'              // skill executada (Skill tool)
  | 'tool'               // tool_use genérico (Bash, Edit, Read, …)
  | 'thinking'           // thinking part do assistant (💭 pensou Xs)
  | 'meta-decision'      // assistant text-only com padrão de meta-decisão
  | 'sidechain-cluster'  // subagent (Task tool, isolation worktree)
  | 'channel-envelope'   // channel envelope (whatsapp/telegram anexo)
  | 'task-notification'  // notificação de background task (PushNotification)
  | 'user'               // bubble user textual (mensagem do user)
  | 'user-internal'      // evento interno hook/sistema
  | 'synthetic';         // injeção do runtime CC (ScheduleWakeup sentinel, STT prefix)

export type OneLineChipTone =
  | 'idle'
  | 'active'
  | 'completed'
  | 'stalled'
  | 'error';
