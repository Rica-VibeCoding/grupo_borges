/**
 * A observação do stream depois do POST: abre o `/messages/stream` a partir da
 * fronteira que o servidor devolveu, entrega ao controle cada texto do Rica que
 * volta (eco `user` ou recibo da fila) e reconecta quando a conexão cai. O
 * cursor, a fonte e o timer de reconexão são dela; o que fazer com o texto, e
 * quando parar, quem decide é o controle (`controle-envio.ts`).
 */

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import type { FronteiraEnvio } from './envio.ts';
import { textoDaMensagem } from './leitura-do-envio.ts';

type EventoSse = { data: string };
type OuvinteSse = (evento: EventoSse) => void;

export interface FonteEventosEnvio {
  addEventListener(tipo: string, ouvinte: OuvinteSse): void;
  close(): void;
  onerror: (() => void) | null;
}

export interface ConstrutorFonteEventosEnvio {
  new (url: string): FonteEventosEnvio;
}

type Timer = ReturnType<typeof setTimeout>;

export type OpcoesDaObservacao = {
  agentSlug: string;
  FonteEventos: ConstrutorFonteEventosEnvio | undefined;
  agendar: (callback: () => void, atrasoMs: number) => Timer;
  cancelar: (timer: Timer) => void;
  atrasoReconexaoMs: number;
  descartado: () => boolean;
  /** Um texto do Rica voltou pelo stream. */
  aoTexto: (item: { id: number; papel: 'user' | 'fila'; texto: string }) => void;
  /** Lido depois de cada texto: a observação já cumpriu o papel? */
  cumpriu: () => boolean;
  /** Roda ao cumprir, antes de fechar o stream. */
  aoCumprir: () => void;
  /** Na reconexão: de onde retomar, ou `undefined` se não há eco a esperar. */
  retomarDe: () => FronteiraEnvio | undefined;
};

export type ObservacaoDoEco = {
  observar(fronteira: FronteiraEnvio): void;
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

  function observar(fronteira: FronteiraEnvio): void {
    if (opcoes.descartado() || !FonteEventos) return;
    fecharFonte();
    cursor = Math.max(cursor, fronteira.id);
    const parametros = new URLSearchParams({ since_id: String(cursor), limit: '500' });
    const atual = new FonteEventos(
      `/api/agents/${encodeURIComponent(agentSlug)}/messages/stream?${parametros}`,
    );
    fonte = atual;

    atual.addEventListener('message', (evento) => {
      if (opcoes.descartado() || fonte !== atual) return;
      try {
        const payload = JSON.parse(evento.data) as MessagePayload;
        if (!Number.isSafeInteger(payload.id) || payload.id <= cursor) return;
        cursor = payload.id;
        const extraido = textoDaMensagem(payload);
        if (extraido === null) return;
        opcoes.aoTexto({ id: payload.id, papel: extraido.papel, texto: extraido.texto });
        // Confirmado pela fila NÃO encerra a observação: o eco `user` da
        // drenagem ainda precisa chegar para apagar a marca `fila` — senão o
        // composer fica preso no "entrou na fila" para sempre.
        if (opcoes.cumpriu()) {
          opcoes.aoCumprir();
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
        // O endpoint reexecuta o replay a partir deste cursor. Ainda assim, se
        // o servidor algum dia não conseguir reter/replayar o intervalo da
        // queda, um eco pode ser perdido e o envio ficará
        // `nao-confirmado`. Não há reconciliação adicional nesta rodada.
        const retomada = opcoes.retomarDe();
        if (retomada !== undefined) observar(retomada);
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
