/**
 * A observação depois do POST: abre `/messages/stream` para o eco e, se a
 * entrega ficar incerta, `/api/stream` para o recibo com delivery_id. Começa
 * na fronteira do POST e reconecta quando a conexão cai. O
 * cursor, a fonte e o timer de reconexão são dela; o que fazer com o texto, e
 * quando parar, quem decide é o controle (`controle-envio.ts`).
 */

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import type { FronteiraEnvio } from './envio.ts';
import { textoDaMensagem } from './leitura-do-envio.ts';
import type { EventSourceConstructor, EventSourceLike } from './spike/canario-stream-controller.ts';

export type FonteEventosEnvio = EventSourceLike;
export type ConstrutorFonteEventosEnvio = EventSourceConstructor;

type Timer = ReturnType<typeof setTimeout>;

export type OpcoesDaObservacao = {
  agentSlug: string;
  FonteEventos: ConstrutorFonteEventosEnvio | undefined;
  agendar: (callback: () => void, atrasoMs: number) => Timer;
  cancelar: (timer: Timer) => void;
  atrasoReconexaoMs: number;
  descartado: () => boolean;
  /** Um texto do Rica voltou pelo stream. Devolve se a observação cumpriu o
   *  papel — aí o stream fecha. */
  aoTexto: (item: { id: number; papel: 'user' | 'fila'; texto: string }) => boolean;
  aoEntrega: (deliveryId: string, id: number) => boolean;
  /** Na reconexão: de onde retomar, ou `undefined` se não há eco a esperar. */
  retomarDe: () => FronteiraEnvio | undefined;
};

export type ObservacaoDoEco = {
  observar(fronteira: FronteiraEnvio, deliveryId?: string): void;
  /** Fecha o stream e desarma a reconexão. */
  encerrar(): void;
};

export function criaObservacaoDoEco(opcoes: OpcoesDaObservacao): ObservacaoDoEco {
  const { agentSlug, FonteEventos, agendar, cancelar, atrasoReconexaoMs } = opcoes;
  let fonte: FonteEventosEnvio | null = null;
  let timerReconexao: Timer | undefined;
  let cursor = 0;

  function limparTimerReconexao(): void {
    if (timerReconexao === undefined) return;
    cancelar(timerReconexao);
    timerReconexao = undefined;
  }

  function fecharFonte(): void {
    fonte?.close();
    fonte = null;
  }

  function observar(fronteira: FronteiraEnvio, deliveryId?: string): void {
    if (opcoes.descartado() || !FonteEventos) return;
    fecharFonte();
    // O recibo pode preceder o item JSONL que já avançou o cursor do eco.
    cursor = deliveryId ? fronteira.id : Math.max(cursor, fronteira.id);
    const parametros = new URLSearchParams({ since_id: String(cursor), limit: '500' });
    const atual = new FonteEventos(
      deliveryId ? `/api/stream?${parametros}` :
        `/api/agents/${encodeURIComponent(agentSlug)}/messages/stream?${parametros}`,
    );
    fonte = atual;

    atual.addEventListener('entrega.confirmada', (evento) => {
      if (opcoes.descartado() || fonte !== atual || !deliveryId) return;
      try {
        const recibo = JSON.parse(evento.data);
        if (!Number.isSafeInteger(recibo.id) || recibo.id <= cursor ||
            recibo.agent_slug !== agentSlug || recibo.payload?.agent_slug !== agentSlug ||
            recibo.payload?.delivery_id !== deliveryId ||
            !['turno', 'fila', 'absorvida'].includes(recibo.payload?.via)) return;
        cursor = recibo.id;
        if (opcoes.aoEntrega(deliveryId, recibo.id)) {
          limparTimerReconexao();
          fecharFonte();
        }
      } catch { /* Recibo malformado não confirma nem move o cursor. */ }
    });

    atual.addEventListener('message', (evento) => {
      if (opcoes.descartado() || fonte !== atual) return;
      try {
        const payload = JSON.parse(evento.data) as MessagePayload;
        if (!Number.isSafeInteger(payload.id) || payload.id <= cursor) return;
        cursor = payload.id;
        const extraido = textoDaMensagem(payload);
        if (extraido === null) return;
        if (opcoes.aoTexto({ id: payload.id, papel: extraido.papel, texto: extraido.texto })) {
          limparTimerReconexao();
          fecharFonte();
        }
      } catch {
        // Evento malformado não move o cursor nem derruba a observação.
      }
    });

    atual.onerror = () => {
      if (opcoes.descartado() || fonte !== atual || timerReconexao !== undefined) return;
      fecharFonte();
      timerReconexao = agendar(() => {
        timerReconexao = undefined;
        const retomada = opcoes.retomarDe();
        if (retomada !== undefined) observar(retomada, deliveryId);
      }, atrasoReconexaoMs);
    };
  }

  return {
    observar,
    encerrar() {
      limparTimerReconexao();
      fecharFonte();
    },
  };
}
