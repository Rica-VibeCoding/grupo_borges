import type {
  ActiveTaskStatus,
  Agent,
  AgentDocResolved,
  AgentDocsResponse,
  AgentPainelResponse,
  PainelCodexSandbox,
  PainelPermissionMode,
  AgentSkillsResponse,
  AgentTablesResponse,
  FleetResponse,
  ReviewAction,
  ReviewActionPayload,
  ReviewActionResponse,
  ReviewEventsResponse,
  ReviewMode,
  SubagentEntry,
  Task,
  TaskHandoffResponse,
  TaskEvent,
  TaskStatus,
} from './cockpit-types';
import { safeUUID } from './ids.ts';

const SERVER_API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8000';

export type TaskPatchStatus = Exclude<TaskStatus, 'archived'>;

export type TaskCreatePayload = {
  title: string;
  assignee: string;
  body?: string | null;
  status?: TaskPatchStatus;
  priority?: number;
  idempotency_key?: string | null;
  review_mode?: ReviewMode;
  reviewer_assignee?: string | null;
  tags?: string[] | null;
};

export type TaskDispatchResponse = {
  task: Task;
  run_id: number;
  event_id: number;
  tmux_delivered: boolean;
};

async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') return body.detail;
  } catch {
    // Keep the original fallback when the backend did not return JSON.
  }
  return fallback;
}

export async function fetchFleet(): Promise<FleetResponse> {
  const res = await fetch(`${SERVER_API_BASE}/api/fleet`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchFleet failed: ${res.status}`);
  return res.json();
}

export async function fetchAgent(slug: string): Promise<Agent | null> {
  const res = await fetch(`${SERVER_API_BASE}/api/agents/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  // 404 = agente inexistente, caso normal de URL velha: vira notFound() na rota.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchAgent failed: ${res.status}`);
  const agent = (await res.json()) as Omit<Agent, 'status' | 'sparkline'>;
  // O endpoint não deriva `status` nem `sparkline` (só o fleet.py os calcula).
  // Defaults neutros são seguros aqui: nada na rota do agente lê esses dois
  // campos do retrato do servidor — o `StatuslineAoVivo` troca pelo agente vivo
  // da frota (`usaFrota()`) no primeiro tick do cliente.
  return { ...agent, status: 'offline', sparkline: [] };
}

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(`${SERVER_API_BASE}/api/tasks`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchTasks failed: ${res.status}`);
  return res.json();
}

export async function fetchTask(taskId: string, signal?: AbortSignal): Promise<Task> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchTask failed: ${res.status}`);
  return res.json();
}

export async function patchTaskStatus(taskId: string, status: TaskPatchStatus): Promise<Task> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`patchTaskStatus failed: ${res.status}`);
  return res.json();
}

export type TaskPatchPayload = {
  title?: string;
  body?: string | null;
  assignee?: string;
  status?: TaskPatchStatus;
  priority?: number;
  review_mode?: ReviewMode;
  reviewer_assignee?: string | null;
  tags?: string[] | null;
  instance_id?: string | null;
  skill_hint?: string | null;
};

export async function patchTask(taskId: string, fields: TaskPatchPayload): Promise<Task> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `patchTask failed: ${res.status}`));
  return res.json();
}

export async function createTask(payload: TaskCreatePayload): Promise<Task> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status}`);
  return res.json();
}

export async function dispatchTask(taskId: string, note?: string | null): Promise<TaskDispatchResponse> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: note?.trim() || null }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `dispatchTask failed: ${res.status}`));
  return res.json();
}

export async function fetchEvents(limit = 50): Promise<TaskEvent[]> {
  const res = await fetch(`${SERVER_API_BASE}/api/events?limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchEvents failed: ${res.status}`);
  return res.json();
}

// Client-side (modal): usa rewrite do next.config.ts pra /api/* → backend.
export async function fetchAgentSkills(slug: string, signal?: AbortSignal): Promise<AgentSkillsResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/skills`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchAgentSkills failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentDocs(slug: string, signal?: AbortSignal): Promise<AgentDocsResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/docs`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchAgentDocs failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentDoc(slug: string, filename: string, signal?: AbortSignal): Promise<AgentDocResolved> {
  const url = `/api/agents/${encodeURIComponent(slug)}/docs?filename=${encodeURIComponent(filename)}`;
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchAgentDoc failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentTables(slug: string, signal?: AbortSignal): Promise<AgentTablesResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/tables`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchAgentTables failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentPainel(slug: string, signal?: AbortSignal): Promise<AgentPainelResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/painel`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(await errorDetail(res, `fetchAgentPainel failed: ${res.status}`));
  return res.json();
}

export type AgentEffortChangeResponse = {
  slug: string;
  effort: string;
  source: string;
  session_may_diverge: boolean;
  written: boolean;
  // Presentes só no caminho Claude Code (runtime via /effort na sessão tmux,
  // igual a AgentModelChangeResponse); null/ausentes nos caminhos persist-only
  // de Codex e Kimi — espelha AgentPainelEffortPatchResponse do back.
  tmux_delivered?: boolean | null;
  confirmed?: boolean | null;
  runtime_switch?: boolean | null;
};

export async function patchAgentEffort(
  slug: string,
  effort: string,
): Promise<AgentEffortChangeResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/effort`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ effort }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `patchAgentEffort failed: ${res.status}`));
  return res.json();
}

