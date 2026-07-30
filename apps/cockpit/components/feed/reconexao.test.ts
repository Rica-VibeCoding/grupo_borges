// Item 5 do gate, no nível do FEED.
//
// O transporte já se defende sozinho (`use-canario-stream.test.ts` trava o
// filtro de id não-crescente e a troca de conexão). O que ESTE arquivo prova é
// a costura seguinte, que nenhum dos dois lados testa: depois de passar pelo
// classificador incremental, uma reconexão que reentrega eventos não pode
// produzir dois itens com a mesma chave nem embaralhar a ordem.
//
// A chave é o que o virtualizador usa para preservar medição; chave repetida
// significa item medido no lugar do outro, e é assim que o feed "pisca".

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';
import {
  createCanarioStream,
  type EventSourceLike,
} from '../../lib/spike/use-canario-stream.ts';
import { createIncrementalRenderItems } from '../../lib/spike/render-items-incremental.ts';

import { chaveDe } from './chave.ts';

function evento(id: number, texto: string): MessagePayload {
  return {
    id,
    kind: 'user',
    uuid: `uuid-${id}`,
    parent_uuid: null,
    session_id: 'sessao',
    is_sidechain: false,
    user_type: 'external',
    timestamp: '2026-07-30T12:00:00Z',
    created_at: id,
    message: { role: 'user', content: [{ type: 'text', text: texto }] },
  };
}

class FonteFalsa implements EventSourceLike {
  static instancias: FonteFalsa[] = [];
  ouvintes = new Map<string, ((evento: { data: string }) => void)[]>();
  onerror: (() => void) | null = null;
  fechada = false;
  url: string;

  constructor(url: string) {
    this.url = url;
    FonteFalsa.instancias.push(this);
  }

  addEventListener(tipo: string, ouvinte: (evento: { data: string }) => void): void {
    const lista = this.ouvintes.get(tipo) ?? [];
    lista.push(ouvinte);
    this.ouvintes.set(tipo, lista);
  }

  close(): void {
    this.fechada = true;
  }

  emite(tipo: string, dado: unknown = {}): void {
    for (const ouvinte of this.ouvintes.get(tipo) ?? []) {
      ouvinte({ data: JSON.stringify(dado) });
    }
  }
}

/** Coalescedor síncrono: o teste não pode depender de frame do browser. */
function streamDeTeste() {
  FonteFalsa.instancias = [];
  const timers: (() => void)[] = [];
  const controlador = createCanarioStream({
    slug: 'canario',
    limit: 500,
    recentes: true,
    eventSourceConstructor: FonteFalsa,
    setTimeoutFn: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeoutFn: () => {},
    scheduleFrameFn: (callback) => {
      callback();
      return 0;
    },
    cancelFrameFn: () => {},
  });
  return {
    controlador,
    // Dispara os timers pendentes — é o que faz a reconexão agendada acontecer.
    corre: () => {
      const pendentes = timers.splice(0, timers.length);
      for (const timer of pendentes) timer();
    },
  };
}

describe('reconexão — o feed não duplica nem desordena', () => {
  it('reentrega dos MESMOS eventos após queda não gera item repetido', () => {
    const { controlador, corre } = streamDeTeste();
    const primeira = FonteFalsa.instancias[0];

    primeira.emite('replay-start');
    primeira.emite('message', evento(1, 'um'));
    primeira.emite('message', evento(2, 'dois'));
    primeira.emite('replay-end');

    // A conexão cai. O backend reentrega 1 e 2 (cursor atrasado) e manda 3.
    primeira.onerror?.();
    corre();
    const segunda = FonteFalsa.instancias[FonteFalsa.instancias.length - 1];
    assert.notEqual(segunda, primeira, 'reconexão deve abrir uma fonte nova');

    segunda.emite('replay-start');
    segunda.emite('message', evento(1, 'um'));
    segunda.emite('message', evento(2, 'dois'));
    segunda.emite('message', evento(3, 'três'));
    segunda.emite('replay-end');

    const { messages, descartados } = controlador.getSnapshot();
    const incremental = createIncrementalRenderItems();
    const chaves = incremental.update(messages).map(chaveDe);

    assert.equal(new Set(chaves).size, chaves.length, `chave repetida em ${JSON.stringify(chaves)}`);
    assert.deepEqual(chaves, ['uuid-1', 'uuid-2', 'uuid-3']);
    assert.equal(descartados, 2, 'os dois reentregues têm de aparecer no contador, não sumir');

    controlador.dispose();
  });

  it('a ordem dos itens segue a ordem dos ids, inclusive atravessando a reconexão', () => {
    const { controlador, corre } = streamDeTeste();
    const primeira = FonteFalsa.instancias[0];

    primeira.emite('replay-start');
    for (const id of [10, 11, 12]) primeira.emite('message', evento(id, `e${id}`));
    primeira.emite('replay-end');

    primeira.onerror?.();
    corre();
    const segunda = FonteFalsa.instancias[FonteFalsa.instancias.length - 1];

    segunda.emite('replay-start');
    // Um evento ATRASADO chega junto com os novos — o filtro tem de comê-lo.
    for (const id of [11, 13, 14]) segunda.emite('message', evento(id, `e${id}`));
    segunda.emite('replay-end');

    const { messages } = controlador.getSnapshot();
    const ids = messages.map((mensagem) => mensagem.id);
    assert.deepEqual(ids, [10, 11, 12, 13, 14]);
    assert.deepEqual([...ids].sort((a, b) => a - b), ids, 'a ordem não pode furar');

    controlador.dispose();
  });

  it('a chave sobrevive à reconexão — o virtualizador não perde a medição', () => {
    const { controlador, corre } = streamDeTeste();
    const primeira = FonteFalsa.instancias[0];
    primeira.emite('replay-start');
    primeira.emite('message', evento(7, 'sete'));
    primeira.emite('replay-end');

    const incremental = createIncrementalRenderItems();
    const antes = incremental.update(controlador.getSnapshot().messages).map(chaveDe);

    primeira.onerror?.();
    corre();
    const segunda = FonteFalsa.instancias[FonteFalsa.instancias.length - 1];
    segunda.emite('replay-start');
    segunda.emite('message', evento(8, 'oito'));
    segunda.emite('replay-end');

    const depois = incremental.update(controlador.getSnapshot().messages).map(chaveDe);
    assert.deepEqual(depois.slice(0, antes.length), antes, 'chave de item já visto mudou');

    controlador.dispose();
  });
});
