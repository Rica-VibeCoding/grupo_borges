// V2.4 — 4 estados reduzidos. Backend retorna esses valores no /api/fleet
// e armazena no agent_state.lifecycle_status. Detail rico continua livre.
export type AgentStatus = 'ocioso' | 'trabalhando' | 'aguardando' | 'offline';

export type AgentActivityState = AgentStatus;

export type AgentActivityOverride = {
  state: AgentActivityState;
  visible_until_ms: number;
  detail: string | null;
};

export type AgentLifecycleStatus = AgentStatus;

export type SparklineBucket = {
  bucket: string;
  count: number;
  /** DS-58: SUM(input+output tokens) da hora. Sparkline plota tokens pra altura,
   *  count fica pro tooltip (msgs trocadas). Backend gap-fill com 0 garante valor. */
  tokens: number;
};

export type AgentCli = 'claude_code' | 'codex';

export type AgentModel =
  | 'claude-fable-5'
  | 'claude-opus-5'
  | 'claude-opus-4-8'
  | 'claude-opus-4-7'
  | 'claude-sonnet-5'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5'
  | 'codex-gpt-5-6-sol'
  | 'codex-gpt-5-6-terra'
  | 'codex-gpt-5-6-luna'
  | 'codex-gpt-5-5'
  | 'codex-gpt-5-4'
  | 'codex-gpt-5-4-mini'
  | 'codex-gpt-5-3-codex'
  | 'codex-gpt-5-2';

export type Agent = {
  slug: string;
  name: string;
  role: string;
  emoji: string | null;
  tmux_session: string;
  workspace_path: string;
  cli_default: string;
  model_default: string;
  model_family?: string | null; // família de modelos do agente ("kimi" no Hiro; null = Anthropic).
  capabilities: string[];
  created_at: number;
  updated_at: number;
  state_cli: string | null;
  state_model: string | null;
  current_task_id: string | null;
  current_task_last_heartbeat: number | null;
  last_seen: number | null;
  pane_excerpt: string | null;
  executor_kind: string | null;
  status_line: string | null;
  active_task_label: string | null;
  context_pct: number | null;
  /** Quando o `context_pct` foi medido, e se a medida já não vale como atual. */
  context_updated_at: number | null;
  context_stale: boolean;
  session_started_at: number | null;
  last_assistant_message: string | null;
  token_usage_json: string | null;
  codex_tokens_used: number | null;
  codex_session_processing: boolean | null;
  codex_next_fresh: boolean | null;
  /** Esforço gravado na config do agente, por família de executor — só um dos
   *  dois vem preenchido. O Claude não tem equivalente aqui: o nível dele mora
   *  no `cc_status` e só chega pelo `/painel`. */
  codex_reasoning_effort: string | null;
  kimi_reasoning_effort: string | null;
  lifecycle_status: AgentLifecycleStatus | null;
  lifecycle_detail: string | null;
  lifecycle_event: string | null;
  lifecycle_updated_at: number | null;
  pane_session_started_at: number | null;
  status: AgentStatus;
  sparkline: SparklineBucket[];
};

export type FleetKpis = {
  total: number;
  trabalhando: number;
  aguardando: number;
  ocioso: number;
  offline: number;
  tasks_active: number;
  tasks_running: number;
  tasks_blocked: number;
  tasks_done: number;
};

export type FleetHealth = {
  last_sync: number | null;
  server_now: number;
  offline_threshold_seconds: number;
  stale_threshold_seconds: number;
};

export type FleetResponse = {
  agents: Agent[];
  kpis: FleetKpis;
  health: FleetHealth;
};

export type TaskStatus = 'backlog' | 'ready' | 'running' | 'review' | 'blocked' | 'done' | 'archived';

export type ActiveTaskStatus = 'backlog' | 'ready' | 'running';

export type Task = {
  id: string;
  human_id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  instance_id: string | null;
  origin_agent: string | null;
  skill_hint: string | null;
  status: TaskStatus;
  priority: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  idempotency_key: string | null;
  current_run_id: number | null;
  current_run_status: string | null;
  current_run_last_heartbeat: number | null;
  current_run_started_at: number | null;
  current_run_ended_at: number | null;
  current_run_outcome: string | null;
  review_mode?: ReviewMode;
  reviewer_assignee?: string | null;
  tags?: string[] | null;
  image_urls?: string[] | null;
};

export type ReviewMode = 'human' | 'agent_advisory' | 'agent_autonomous';