/** A tropa inteira na ordem nova — posição é o índice. Ver o porquê de mandar
 *  a lista completa em `routers/fleet.py`, `patch_ordem_da_tropa`. */
export async function patchOrdemDaTropa(
  slugs: string[],
): Promise<{ slugs: string[]; source: string; written: boolean }> {
  const res = await fetch('/api/fleet/ordem', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slugs }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `patchOrdemDaTropa failed: ${res.status}`));
  return res.json();
}

export async function patchAgentPermissionMode(
  slug: string,
  mode: PainelPermissionMode,
): Promise<{ slug: string; mode: PainelPermissionMode; source: string; session_may_diverge: boolean; written: boolean }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/permission-mode`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `patchAgentPermissionMode failed: ${res.status}`));
  return res.json();
}

// Painel Codex-nativo — sandbox da Tara (no lugar de bypass/plan do CC).
export async function patchAgentCodexSandbox(
  slug: string,
  sandbox: PainelCodexSandbox,
): Promise<{ slug: string; sandbox: PainelCodexSandbox; written: boolean }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/codex-sandbox`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sandbox }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `patchAgentCodexSandbox failed: ${res.status}`));
  return res.json();
}

// Painel Codex-nativo — arma "nova conversa" pro próximo turno (consumido no /input).
export async function patchAgentCodexNewThread(
  slug: string,
  armed: boolean,
): Promise<{
  slug: string;
  armed: boolean;
  thread_started?: boolean;
  thread_pending?: boolean;
  thread_id?: string | null;
}> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/codex-new-thread`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ armed }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `patchAgentCodexNewThread failed: ${res.status}`));
  return res.json();
}

// Painel Codex-nativo — derruba o turno em voo (o `codex exec` do tara-codex).
export async function postAgentCodexStop(
  slug: string,
): Promise<{ stopped: boolean; reason?: string }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/codex-stop`, {
    method: 'POST',
  });
  if (!res.ok) {
    const detail = await errorDetail(res, `postAgentCodexStop failed: ${res.status}`);
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

// ----- DS-2: chat / model endpoints --------------------------------------

export type ChatModelSlug = 'fable' | 'opus' | 'sonnet' | 'haiku';

// DS-69 — slugs canônicos dos modelos Codex (espelham allowlist do backend e
// `tmux_driver._CODEX_MODEL_MAP`). Tara troca por estes; Claude Code não.
export type CodexModelSlug =
  | 'codex-gpt-5-6-sol'
  | 'codex-gpt-5-6-terra'
  | 'codex-gpt-5-6-luna'
  | 'codex-gpt-5-5'
  | 'codex-gpt-5-4'
  | 'codex-gpt-5-4-mini'
  | 'codex-gpt-5-3-codex'
  | 'codex-gpt-5-2';

export type KimiModelSlug = 'kimi-k3' | 'kimi-k2.7-code' | 'kimi-k2.7-code-highspeed';

export type AnyModelSlug = ChatModelSlug | CodexModelSlug | KimiModelSlug;

export type AgentInputResponse = {
  tmux_delivered: boolean;
  sent_at: number;
};

export type AgentModelChangeResponse = {
  tmux_delivered: boolean;
  state_persisted: boolean;
  confirmed: boolean;
  model: string;
  // DS-69 — false quando a troca só vale na próxima execução (Codex).
  runtime_switch: boolean;
};

export class AgentInputError extends Error {
  readonly status: number;
  readonly detail: string | null;
  readonly deliveryOutcome: 'refused' | 'uncertain' | null;
  readonly reason: string | null;
  readonly safeToResend: boolean | null;

  constructor(
    message: string,
    status: number,
    detail: string | null,
    delivery?: {
      outcome: 'refused' | 'uncertain';
      reason: string | null;
      safeToResend: boolean;
    },
  ) {
    super(message);
    this.name = 'AgentInputError';
    this.status = status;
    this.detail = detail;
    this.deliveryOutcome = delivery?.outcome ?? null;
    this.reason = delivery?.reason ?? null;
    this.safeToResend = delivery?.safeToResend ?? null;
  }
}

async function agentInputError(res: Response): Promise<AgentInputError> {
  const fallback = `postAgentInput failed: ${res.status}`;
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === 'string') {
      return new AgentInputError(detail, res.status, detail);
    }
    if (
      typeof detail?.code === 'string' &&
      (detail.delivery_outcome === 'refused' || detail.delivery_outcome === 'uncertain') &&
      (typeof detail.reason === 'string' || detail.reason === null) &&
      typeof detail.safe_to_resend === 'boolean'
    ) {
      return new AgentInputError(detail.code, res.status, detail.code, {
        outcome: detail.delivery_outcome,
        reason: detail.reason,
        safeToResend: detail.safe_to_resend,
      });
    }
  } catch {
    return new AgentInputError(fallback, res.status, fallback);
  }
  return new AgentInputError(fallback, res.status, fallback);
}

