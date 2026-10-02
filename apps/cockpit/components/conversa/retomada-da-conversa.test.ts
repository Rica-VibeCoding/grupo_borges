import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import {
  gravaGuardado,
  leGuardado,
  passosDaRetomada,
  retomadaDaTela,
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

  it('sem nada guardado (nunca começou, ou parou) e ele quieto: abre em parado', () => {
    assert.equal(retomadaDoStream(null, [...historia, pedido(20)], false), null);
  });

  it('sem nada guardado, mas ele trabalhando: abre pensando, sem tocar o que já estava no log (Rica, 30/09)', () => {
    assert.deepEqual(retomadaDoStream(null, [...historia, pedido(20), fala(21, 'Já dito.')], true), {
      cena: 'esperandoZe',
      pendentes: [],
      emVoo: true,
    });
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

describe('entrar com ele já trabalhando (Rica, 02/10)', () => {
  // Forma medida no replay do Pavan às 20:32 de 02/10: o turno principal fechou (`end_turn` e
  // `turn_duration`) e o subagente que ele despachou segue trabalhando. O stream diz "parado"; a
  // frota diz "trabalhando" — os ganchos do subagente contam para o agente.
  const fim = { id: 31, kind: 'system', subtype: 'turn_duration', duration_ms: 44_000, message: null } as unknown as MessagePayload;
  const despachou = [pedido(20), fala(30, 'O Opus já está investigando.'), fim];
  const tela = (p: Partial<Parameters<typeof retomadaDaTela>[0]>) =>
    retomadaDaTela({ estado: 'parado', status: 'live', guardado: null, mensagens: despachou, rodando: false, ocupadoNaFrota: false, ...p });

  it('o subagente dele trabalhando: a tela abre trabalhando, nunca ouvindo', () => {
    assert.deepEqual(tela({ ocupadoNaFrota: true }), { cena: 'esperandoZe', pendentes: [], emVoo: true, segundoPlano: true });
  });

  it('o replay ainda chegando e a frota dizendo trabalhando: o toque já não abre ouvindo', () => {
    assert.deepEqual(tela({ status: 'replaying', mensagens: [], ocupadoNaFrota: true }), {
      cena: 'esperandoZe',
      pendentes: [],
      emVoo: true,
      segundoPlano: true,
    });
  });

  it('o turno principal em voo segue como antes: pensando, sem ser segundo plano', () => {
    assert.deepEqual(tela({ mensagens: [pedido(20)], rodando: true, ocupadoNaFrota: true }), {
      cena: 'esperandoZe',
      pendentes: [],
      emVoo: true,
      segundoPlano: false,
    });
  });

  it('começar do zero segue igual: ele quieto e a frota quieta, nada a retomar — o toque abre ouvindo', () => {
    assert.equal(tela({}), null);
    assert.equal(tela({ status: 'replaying', mensagens: [] }), null);
  });

  it('com a conversa andando não há retomada, diga a frota o que disser', () => {
    assert.equal(tela({ estado: 'ouvindo', ocupadoNaFrota: true }), null);
  });
});
