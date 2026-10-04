/**
 * A FROTA DE UM — o `FleetResponse` do painel do cliente, montado com o que o
 * portão serve.
 *
 * Meia tela do cockpit bebe da frota viva (`usaFrota`): a pílula do agente, a
 * statusline, a pílula de tokens, o "Pensando" do feed. Na frota ela vem de
 * `/api/fleet` + SSE `/api/stream`, e o portão não serve nenhum dos dois — o
 * cliente tem um agente só e a frota inteira é da casa. Aqui a mesma forma sai
 * do evento `state` do SSE `GET /api/agents/{slug}/events`: o agente (o mesmo
 * recorte do `GET /{slug}`, com lifecycle e statusline do pane), a `vida` e o
 * `contexto` do `/painel` e o `status` que o back já derivou.
 *
 * O status do servidor vence. A cópia de `derive_agent_status`
 * (`apps/api/db/store.py`) abaixo fica para dois casos sem ele: o SSR, que só
 * tem o `GET /{slug}`, e o `/painel` que Ligar/Desligar publicam antes do
 * próximo `state`. A regra, sem invenção: sem sessão ou sem processo é
 * `offline`; lifecycle fresco (≤ 300 s) decide entre ocioso, trabalhando e
 * aguardando; o resto é `ocioso`. Puro, para o teste.
 */
import type {
  Agent,
  AgentPainelResponse,
  AgentStatus,
  FleetResponse,
} from '@grupo_borges/cockpit-core/cockpit-types';

/** `LIFECYCLE_FRESH_THRESHOLD_SECONDS` do back. */
export const LIFECYCLE_FRESCO_S = 300;
/** `OFFLINE_THRESHOLD_SECONDS` e `RUN_STALE_THRESHOLD_SECONDS` do back, para o
 *  `health` ter a forma da frota. Nada na tela do agente lê os dois. */
const LIMIAR_OFFLINE_S = LIFECYCLE_FRESCO_S;
const LIMIAR_RUN_PARADO_S = 600;

/** O agente cru do `GET /{slug}` — sem `status` e `sparkline`, que só a frota deriva. */
export type AgenteCru = Omit<Agent, 'status' | 'sparkline'> & Partial<Pick<Agent, 'status' | 'sparkline'>>;

/** O recorte do `/painel` que o `state` traz — e que o `/painel` inteiro também satisfaz. */
export type PainelDoEstado = Pick<AgentPainelResponse, 'vida' | 'contexto'>;

/** O evento `state` do `/events` (`docs/produto-painel-cliente.md`). */
export type EstadoDoAgente = {
  agent: AgenteCru;
  painel: PainelDoEstado;
  status: AgentStatus;
  generated_at: number;
};

const STATUS_VALIDOS: readonly AgentStatus[] = ['trabalhando', 'aguardando', 'ocioso', 'offline'];

/** O `data` do evento `state`, conferido na forma. `null` = descarta: um
 *  retrato torto não pode apagar o agente da tela. */
export function leEstado(data: string): EstadoDoAgente | null {
  let corpo: unknown;
  try {
    corpo = JSON.parse(data);
  } catch {
    return null;
  }
  if (!corpo || typeof corpo !== 'object') return null;
  const { agent, painel, status, generated_at } = corpo as Record<string, unknown>;
  if (!agent || typeof agent !== 'object' || typeof (agent as { slug?: unknown }).slug !== 'string') return null;
  if (!painel || typeof painel !== 'object') return null;
  const { vida, contexto } = painel as Record<string, unknown>;
  if (!vida || typeof vida !== 'object' || !contexto || typeof contexto !== 'object') return null;
  if (!STATUS_VALIDOS.includes(status as AgentStatus)) return null;
  return {
    agent: agent as AgenteCru,
    painel: { vida, contexto } as PainelDoEstado,
    status: status as AgentStatus,
    generated_at: typeof generated_at === 'number' ? generated_at : 0,
  };
}

/** Espera antes de religar o `/events` recusado: dobra a cada falha, até 30 s. */
export function esperaParaReligar(tentativa: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, tentativa));
}

export function statusDoCliente(
  agente: Pick<Agent, 'lifecycle_status' | 'lifecycle_updated_at'>,
  vida: PainelDoEstado['vida'] | null,
  agoraS: number,
): AgentStatus {
  const fresco =
    agente.lifecycle_updated_at !== null && agoraS - agente.lifecycle_updated_at <= LIFECYCLE_FRESCO_S;
  if (agente.lifecycle_status === 'offline' && fresco) return 'offline';
  // Sem `/painel` ainda (primeira pintura): presença desconhecida não é ausência.
  if (vida && (!vida.sessao || !vida.processo)) return 'offline';
  if (fresco && (agente.lifecycle_status === 'ocioso' || agente.lifecycle_status === 'trabalhando' || agente.lifecycle_status === 'aguardando')) {
    return agente.lifecycle_status;
  }
  return 'ocioso';
}

export function agenteDoCliente(
  cru: AgenteCru,
  painel: PainelDoEstado | null,
  agoraS: number,
  statusDoServidor?: AgentStatus,
): Agent {
  const contexto = painel?.contexto;
  return {
    ...cru,
    // O contexto da frota sai do mesmo arquivo de statusline que o `/painel` lê
    // (`_read_cc_context`); os tokens são a mesma soma dos quatro campos.
    ...(contexto
      ? {
          context_pct: contexto.pct,
          context_tokens: contexto.available ? contexto.tokens.total : null,
          context_updated_at: contexto.updated_at,
          context_stale: contexto.stale,
        }
      : {}),
    // Os dois campos que a frota lê do pane (statusline): o `GET /{slug}` não
    // traz o segundo, e `undefined` ali vira `NaN:NaN` no relógio da sessão.
    pane_excerpt: cru.pane_excerpt ?? null,
    pane_session_started_at: cru.pane_session_started_at ?? null,
    status: statusDoServidor ?? statusDoCliente(cru, painel?.vida ?? null, agoraS),
    sparkline: [],
    pergunta_motor: null,
  };
}

export function frotaDoCliente(agentes: Agent[], agoraS: number): FleetResponse {
  const conta = (status: AgentStatus) => agentes.filter((a) => a.status === status).length;
  return {
    agents: agentes,
    kpis: {
      total: agentes.length,
      trabalhando: conta('trabalhando'),
      aguardando: conta('aguardando'),
      ocioso: conta('ocioso'),
      offline: conta('offline'),
      tasks_active: 0,
      tasks_running: 0,
      tasks_blocked: 0,
      tasks_done: 0,
    },
    health: {
      last_sync: agoraS,
      server_now: agoraS,
      offline_threshold_seconds: LIMIAR_OFFLINE_S,
      stale_threshold_seconds: LIMIAR_RUN_PARADO_S,
    },
  };
}