export async function postAgentInput(
  slug: string,
  text: string,
  options?: { fresh?: boolean },
): Promise<AgentInputResponse> {
  const idempotency_key = safeUUID();
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, idempotency_key, fresh: options?.fresh ?? false }),
  });
  if (!res.ok) {
    throw await agentInputError(res);
  }
  return res.json();
}

export async function postAgentImage(
  slug: string,
  file: File,
  caption?: string,
): Promise<{ tmux_delivered: boolean }> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  if (caption?.trim()) fd.append('caption', caption.trim());
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/image`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const detail = await errorDetail(
      res,
      res.status === 404 || res.status === 501
        ? 'endpoint de imagem não disponível ainda (back-end pendente)'
        : `postAgentImage failed: ${res.status}`,
    );
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

export async function postAgentDestrava(
  slug: string,
): Promise<{ tmux_delivered: boolean; sent_at: number }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/destrava`, {
    method: 'POST',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`postAgentDestrava ${res.status}: ${txt}`);
  }
  return res.json();
}

/**
 * Para a geração em curso — o `■` do composer. Não é destrutivo: a sessão e a
 * conversa continuam de pé, e mandar de novo recomeça. Por baixo é `Escape` no
 * pane (Claude Code) ou `/control/abort` (Codex); o front não precisa saber
 * qual, e é o backend que decide pelo motor do agente.
 */
