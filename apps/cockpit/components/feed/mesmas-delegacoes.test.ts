import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Delegacao } from '../../app/api/delegacoes/delegacoes.ts';
import { estabilizaDelegacoes } from './mesmas-delegacoes.ts';

const d = (extra: Partial<Delegacao> = {}): Delegacao => ({
  quem: 'Tara', delegador: 'daniel', alvo: 'tara', inicio: 100, pid: 42, ...extra,
});

describe('estabilizaDelegacoes', () => {
  it('vazio seguido de vazio devolve a lista ATUAL (o caso do agente parado)', () => {
    const atual: Delegacao[] = [];
    assert.equal(estabilizaDelegacoes(atual, []), atual);
  });

  it('mesmo conteúdo em objetos novos devolve a atual', () => {
    const atual = [d(), d({ pid: 43, alvo: 'barsi', quem: 'Barsi' })];
    assert.equal(estabilizaDelegacoes(atual, [d(), d({ pid: 43, alvo: 'barsi', quem: 'Barsi' })]), atual);
  });

  it('qualquer campo diferente, tamanho ou ordem devolve a nova', () => {
    const atual = [d(), d({ pid: 43 })];
    for (const nova of [[d()], [d(), d({ pid: 44 })], [d({ pid: 43 }), d()], [d({ inicio: 101 }), d({ pid: 43 })]]) {
      assert.equal(estabilizaDelegacoes(atual, nova), nova);
    }
  });
});
