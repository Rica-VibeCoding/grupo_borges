import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import {
  antesDaTroca,
  guardaMarco,
  leConversaTrocada,
  marcoGuardado,
  marcoValeAqui,
  temPrimeiroTurno,
  textosDoMarco,
} from './conversa-trocada.ts';

const CRU = {
  session_id: 'a5b2f30c',
  de: 'aacb8488',
  de_titulo: 'Estacionar e retomar',
  motivo: 'retomar',
  titulo: 'Voz em tempo real',
  nota: 'Parei no detector',
  briefing: '3 commits enquanto ela estava parada',
  at: 1_759_298_428_000,
};

function guarda() {
  const mapa = new Map<string, string>();
  return { getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => void mapa.set(k, v) };
}

const msg = (session_id: string | null, timestamp?: string) => ({ session_id, timestamp }) as unknown as MessagePayload;

describe('conversa-trocada — o evento do stream vira marco (F13)', () => {
  it('lê o evento da API', () => {
    const t = leConversaTrocada(CRU);
    assert.equal(t?.sessionId, 'a5b2f30c');
    assert.equal(t?.deTitulo, 'Estacionar e retomar');
    assert.equal(t?.emMs, CRU.at);
  });

  it('recusa evento sem conversa ou com motivo desconhecido', () => {
    assert.equal(leConversaTrocada({ ...CRU, session_id: '' }), null);
    assert.equal(leConversaTrocada({ ...CRU, motivo: 'restart' }), null);
    assert.equal(leConversaTrocada(null), null);
  });

  it('Retomar: título, nota e onde ficou a anterior', () => {
    const t = textosDoMarco(leConversaTrocada(CRU)!);
    assert.equal(t.cabeca, 'Conversa retomada');
    assert.equal(t.titulo, 'Voz em tempo real');
    assert.equal(t.nota, 'Parei no detector');
    assert.equal(t.saiu, '“Estacionar e retomar” ficou guardada no Histórico.');
  });

  it('Nova: sem título, e a anterior sem nome não vira aspas vazias', () => {
    const t = textosDoMarco(leConversaTrocada({ ...CRU, motivo: 'nova', titulo: null, nota: null, de_titulo: null })!);
    assert.equal(t.cabeca, 'Conversa nova');
    assert.equal(t.titulo, null);
    assert.equal(t.saiu, 'A conversa anterior ficou guardada no Histórico.');
  });

  it('o marco vale só enquanto o stream estiver na conversa dele', () => {
    const t = leConversaTrocada(CRU)!;
    assert.equal(marcoValeAqui(t, [msg('a5b2f30c')]), true);
    assert.equal(marcoValeAqui(t, [msg('a5b2f30c'), msg('outra')]), false);
    assert.equal(marcoValeAqui(t, []), true);
  });

  it('antes da troca é pelo relógio do servidor; sem hora, conta como antes', () => {
    const t = leConversaTrocada(CRU)!;
    assert.equal(antesDaTroca(t, msg(null, new Date(CRU.at - 1).toISOString())), true);
    assert.equal(antesDaTroca(t, msg(null, new Date(CRU.at + 1).toISOString())), false);
    assert.equal(antesDaTroca(t, msg(null)), true);
  });

  it('guarda e devolve o marco na aba, por agente', () => {
    const g = guarda();
    guardaMarco(g, 'canarinho', leConversaTrocada(CRU)!);
    assert.deepEqual(marcoGuardado(g, 'canarinho'), leConversaTrocada(CRU));
    assert.equal(marcoGuardado(g, 'pavan'), null);
  });

  it('primeiro turno: só o que o Rica mandou depois da troca, sem resíduo de comando (F16)', () => {
    const t = leConversaTrocada(CRU)!;
    const fala = (texto: string, timestamp: string) =>
      ({ kind: 'user', timestamp, created_at: 0, message: { role: 'user', content: texto } }) as unknown as MessagePayload;
    const antes = new Date(CRU.at - 5_000).toISOString();
    const depois = new Date(CRU.at + 5_000).toISOString();
    assert.equal(temPrimeiroTurno([], t), false);
    assert.equal(temPrimeiroTurno([fala('anota onde parou', antes)], t), false);
    assert.equal(temPrimeiroTurno([fala('<command-name>/clear</command-name>', depois)], t), false);
    assert.equal(temPrimeiroTurno([fala('bora', depois)], t), true);
    assert.equal(temPrimeiroTurno([fala('bora', antes)], null), true);
  });

  it('primeiro turno sem marco: a troca que falhou corta pela hora em que a lista viu vazia (F17)', () => {
    const fala = (texto: string, ms: number) =>
      ({ kind: 'user', timestamp: new Date(ms).toISOString(), created_at: 0, message: { role: 'user', content: texto } }) as unknown as MessagePayload;
    const lidaEm = CRU.at;
    // A conversa velha continua no stream: não conta.
    assert.equal(temPrimeiroTurno([fala('da conversa velha', lidaEm - 60_000)], { emMs: lidaEm }), false);
    assert.equal(temPrimeiroTurno([fala('da conversa velha', lidaEm - 60_000), fala('bora', lidaEm + 2_000)], { emMs: lidaEm }), true);
  });

  it('fala por canal e agente respondendo contam como turno; comando e pedido do cockpit não (F18)', () => {
    const em = (ms: number) => ({ timestamp: new Date(ms).toISOString(), created_at: 0 });
    const lidaEm = CRU.at;
    const depois = lidaEm + 2_000;
    const user = (texto: string, extra = {}) =>
      ({ kind: 'user', ...em(depois), message: { role: 'user', content: texto }, ...extra }) as unknown as MessagePayload;
    const resposta = (ms: number, extra = {}) =>
      ({ kind: 'assistant', ...em(ms), message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, ...extra }) as unknown as MessagePayload;
    const telegram = '<channel source="plugin:telegram:telegram" chat_id="1" user="rica">vê o deploy</channel>';
    const fila = { kind: 'queued', ...em(depois), message: null, content: telegram } as unknown as MessagePayload;

    assert.equal(temPrimeiroTurno([user(telegram)], { emMs: lidaEm }), true);
    assert.equal(temPrimeiroTurno([fila], { emMs: lidaEm }), true);
    assert.equal(temPrimeiroTurno([user('<local-command-stdout>Renamed</local-command-stdout>')], { emMs: lidaEm }), false);
    assert.equal(temPrimeiroTurno([resposta(depois)], { emMs: lidaEm }), true);
    assert.equal(temPrimeiroTurno([resposta(lidaEm - 60_000)], { emMs: lidaEm }), false);
    assert.equal(temPrimeiroTurno([user('anota onde parou', { origem: 'cockpit' }), resposta(depois, { origem: 'cockpit' })], { emMs: lidaEm }), false);
  });
});