export async function postAgentInterromper(
  slug: string,
): Promise<{ motor: string; parado: boolean }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/interromper`, {
    method: 'POST',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`postAgentInterromper ${res.status}: ${txt}`);
  }
  return res.json();
}

export type RelaunchResponse = {
  tmux_delivered: boolean;
  attempted: boolean;
  session_id: string | null;
  sent_at: number;
};

/**
 * Relança o Claude Code do agente.
 *
 * `resume=true` (padrão): sobe com `--resume`, preservando a conversa — o
 * turno em andamento é perdido, o histórico não. `resume=false`: sobe um
 * Claude Code do zero na mesma window, sem checar conversa nenhuma — usado
 * quando o pane travou de um jeito que nem o resume confirma (âncora não
 * bate) ou quando perder o contexto é o que se quer.
 *
 * O `confirm: true` não é cerimônia do cliente: o back RECUSA (400) sem ele.
 * A confirmação de verdade — a que protege o Rica — é o segundo toque na
 * interface; este campo é o contrato que garante que ninguém chame a rota por
 * engano de um script ou de um `curl` de teste.
 *
 * Lança `AgentInputError` com o `detail` do back preservado: quem traduz o
 * motivo é `diagnosticaRelancar`, e ele casa por substring do detail
 * (`resume_session_not_found`, `relaunch_somente_claude_code`, …). Perder o
 * detail aqui deixaria a tela sem ter o que dizer além de "falhou".
 */
export async function postAgentRelaunch(
  slug: string,
  resume = true,
): Promise<RelaunchResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/relaunch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true, resume }),
  });
  if (!res.ok) {
    const detail = await errorDetail(res, `postAgentRelaunch failed: ${res.status}`);
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

export type DesligarResponse = {
  /** `false` só quando um scope resistiu ao `stop` — já desligado é sucesso. */
  tmux_delivered: boolean;
  /** `false` quando não havia sessão: o botão é idempotente. */
  attempted: boolean;
  sessao_encerrada: boolean;
  /** Os cgroups da cerca da frota que foram parados — claude, MCPs e o `bun`
   *  do plugin de uma vez. É o que `tmux kill-session` sozinho nunca alcançou. */
  scopes_parados: string[];
  scopes_resistiram: string[];
  /** `true` quando o desligar pegou um boot ainda em curso e o cancelou. */
  boot_cancelado: boolean;
  sent_at: number;
};

/**
 * Desliga o agente e tudo que ele consome. Destrutivo: `confirm` obrigatório no
 * corpo, mesma régua do relançar.
 */
export async function postAgentDesligar(slug: string): Promise<DesligarResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/desligar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true }),
  });
  if (!res.ok) {
    const detail = await errorDetail(res, `postAgentDesligar failed: ${res.status}`);
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

/**
 * Liga o agente pelo boot canônico da frota, com `--continue`. Sem `confirm`:
 * ligar não destrói nada, então é toque simples como o destrava.
 */
export async function postAgentLigar(
  slug: string,
): Promise<{ tmux_delivered: boolean; attempted: boolean; sent_at: number }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/ligar`, {
    method: 'POST',
  });
  if (!res.ok) {
    const detail = await errorDetail(res, `postAgentLigar failed: ${res.status}`);
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

export async function postAgentClear(
  slug: string,
): Promise<{ tmux_delivered: boolean; sent_at: number }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/clear`, {
    method: 'POST',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`postAgentClear ${res.status}: ${txt}`);
  }
  return res.json();
}

export type QuotaRefreshResponse = {
  refreshed: boolean;
  reason: string | null;
};

/**
 * Força o CC a reconsultar `rate_limits` — `/usage` + `r`, o retry
 * documentado em code.claude.com/docs/en/costs.md — em vez de esperar o
 * próximo `/clear`. A cota não se atualiza sozinha durante a sessão (ver
 * shared_rate_limits_congela_ate_clear.md).
 *
 * `refreshed: false` com 200 é falha "normal" (canal indisponível, tela não
 * abriu) — só 409 (`agent_busy`) vira `AgentInputError`, porque só esse caso
 * tem uma causa acionável ("espera o agente ficar livre") pro chamador
 * traduzir na tela.
 */
export async function postAgentQuotaRefresh(slug: string): Promise<QuotaRefreshResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/quotas/refresh`, {
    method: 'POST',
  });
  if (!res.ok) {
    const detail = await errorDetail(res, `postAgentQuotaRefresh failed: ${res.status}`);
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

export async function postAgentVoice(
  slug: string,
  audioBlob: Blob,
): Promise<{ transcribed: string; tmux_delivered: boolean; duration_ms: number }> {
  const fd = new FormData();
  // Extensão segue o mime real do blob. Server confia no Content-Type, mas
  // filename correto ajuda em debug/log.
  const ext = audioBlob.type.includes('mp4')
    ? 'mp4'
    : audioBlob.type.includes('ogg')
      ? 'ogg'
      : 'webm';
  fd.append('audio', audioBlob, `voice.${ext}`);
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/voice`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`postAgentVoice ${res.status}: ${txt}`);
  }
  return res.json();
}

export async function postAgentModel(
  slug: string,
  // `AnyModelSlug | (string & {})` mantém o autocompletar dos slugs conhecidos
  // sem fechar a porta: o catálogo Codex é lido do `codex debug models` em
  // tempo de execução, e um Literal fechado aqui recusaria em compilação o
  // modelo que o back acabou de oferecer em `painel.model.allowed`.
  model: AnyModelSlug | (string & {}),
  options?: { force?: boolean },
): Promise<AgentModelChangeResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, force: options?.force ?? false }),
  });
  if (!res.ok) {
    const detail = await errorDetail(res, `postAgentModel failed: ${res.status}`);
    throw new AgentInputError(detail, res.status, detail);
  }
  return res.json();
}

// Mapeia state_model/model_default longo (claude-opus-4-7, etc) pro slug curto
// aceito pelo POST /model (whitelist fable|opus|sonnet|haiku). Codex retorna null —
// caller decide se renderiza dropdown (não renderiza pra Codex).
export function toShortModelSlug(model: string | null | undefined): ChatModelSlug | null {
  if (!model) return null;
  if (model.includes('fable')) return 'fable';
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';
  return null;
}

// DS-69 — slugs Codex são canônicos (state_model já vem como `codex-gpt-*`).
// Valida contra a lista fechada; qualquer coisa fora vira null (UI cai no default).
const CODEX_MODEL_SLUGS: readonly CodexModelSlug[] = [
  'codex-gpt-5-6-sol',
  'codex-gpt-5-6-terra',
  'codex-gpt-5-6-luna',
  'codex-gpt-5-5',
  'codex-gpt-5-4',
  'codex-gpt-5-4-mini',
  'codex-gpt-5-3-codex',
  'codex-gpt-5-2',
];

export function toCodexModelSlug(model: string | null | undefined): CodexModelSlug | null {
  if (!model) return null;
  return CODEX_MODEL_SLUGS.find((slug) => slug === model) ?? null;
}

const KIMI_MODEL_SLUGS: readonly KimiModelSlug[] = [
  'kimi-k3',
  'kimi-k2.7-code',
  'kimi-k2.7-code-highspeed',
];

const KIMI_RAW_MODEL_TO_SLUG: Record<string, KimiModelSlug> = {
  k3: 'kimi-k3',
  'kimi-for-coding': 'kimi-k2.7-code',
  'kimi-for-coding-highspeed': 'kimi-k2.7-code-highspeed',
};

export function toKimiModelSlug(model: string | null | undefined): KimiModelSlug | null {
  if (!model) return null;
  return KIMI_MODEL_SLUGS.find((slug) => slug === model) ?? KIMI_RAW_MODEL_TO_SLUG[model] ?? null;
}

// ----- TK-25: leitura read-only do Codex local (Tara) --------------------

export type CodexThreadSummary = {
  thread_id: string;
  rollout_path: string;
  cwd: string;
  title: string;
  model: string | null;
  reasoning_effort: string | null;
  tokens_used: number;
  updated_at_ms: number | null;
  created_at_ms: number | null;
  source: 'codex-local';
};

export type CodexMessage = {
  id: string;
  role: 'user' | 'assistant' | 'internal';
  text: string;
  timestamp: string;
  item_type: string;
  visible: boolean;
};

export type CodexMessagesResponse = {
  source: 'codex-local';
  thread_id: string | null;
  model: string | null;
  tokens_used: number | null;
  updated_at_ms: number | null;
  messages: CodexMessage[];
  hidden_count: number;
};

export async function getCodexThread(
  slug: string,
  signal?: AbortSignal,
): Promise<CodexThreadSummary | null> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/codex/thread`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(`getCodexThread failed: ${res.status}`);
  const body = (await res.json()) as { thread: CodexThreadSummary | null };
  return body.thread;
}

export async function getCodexMessages(
  slug: string,
  signal?: AbortSignal,
): Promise<CodexMessagesResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/codex/messages`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(`getCodexMessages failed: ${res.status}`);
  return res.json();
}

export async function listAgentTasks(
  slug: string,
  statuses: ActiveTaskStatus[] = ['running', 'ready', 'backlog'],
  signal?: AbortSignal,
): Promise<Task[]> {
  const qs = new URLSearchParams({
    assignee: slug,
    status: statuses.join(','),
  });
  const res = await fetch(`/api/tasks?${qs.toString()}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`listAgentTasks failed: ${res.status}`);
  return res.json();
}

