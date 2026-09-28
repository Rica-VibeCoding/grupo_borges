import type {
  AgentActivityState,
  AgentStatus,
  FleetResponse,
} from '@grupo_borges/cockpit-core/cockpit-types';

/**
 * QUANDO O CARD RELÊ O `/api/fleet` DEPOIS DE UM EVENTO DO SSE (28/09).
 *
 * Relia a cada evento da lista — 18 a 25 em 20 s, quase todos `jsonl:*` do
 * agente que já estava trabalhando — além do poll de 5 s, e cada aba aberta
 * multiplicava. Mas o estado que o evento anuncia já está na tela no mesmo
 * instante, pelo realce (`frota-activity.ts`); a releitura só serve pra o
 * snapshot do servidor alcançar o realce antes de ele vencer (2,5 s). Evento
 * que confirma o que o servidor já diz não tem o que alcançar.
 *
 * Por isso relê só quando o evento aponta um estado DIFERENTE do último
 * snapshot. Evento sem estado (`activityFromTaskEvent` nulo: anexo, resumo,
 * `file-history-snapshot`, comando local) também não relê: o back não mexe no
 * lifecycle por eles (`_jsonl_lifecycle`, `jsonl_watcher.py`) — o resto do
 * card (contexto, statusline, sparkline) é do poll.
 */
export function eventoPedeReleitura(
  estadoDoEvento: AgentActivityState | null,
  statusNoSnapshot: AgentStatus | undefined,
): boolean {
  if (estadoDoEvento === null) return false;
  // Agente fora do snapshot não tem card pra corrigir.
  if (statusNoSnapshot === undefined) return false;
  return estadoDoEvento !== statusNoSnapshot;
}

/** Espera depois do evento: a mesma de antes, pro back gravar o lifecycle. */
export const RELEITURA_ESPERA_MS = 250;
/**
 * Intervalo mínimo entre duas releituras por evento. Teto de segurança pro
 * caso em que o front e o back discordam da régua (o front acende com um
 * `jsonl:assistant` só de texto, o back não grava nada): aí todo evento
 * "muda o estado" e, sem teto, voltaríamos a reler em rajada.
 */
export const RELEITURA_INTERVALO_MIN_MS = 1_000;

/** Quanto esperar até reler, dado quando foi a última releitura por evento. */
export function atrasoDaReleitura(agoraMs: number, ultimaMs: number | null): number {
  if (ultimaMs === null) return RELEITURA_ESPERA_MS;
  return Math.max(RELEITURA_ESPERA_MS, ultimaMs + RELEITURA_INTERVALO_MIN_MS - agoraMs);
}

/**
 * O snapshot novo diz algo que a tela ainda não tem? `health` fica de fora: o
 * `server_now` muda a cada segundo e nenhuma tela lê o bloco. Sem esta guarda,
 * todo poll entregava um objeto novo ao contexto da frota, e o contexto
 * re-renderiza todo mundo que o consome.
 */
export function mesmaFrota(atual: FleetResponse, nova: FleetResponse): boolean {
  return (
    JSON.stringify(atual.agents) === JSON.stringify(nova.agents) &&
    JSON.stringify(atual.kpis) === JSON.stringify(nova.kpis)
  );
}

/**
 * RELEITURA PEDIDA POR QUEM MEXEU NO AGENTE. A pergunta "trocar mesmo?" do CC
 * (`pergunta_motor`) é lida da TELA e nasce sem evento nenhum: o JSONL só
 * grava o `/model`/`/effort` quando ele se resolve (comando + stdout no mesmo
 * segundo, conferido no banco em 28/09), e os hooks não chegam nesta VPS. Antes
 * ela aparecia no poll ou de carona na releitura de um evento qualquer da
 * frota; agora quem abre a pergunta — a troca de motor e o envio ao agente —
 * avisa, e a frota relê na hora e de novo quando a tela já assentou.
 */
export const EVENTO_RELEIA_FROTA = 'frota:releia';
/** Da segunda leitura: o modal do CC leva um instante pra desenhar após o envio. */
export const RELEITURA_ASSENTOU_MS = 1_500;

export function pedeReleituraDaFrota(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENTO_RELEIA_FROTA));
}
