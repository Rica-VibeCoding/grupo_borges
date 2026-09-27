import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formataDataHora, instanteDoBloco } from './data-hora.ts';

describe('formataDataHora', () => {
  it('dia/mês e hora 24h no fuso de São Paulo', () => {
    assert.equal(formataDataHora(Date.parse('2026-09-02T12:31:00Z')), '02/09 09:31');
    assert.equal(formataDataHora(Date.parse('2026-09-02T20:05:00Z')), '02/09 17:05');
  });

  it('02:30Z ainda é o dia anterior em São Paulo', () => {
    assert.equal(formataDataHora(Date.parse('2026-09-03T02:30:00Z')), '02/09 23:30');
  });

  it('meia-noite é 00, nunca 24', () => {
    assert.equal(formataDataHora(Date.parse('2026-09-03T03:00:00Z')), '03/09 00:00');
  });

  it('instante inválido não renderiza nada', () => {
    assert.equal(formataDataHora(NaN), null);
    assert.equal(formataDataHora(Infinity), null);
    assert.equal(formataDataHora(Date.parse('lixo')), null);
  });
});

describe('instanteDoBloco', () => {
  it('usa o timestamp ISO quando ele existe', () => {
    assert.equal(
      instanteDoBloco({ timestamp: '2026-09-02T12:31:00Z', created_at: 1 }),
      Date.parse('2026-09-02T12:31:00Z'),
    );
  });

  it('cai para created_at (segundos) quando o ISO é inválido', () => {
    assert.equal(instanteDoBloco({ timestamp: '', created_at: 1_788_352_260 }), 1_788_352_260_000);
  });

  it('sem nenhum dos dois, null', () => {
    assert.equal(instanteDoBloco({ timestamp: 'x', created_at: 0 }), null);
    assert.equal(instanteDoBloco({ timestamp: 'x', created_at: NaN }), null);
  });
});