export async function postTaskHandoff(
  taskId: string,
  payload: { to_agent: string; note?: string | null; idempotency_key: string },
): Promise<TaskHandoffResponse> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`postTaskHandoff failed: ${res.status}`);
  return res.json();
}

export async function reviewTask(
  taskId: string,
  payload: ReviewActionPayload,
  reviewerSlug?: string | null,
): Promise<ReviewActionResponse>;
export async function reviewTask(
  taskId: string,
  action: ReviewAction,
  body?: Omit<ReviewActionPayload, 'action'>,
  reviewerSlug?: string | null,
): Promise<ReviewActionResponse>;
export async function reviewTask(
  taskId: string,
  actionOrPayload: ReviewAction | ReviewActionPayload,
  bodyOrReviewer?: Omit<ReviewActionPayload, 'action'> | string | null,
  reviewerMaybe?: string | null,
): Promise<ReviewActionResponse> {
  const payload: ReviewActionPayload =
    typeof actionOrPayload === 'string'
      ? {
          action: actionOrPayload,
          ...((bodyOrReviewer as Omit<ReviewActionPayload, 'action'> | undefined) ?? {}),
        }
      : actionOrPayload;
  const reviewerSlug =
    typeof actionOrPayload === 'string'
      ? reviewerMaybe
      : (bodyOrReviewer as string | null | undefined);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (reviewerSlug) headers['X-Reviewer-Slug'] = reviewerSlug;
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `reviewTask failed: ${res.status}`));
  return res.json();
}

