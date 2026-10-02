// Os tipos do stream do canário: estado, opções, o controlador e a porta do
// EventSource. Saíram de `canario-stream-controller.ts` (02/10), que os reexporta.

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

export type CanarioStreamStatus =
  | 'connecting'
  | 'replaying'
  | 'live'
  | 'reconnecting';

export type CanarioStreamState = {
  messages: MessagePayload[];
  isRunning: boolean;
  isLoading: boolean;
  status: CanarioStreamStatus;
  /**
   * Eventos descartados pelo filtro de id não-crescente. O descarte protege
   * contra duplicata de reconexão, mas o item 5 do comportamento observável
   * exige paridade sem evento perdido — então o silêncio tem de ser contável.
   * Diferente de zero num teste de paridade é sinal, não ruído.
   */
  descartados: number;
};

type StreamEvent = { data: string };
type StreamListener = (event: StreamEvent) => void;

export interface EventSourceLike {
  addEventListener(type: string, listener: StreamListener): void;
  close(): void;
  onerror: (() => void) | null;
}

export interface EventSourceConstructor {
  new (url: string): EventSourceLike;
}

export type TimerHandle = number;
export type SetTimer = (callback: () => void, delayMs: number) => TimerHandle;
export type ClearTimer = (handle: TimerHandle) => void;

export type CanarioStreamOptions = {
  slug: string;
  sessionId?: string | null;
  limit?: number;
  /**
   * Faz `limit` significar TETO DE HISTÓRICO em vez de tamanho do primeiro lote.
   *
   * Sem isto, o `limit` não morde: o replay entrega os N eventos mais ANTIGOS e
   * o polling live puxa todo o resto do banco logo em seguida — 250, 500 e 1000
   * convergiam para a mesma lista, o que invalidou duas rodadas de medição de
   * escala. Ver `docs/cockpit-v2-gate.md`.
   */
  recentes?: boolean;
  eventSourceConstructor: EventSourceConstructor;
  reconnectDelayMs?: number;
  heartbeatTimeoutMs?: number;
  setTimeoutFn?: SetTimer;
  clearTimeoutFn?: ClearTimer;
  /**
   * Agendador de frame do coalescedor, separado do `setTimeoutFn` de propósito:
   * watchdog e reconexão querem delay em milissegundos, o coalescedor quer o
   * próximo frame. Sem injetar isto, o caminho LIVE é intestável — e live é
   * exatamente o que o gate G1/G4 mede. Default fica o do coalescedor (rAF).
   */
  scheduleFrameFn?: (callback: () => void) => number;
  cancelFrameFn?: (handle: number) => void;
  /**
   * O backend avisa que o histórico foi zerado (Restart sem contexto apaga os
   * eventos jsonl do agente — ver `services/session_reset.py` na API). O
   * controller NÃO se remenda: quem ouve cria outro — cursor e mensagens velhos
   * morrem com ele.
   */
  onSessionReset?: () => void;
  /** A linha trocou de conversa pelo Retomar ou pela Nova (F13). O dado vai
   *  cru: quem lê é `lib/conversa-trocada.ts`. Como no reset, o controller não
   *  se remenda — os ids da conversa retomada são mais velhos que o cursor. */
  onConversaTrocada?: (dado: unknown) => void;
  /** Avisa quando a página volta ao primeiro plano; devolve quem para de ouvir. Padrão: o
   *  `visibilitychange` e o `pageshow` do navegador. */
  aoVoltarDoFundo?: (retoma: () => void) => () => void;
};

export type CanarioStreamController = {
  getSnapshot(): CanarioStreamState;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};