export const REVIEW_MODE_OPTIONS: Array<{ value: ReviewMode; label: string; desc: string }> = [
  { value: 'human',            label: 'HUMANA',     desc: 'default — Rica revisa manualmente' },
  { value: 'agent_advisory',   label: 'ADVISORY',   desc: 'agente dá parecer, Rica confirma' },
  { value: 'agent_autonomous', label: 'AUTONOMOUS', desc: 'agente decide e segue (exige Success Criteria + evidence_refs)' },
];

export type ReviewAction = 'accept' | 'reject' | 'requeue';

export type ReviewActionPayload = {
  action: ReviewAction;
  note?: string | null;
  criteria_results?: Record<string, unknown> | null;
  evidence_refs?: string[] | null;
  content_hash?: string | null;
};

export type ReviewActionResponse = {
  event_id: number;
  new_status: TaskStatus;
  content_hash: string | null;
};

export type ReviewEvent = {
  id: number;
  task_id: string;
  agent_slug: string | null;
  instance_id: string | null;
  kind: 'review.accepted' | 'review.rejected' | 'review.requeued';
  payload: Record<string, unknown> | null;
  created_at: number;
  human_id: string | null;
  title: string | null;
  status: TaskStatus | null;
  assignee: string | null;
  reviewer_assignee: string | null;
  review_mode: ReviewMode | null;
  tags: string[] | null;
};

export type ReviewEventsResponse = {
  events: ReviewEvent[];
  next_since_id: number | null;
};

export type KanbanColumnId = 'queue' | 'running' | 'blocked' | 'review' | 'done';

export type KanbanColumn = {
  id: KanbanColumnId;
  name: string;
  tasks: Task[];
};

export type TaskEvent = {
  id: number;
  task_id: string | null;
  agent_slug: string | null;
  instance_id: string | null;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: number;
};

export type TaskHandoffResponse = {
  parent_id: string;
  child_id: string;
  tmux_delivered: boolean;
};

// ----- Agent modal (Fase 3): skills / docs / tables ------------------------

export type AgentSkill = {
  name: string;
  description: string;
  path: string;
  is_symlink: boolean;
  shared_from: string | null;
  size_bytes: number;
  updated_at: number;
};

export type AgentSkillsResponse = {
  slug: string;
  skills: AgentSkill[];
  count: number;
};

export type AgentDocMeta = {
  filename: string;
  title: string | null;
  size_bytes: number;
  updated_at: number;
};

export type AgentDocsResponse = {
  slug: string;
  docs: AgentDocMeta[];
  count: number;
};

export type AgentDocResolved = {
  slug: string;
  filename: string;
  content_md: string;
  truncated: boolean;
};

export type AgentTable = {
  name: string;
  db: string;
  description?: string;
};

export type AgentTablesResponse = {
  slug: string;
  tables: AgentTable[];
  count: number;
};

export type PainelTokens = {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  total: number;
};

export type PainelContexto = {
  model: string | null;
  model_family: string | null;
  context_window: number | null;
  tokens: PainelTokens;
  pct: number | null;
  source: string;
  updated_at: number | null;
  available: boolean;
  stale: boolean;
  /** Nome dado com `/rename`. Ausente até alguém nomear a sessão. */
  session_name?: string | null;
  /** `null` = a statusline daquele agente ainda não reporta o campo — não é `false`. */
  exceeds_200k?: boolean | null;
};

export type PainelEffort = {
  value: string | null;
  allowed: string[];
  source: string;
  session_may_diverge: boolean;
  // O que o painel pediu, preenchido só quando `value` veio de fonte viva e só
  // nos motores cujo back separa pedido de efetivo (Kimi e Codex — no Claude o
  // campo é sempre null). A UI compara os dois: iguais não dizem nada,
  // diferentes significam que a troca não pegou, e `requested=null` com fonte
  // viva significa que ninguém escolheu — é o default do motor.
  requested?: string | null;
};

export type PainelPermissionMode = 'ask' | 'bypassPermissions' | 'plan' | 'acceptEdits';

export type PainelPermission = {
  mode: PainelPermissionMode;
  source: string;
  session_may_diverge: boolean;
};

export type PainelQuotaWindow = {
  resets_at?: number | null;
  remaining_seconds?: number | null;
  used_percentage?: number | null;
};

export type PainelConta = {
  email?: string | null;
  display_name?: string | null;
};