export async function fetchReviews(
  filters: { reviewer?: string | null; since_id?: number | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<ReviewEventsResponse> {
  const qs = new URLSearchParams();
  if (filters.reviewer) qs.set('reviewer', filters.reviewer);
  if (filters.since_id !== null && filters.since_id !== undefined) {
    qs.set('since_id', String(filters.since_id));
  }
  qs.set('limit', String(filters.limit ?? 50));
  const res = await fetch(`/api/reviews?${qs.toString()}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(await errorDetail(res, `fetchReviews failed: ${res.status}`));
  return res.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await errorDetail(res, `deleteTask failed: ${res.status}`));
}

export type SubsessionSpawnPayload = {
  task_id: string;
  prompt: string;
  visibility: boolean;
  skill?: string;
};

export type SubsessionSpawnResult = {
  subsession_id: string;
  session_name: string;
  status: string;
};

export async function spawnSubsession(
  agentSlug: string,
  payload: SubsessionSpawnPayload,
): Promise<SubsessionSpawnResult> {
  const body = { ...payload, agent_slug: agentSlug };
  const res = await fetch(`/api/agents/${encodeURIComponent(agentSlug)}/subagents/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorDetail(res, `spawnSubsession failed: ${res.status}`));
  return res.json();
}

// ----- JP-25: MCP painel inline -----------------------------------------

export type McpServerKind = 'plugin' | 'mcp_json' | 'remote' | 'user_scope' | 'agent_user';

export type McpProvides = 'skill' | 'mcp' | 'subagent' | 'hook' | 'lsp';

export type McpServer = {
  kind: McpServerKind;
  id: string;
  name: string;
  enabled: boolean;
  transport?: string | null;
  description?: string | null;
  command_redacted?: string | null;
  provides?: McpProvides[] | null;
};

export type AgentMcpResponse = { servers: McpServer[] };

export type AgentMcpPatchResponse = { applied: boolean; requires_reload: boolean };

export type AgentMcpReloadResponse = { tmux_delivered: boolean };

export async function getAgentMcp(slug: string, signal?: AbortSignal): Promise<AgentMcpResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/mcp`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error(await errorDetail(res, `getAgentMcp failed: ${res.status}`));
  return res.json();
}

export async function patchAgentMcp(
  slug: string,
  kind: McpServerKind,
  id: string,
  enabled: boolean,
): Promise<AgentMcpPatchResponse> {
  const res = await fetch(
    `/api/agents/${encodeURIComponent(slug)}/mcp/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!res.ok) throw new Error(await errorDetail(res, `patchAgentMcp failed: ${res.status}`));
  return res.json();
}

export async function postAgentMcpReload(slug: string): Promise<AgentMcpReloadResponse> {
  const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/mcp/reload`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await errorDetail(res, `postAgentMcpReload failed: ${res.status}`));
  return res.json();
}

export async function fetchTaskSubsessions(
  agentSlug: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<SubagentEntry[]> {
  const url = `/api/agents/${encodeURIComponent(agentSlug)}/subagents?task_id=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`fetchTaskSubsessions failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.subagents ?? []);
}
