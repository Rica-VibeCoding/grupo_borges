import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SEM_SINAL_S, alturasDoPulso, haQuanto, leiaPulso } from './pulso-do-agente.ts';

const AGORA = 1_790_000_000;

describe('leiaPulso', () => {
  it('evento recente é trabalho, com ou sem turno', () => {
    assert.equal(leiaPulso({ agora: AGORA, ultimoEvento: AGORA - 10, turnoVivo: false }).tom, 'ativo');
  });

  it('silêncio sem turno é descanso, nunca alarme', () => {
    const l = leiaPulso({ agora: AGORA, ultimoEvento: AGORA - 3 * 3600, turnoVivo: false });
    assert.deepEqual(l, { tom: 'parado', frase: 'Parado', ha: 'há 3 h' });
  });

  it('turno aberto e calado ainda não é travamento antes do teto', () => {
    const l = leiaPulso({ agora: AGORA, ultimoEvento: AGORA - SEM_SINAL_S + 1, turnoVivo: true });
    assert.equal(l.tom, 'ativo');
  });

  it('turno aberto e calado passado o teto vira sem sinal', () => {
    const l = leiaPulso({ agora: AGORA, ultimoEvento: AGORA - 14 * 60, turnoVivo: true });
    assert.deepEqual(l, { tom: 'sem-sinal', frase: 'Sem sinal', ha: 'há 14 min' });
  });

  it('agente sem evento nenhum não inventa tempo', () => {
    assert.equal(leiaPulso({ agora: AGORA, ultimoEvento: null, turnoVivo: true }).ha, '');
  });
});

describe('haQuanto', () => {
  it('escolhe a unidade que se lê de relance', () => {
    assert.equal(haQuanto(45), 'há 45 s');
    assert.equal(haQuanto(125), 'há 2 min');
    assert.equal(haQuanto(86_400), 'há 1 dia');
    assert.equal(haQuanto(3 * 86_400), 'há 3 dias');
  });
});

describe('alturasDoPulso', () => {
  it('janela vazia é chão reto', () => {
    assert.deepEqual(alturasDoPulso([0, 0, 0]), [0, 0, 0]);
  });

  it('o menor minuto com vida ainda aparece', () => {
    const [pico, pouco, nada] = alturasDoPulso([100, 1, 0]);
    assert.equal(pico, 1);
    assert.ok(pouco >= 0.12);
    assert.equal(nada, 0);
  });
});
