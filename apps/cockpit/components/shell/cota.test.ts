import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PainelQuotas } from '@grupo_borges/cockpit-core/cockpit-types';

import { leiaCota } from './cota.ts';

/** Relógio fixo — a idade da leitura velha é a única coisa aqui que depende do
 *  tempo, e teste que depende de `Date.now()` real muda de resposta sozinho. */
const AGORA = 1_786_150_000;

function quotas(patch: Partial<PainelQuotas> = {}): PainelQuotas {
  return { status: 'available', stale_after_seconds: 300, ...patch };
}

describe('os quatro status — nenhum deles pode derrubar o painel', () => {
  it("`available` com as duas janelas: número e reset nos dois", () => {
    const leitura = leiaCota(
      quotas({
        five_hour: { used_percentage: 37.2, remaining_seconds: 7_800 },
        seven_day: { used_percentage: 71, remaining_seconds: 398_929 },
      }),
      AGORA,
    );

    // `assert.equal` do `node:assert/strict` é `strictEqual`, que carrega
    // `asserts actual is T` — daqui pra baixo o TS já sabe o estado.
    assert.equal(leitura.estado, 'viva');
    assert.equal(leitura.aviso, null);
    // `ceil`, não `round`: 37.2 vira 38 pra bater com o display do claude.ai.
    assert.deepEqual(
      leitura.janelas.map((j) => [j.rotulo, j.pct, j.reset]),
      [
        ['5h', 38, 'reset em 2h 10m'],
        ['7d', 71, 'reset em 4d 14h'],
      ],
    );
  });

  it('`stale`: o número CONTINUA na tela, com a idade da leitura junto', () => {
    const leitura = leiaCota(
      quotas({
        status: 'stale',
        updated_at: AGORA - 90_000,
        five_hour: null,
        seven_day: { used_percentage: 71, remaining_seconds: 398_929 },
      }),
      AGORA,
    );

    assert.equal(leitura.estado, 'velha');
    assert.equal(leitura.aviso, 'dados antigos · lida há 1d 1h');
    // Esconder a cota velha seria o buraco de novo: velha marcada é dado.
    assert.equal(leitura.janelas[1].pct, 71);
    // A Tara devolve exatamente isto hoje — `five_hour: null` com `seven_day`
    // cheio. A janela vazia não some da tela: vira "sem leitura", senão
    // ninguém sabe se a cota de 5h é zero ou é falta de dado.
    assert.equal(leitura.janelas[0].pct, null);
    assert.equal(leitura.janelas[0].reset, 'sem leitura');
  });

  it('`missing` e `unknown` viram recado, nunca bloco vazio', () => {
    for (const status of ['missing', 'unknown'] as const) {
      const leitura = leiaCota(quotas({ status }), AGORA);
      assert.equal(leitura.estado, 'sem-dado', status);
      assert.match(leitura.recado, /indisponível/);
    }
  });

  it('painel sem o campo `quotas` cai no mesmo recado', () => {
    assert.equal(leiaCota(null, AGORA).estado, 'sem-dado');
    assert.equal(leiaCota(undefined, AGORA).estado, 'sem-dado');
  });
});

describe('o que o leitor de tela ouve', () => {
  it('o `meter` tem nome próprio e valor falado — o percentual sozinho mente', () => {
    const leitura = leiaCota(
      quotas({ five_hour: { used_percentage: 37, remaining_seconds: 7_800 } }),
      AGORA,
    );
    if (leitura.estado === 'sem-dado') throw new Error('estado errado');

    // A APG do `meter` exige nome acessível (name from author) e pede
    // `aria-valuetext` quando "37" sozinho não é compreensível — e não é: pode
    // ser lido como 37 restante. O v1 não tem nenhum dos dois.
    assert.equal(leitura.janelas[0].nome, 'Cota usada nas últimas 5 horas');
    assert.equal(leitura.janelas[0].valorFalado, '37% usada, reset em 2h 10m');
    assert.equal(leitura.janelas[1].valorFalado, 'Cota usada nos últimos 7 dias: sem leitura');
  });
});

describe('leitura torta do back não vira NaN na tela', () => {
  it('percentual acima de 100 encosta em 100; sem reset vira "reset pendente"', () => {
    const leitura = leiaCota(
      quotas({ five_hour: { used_percentage: 140, remaining_seconds: null } }),
      AGORA,
    );
    if (leitura.estado === 'sem-dado') throw new Error('estado errado');
    assert.equal(leitura.janelas[0].pct, 100);
    assert.equal(leitura.janelas[0].reset, 'reset pendente');
  });

  it('reset já vencido não vira contagem negativa', () => {
    const leitura = leiaCota(
      quotas({ seven_day: { used_percentage: 12, remaining_seconds: -400 } }),
      AGORA,
    );
    if (leitura.estado === 'sem-dado') throw new Error('estado errado');
    assert.equal(leitura.janelas[1].reset, 'reset pendente');
  });

  it('`stale` sem `updated_at` avisa mesmo sem conseguir dizer a idade', () => {
    const leitura = leiaCota(quotas({ status: 'stale' }), AGORA);
    if (leitura.estado !== 'velha') throw new Error('estado errado');
    assert.equal(leitura.aviso, 'dados antigos');
  });
});
