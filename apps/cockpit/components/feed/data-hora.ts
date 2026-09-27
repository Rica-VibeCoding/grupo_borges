// Carimbo discreto embaixo de cada bloco de texto do agente: "02/09 09:31".
//
// Pedido do Rica (27/09): datar cada bloco da conversa, bem pequeno. Data curta
// (dia/mês, sem ano) e hora 24h, sempre no fuso dele — o servidor roda em UTC e
// um bloco das 02:30Z é do dia ANTERIOR em São Paulo.

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

const FORMATO = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Sao_Paulo',
});

/** `02/09 09:31`. Instante inválido devolve `null` — não se renderiza nada. */
export function formataDataHora(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const partes = Object.fromEntries(
    FORMATO.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  const { day, month, hour, minute } = partes;
  if (!day || !month || !hour || !minute) return null;
  return `${day}/${month} ${hour}:${minute}`;
}

/** O instante do bloco: `timestamp` (ISO) primeiro, `created_at` (unix s) de reserva. */
export function instanteDoBloco(
  payload: Pick<MessagePayload, 'timestamp' | 'created_at'>,
): number | null {
  const iso = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : NaN;
  if (Number.isFinite(iso)) return iso;
  const seg = payload.created_at;
  return typeof seg === 'number' && Number.isFinite(seg) && seg > 0 ? seg * 1_000 : null;
}
