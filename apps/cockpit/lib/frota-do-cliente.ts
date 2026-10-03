/**
 * A FROTA DE UM — o `FleetResponse` do painel do cliente, montado com o que o
 * portão serve.
 *
 * Meia tela do cockpit bebe da frota viva (`usaFrota`): a pílula do agente, a
 * statusline, a pílula de tokens, o "Pensando" do feed. Na frota ela vem de
 * `/api/fleet` + SSE `/api/stream`, e o portão não serve nenhum dos dois — o
 * cliente tem um agente só e a frota inteira é da casa. Aqui a mesma forma sai
 * de `GET /api/agents/{slug}` (o agente, com o lifecycle que o watcher grava)
 * mais `GET /api/agents/{slug}/painel` (sessão no ar e contexto).
 *
 * O status replica `derive_agent_status` (`apps/api/db/store.py`) — a regra
 * mora lá e é copiada aqui, sem invenção: sem sessão ou sem processo é
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

export function statusDoCliente(
  agente: Pick<Agent, 'lifecycle_status' | 'lifecycle_updated_at'>,
  vida: AgentPainelResponse['vida'] | null,
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

export function agenteDoCliente(cru: AgenteCru, painel: AgentPainelResponse | null, agoraS: number): Agent {
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
    status: statusDoCliente(cru, painel?.vida ?? null, agoraS),
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
