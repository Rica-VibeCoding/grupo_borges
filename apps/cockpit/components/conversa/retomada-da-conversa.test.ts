import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import {
  gravaGuardado,
  leGuardado,
  passosDaRetomada,
  retomadaDoStream,
  VALIDADE_MS,
  type Guardado,
} from './retomada-da-conversa.ts';

const msg = (id: number, role: 'user' | 'assistant', content: unknown, stop: string | null = 'end_turn') =>
  ({
    id,
    kind: role,
    is_sidechain: false,
    message: role === 'assistant' ? { role, content, stop_reason: stop } : { role, content },
  }) as unknown as MessagePayload;
const fala = (id: number, texto: string, stop: string | null = 'end_turn') => msg(id, 'assistant', [{ type: 'text', text: texto }], stop);
const pedido = (id: number) => msg(id, 'user', '🗣 como está o tempo?');
const guardado = (ouvidoAte: number): Guardado => ({ v: 1, ouvidoAte, em: 1_000 });

describe('o que fica guardado no aparelho', () => {
  it('ida e volta, e só o necessário: até onde a voz dele já tocou', () => {
    const g = guardado(42);
    assert.deepEqual(leGuardado(gravaGuardado(g), 2_000), g);
  });

  it('lixo, versão desconhecida ou vencido: nada a retomar', () => {
    assert.equal(leGuardado(null, 0), null);
    assert.equal(leGuardado('{quebrado', 0), null);
    assert.equal(leGuardado(JSON.stringify({ v: 2, ouvidoAte: 1, em: 0 }), 0), null);
    assert.equal(leGuardado(JSON.stringify({ v: 1, ouvidoAte: 'x', em: 0 }), 0), null);
    assert.equal(leGuardado(gravaGuardado(guardado(1)), 1_000 + VALIDADE_MS + 1), null);
  });
});

describe('a recarga no meio da conversa (Rica, 28/09)', () => {
  const historia = [pedido(10), fala(11, 'Resposta antiga, já ouvida.')];

  it('sem nada guardado (nunca começou, ou parou): abre em parado', () => {
    assert.equal(retomadaDoStream(null, [...historia, pedido(20)], true), null);
  });

  it('recarga no meio do "pensando": ele segue no turno, nada a tocar — a tela mostra pensando', () => {
    assert.deepEqual(retomadaDoStream(guardado(11), [...historia, pedido(20)], true), {
      cena: 'esperandoZe',
      pendentes: [],
      emVoo: true,
    });
  });

  it('a resposta que chegou inteira durante a recarga não se perde: resposta pronta, na ordem', () => {
    const r = retomadaDoStream(guardado(11), [...historia, pedido(20), fala(21, 'Primeira.'), fala(22, 'Segunda.')], false);
    assert.deepEqual(r, {
      cena: 'pronta',
      pendentes: [
        { id: 21, texto: 'Primeira.' },
        { id: 22, texto: 'Segunda.' },
      ],
      emVoo: false,
    });
  });

  it('recarga no meio do "falando": só o que não terminou de tocar volta', () => {
    const r = retomadaDoStream(guardado(21), [...historia, pedido(20), fala(21, 'Já tocou.'), fala(22, 'Faltou.', null)], true);
    assert.deepEqual(r?.pendentes, [{ id: 22, texto: 'Faltou.' }]);
    assert.equal(r?.cena, 'pronta');
  });

  it('turno já tocado não toca de novo: ele acabou e tudo tocou — nada a retomar', () => {
    assert.equal(retomadaDoStream(guardado(22), [...historia, pedido(20), fala(21, 'A.'), fala(22, 'B.')], false), null);
  });
});

describe('o toque que retoma', () => {
  it('com ele ainda no turno: volta a esperar, e o resto chega pelo stream', () => {
    assert.deepEqual(passosDaRetomada({ cena: 'esperandoZe', pendentes: [], emVoo: true }), [{ tipo: 'retomar' }]);
  });

  it('com a resposta pronta e o turno fechado: toca o que ficou e fecha o turno', () => {
    const pendentes = [
      { id: 21, texto: 'Primeira.' },
      { id: 22, texto: 'Segunda.' },
    ];
    assert.deepEqual(passosDaRetomada({ cena: 'pronta', pendentes, emVoo: false }), [
      { tipo: 'retomar' },
      { tipo: 'texto', id: 21, texto: 'Primeira.' },
      { tipo: 'texto', id: 22, texto: 'Segunda.' },
      { tipo: 'fecha' },
    ]);
  });

  it('com parte pronta e ele ainda falando: toca o que ficou, sem fechar', () => {
    const passos = passosDaRetomada({ cena: 'pronta', pendentes: [{ id: 22, texto: 'Faltou.' }], emVoo: true });
    assert.deepEqual(passos.map((p) => p.tipo), ['retomar', 'texto']);
  });
});