export type PainelQuotas = {
  status: 'available' | 'missing' | 'stale' | 'unknown';
  source?: string | null;
  session_id?: string | null;
  updated_at?: number | null;
  stale_after_seconds: number;
  five_hour?: PainelQuotaWindow | null;
  seven_day?: PainelQuotaWindow | null;
  /** Quem paga esta cota. Só no Claude — Kimi e Codex têm login próprio. */
  conta?: PainelConta | null;
};

export type PainelSubagentEntry = {
  id: string | null;
  name: string | null;
  state: string | null;
  sessionId: string | null;
  cwd: string | null;
  model: string | null;
  context_pct: number | null;
  context_tokens: number | null;
  context_window_size: number | null;
  started_at: number | null;
  sender?: string | null;
};

export type PainelSubagents = {
  count: number;
  active_count: number;
  items: PainelSubagentEntry[];
};

// Painel Codex-nativo (Tara). Quando codex_native=true, o frontend troca os
// controles de CC: effort usa níveis Codex, FUNÇÕES vira sandbox, e Quotas/Subagents
// (sem equivalente no Codex) são ocultados. Shape espelha o backend (top-level,
// igual effort/permission/quotas).
export type PainelCodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export type PainelSandbox = {
  value: PainelCodexSandbox;
  allowed: string[];
  source: string;
  session_may_diverge: boolean;
};

// O que o driver do tmux sabe sobre a ÚLTIMA tentativa de entrega — não sobre a
// mensagem que você está mandando agora. `bloqueado` é a única leitura que
// autoriza afirmar "não entrou": nos outros dois o canal não prova nada, e a UI
// tem que continuar honesta sobre a dúvida.
//
// `mensagem` e `acao_recomendada` já chegam em prosa de operação em pt-BR, do
// `_DELIVERY_FAILURE_MESSAGES` do driver. O front NÃO traduz motivo em texto:
// quem nomeia a falha é quem a observou.
export type PainelCanalEntrega = {
  estado: 'entregando' | 'bloqueado' | 'sem_dados';
  entregando: boolean | null;
  outcome?: 'delivered' | 'refused' | 'uncertain' | null;
  safe_to_resend?: boolean;
  motivo?: string | null;
  mensagem: string;
  recusas_consecutivas: number;
  bloqueado_desde?: number | null;
  bloqueado_ha_segundos: number;
  ultima_tentativa_em?: number | null;
  acao_recomendada: string;
};

export type PainelModel = {
  value: string | null;
  allowed: string[];
  source: string;
  session_may_diverge: boolean;
  runtime_switch: boolean;
};

/**
 * Se o agente está de pé — as DUAS metades, porque elas divergem e o
 * `AgentStatus` (`offline` pra tudo) não as separa.
 *
 * - `sessao=false` — DESLIGADO. Não há o que destravar nem o que retomar.
 * - `sessao=true, processo=false` — CASCA MORTA: sessão tmux viva com o pane em
 *   bash cru (o core dump que matou lucas, barsi e felipe em 09/08). Medido em
 *   10/08: o destrava responde `pane_incompativel` e o relançar devolve
 *   `attempted:false` — o Rica clicava e não acontecia nada, sem erro na tela.
 * - `sessao=true, processo=true` — VIVO.
 *
 * Os dois primeiros mostram Ligar; só o terceiro mostra as ações do agente vivo.
 */
export type PainelVida = {
  sessao: boolean;
  processo: boolean;
};

export type AgentPainelResponse = {
  slug: string;
  generated_at: number;
  vida: PainelVida;
  contexto: PainelContexto;
  model?: PainelModel | null;
  effort: PainelEffort;
  permission: PainelPermission;
  quotas: PainelQuotas;
  subagents: PainelSubagents;
  canal_entrega: PainelCanalEntrega;
  // Presentes apenas quando o agente é Codex (executor_kind='codex').
  sandbox?: PainelSandbox | null;
  codex_native?: boolean | null;
  // true = "nova conversa" armada no painel; próximo turno começa thread fresh.
  codex_next_fresh?: boolean | null;
  // true = há um `codex exec` do tara-codex em voo (turno rodando). Alimenta o
  // botão "Parar turno" do painel.
  codex_turn_in_flight?: boolean | null;
  // false = a sessão viva do TeleCodex foi fechada pelo painel; a thread fica
  // persistida para o botão "Ligar" reabri-la no mesmo contexto.
  codex_runtime_enabled?: boolean | null;
};

export type SubagentEntry = {
  parent_uuid: string;
  agent_slug: string;
  task_id: string | null;
  visibility: boolean;
  status: string;
  session_name: string;
  started_at: number;
  spawned_by_tool: boolean;
};

export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function formatLastSeen(lastSeen: number | null, serverNow: number): string {
  if (lastSeen === null) return '—';
  const deltaSec = Math.max(0, serverNow - lastSeen);
  if (deltaSec < 60) return `há ${deltaSec}s`;
  const m = Math.floor(deltaSec / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `há ${h}h` : `há ${h}h${String(rem).padStart(2, '0')}`;
}

export function formatDuration(seconds: number, withSeconds = true): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (!withSeconds) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function shortModelName(model: string): string {
  const map: Record<string, string> = {
    'claude-fable-5':     'Fable 5',
    'claude-opus-5':      'Opus 5',
    'claude-opus-4-8':    'Opus 4.8',
    'claude-opus-4-7':    'Opus 4.7',
    'claude-opus-4-5':    'Opus 4.5',
    'claude-sonnet-5':    'Sonnet 5',
    'claude-sonnet-4-6':  'Sonnet 4.6',
    'claude-haiku-4-5':   'Haiku 4.5',
    'codex-gpt-5-6-sol':   'GPT-5.6 Sol',
    'codex-gpt-5-6-terra': 'GPT-5.6 Terra',
    'codex-gpt-5-6-luna':  'GPT-5.6 Luna',
    'codex-gpt-5-5':      'GPT-5.5',
    'codex-gpt-5-4':      'GPT-5.4',
    'codex-gpt-5-4-mini': 'GPT-5.4m',
    // 0.146.0 aposentou o `gpt-5.3-codex` e pôs este no lugar (`codex debug
    // models`). Sem entrada aqui, o menu da Tara mostraria o slug cru.
    'codex-gpt-5-3-codex-spark': 'GPT-5.3 Spark',
  };
  return map[model] ?? model;
}

export function parseContextPct(excerpt: string | null): number | null {
  if (!excerpt) return null;
  // A statusline do CC mostra o contexto como "[██░░░░░░░░] 21%" no fim do pane.
  // Banners promocionais do CC (ex.: "weekly rate limits 50% higher") também têm
  // "%", então NÃO pegar o primeiro match: ancorar na barra "]" e pegar o ÚLTIMO
  // (statusline vive no fim do pane, igual parseModelFromPane). Sem barra = sem
  // contexto confiável → null (não exibe o banner como se fosse contexto).
  const re = /]\s*(\d+)\s*%/g;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(excerpt); m !== null; m = re.exec(excerpt)) {
    last = m;
  }
  return last ? parseInt(last[1]!, 10) : null;
}

/** O pane era a fonte de primeira até 10/08, e escondia um defeito: o texto do
 *  terminal não diz de QUAL sessão ele é. Depois de um `/clear` a statusline
 *  desenhada continua sendo a da conversa apagada até o CC redesenhar, e o card
 *  publicava aquele percentual como se fosse de agora — o Rica viu 16% no
 *  Canário com o contexto já zerado. O número da API vem amarrado ao
 *  `sessionId` que está no ar e carimbado com a hora da medida, então é ele que
 *  manda; o pane fica de reserva pra quem a API ainda não sabe responder. */
export function resolveContextPct(
  agent: Pick<Agent, 'executor_kind' | 'pane_excerpt' | 'context_pct'>,
): number | null {
  if (agent.executor_kind === 'codex') return agent.context_pct;
  return agent.context_pct ?? parseContextPct(agent.pane_excerpt);
}

export function parseModelFromPane(excerpt: string | null): string | null {
  if (!excerpt) return null;
  // CC statusline aparece em dois formatos:
  //   "Sonnet 4.6 - 40:26:47 - [███░] 32%"
  //   "Sonnet 4.6 (200k context) - [███░] 81%"
  //   "claude-opus-5 - 02:50:23 - [███░] 61%"
  // Pega o último match — statusline fica no fim do pane.
  // Fable não tem decimal na versão ("Fable 5") — \d+(?:\.\d+)?
  const re =
    /\b(?:(Fable|Opus|Sonnet|Haiku)\s+(\d+(?:\.\d+)?)|claude-(fable|opus|sonnet|haiku)-(\d+(?:-\d+)*))\b/g;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(excerpt); m !== null; m = re.exec(excerpt)) {
    last = m;
  }
  if (!last) return null;
  if (last[1] && last[2]) return `${last[1]} ${last[2]}`;
  const family = last[3]!;
  return `${family[0]!.toUpperCase()}${family.slice(1)} ${last[4]!.replaceAll('-', '.')}`;
}
