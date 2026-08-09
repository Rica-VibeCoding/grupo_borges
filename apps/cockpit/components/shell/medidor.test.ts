import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CELULAS,
  CELULA_DO_TETO,
  ESCALA_PCT,
  TETO_PCT,
  celulasDoMedidor,
} from './medidor.ts';

/** Quantas acendem — o que se conta batendo o olho na coluna. */
const acesas = (pct: number) => celulasDoMedidor(pct).filter((c) => c.acesa).length;
/** Quantas acendem em âmbar — as que dizem "passou do teto". */
const ambar = (pct: number) =>
  celulasDoMedidor(pct).filter((c) => c.acesa && c.alemDoTeto).length;

describe('a régua se amarra sozinha', () => {
  it('a célula do teto é derivada, não escrita à mão', () => {
    // Se o Rica mudar o teto da frota, o desenho reajusta sem ninguém abrir
    // este arquivo. É a única razão de `CELULA_DO_TETO` não ser um literal.
    assert.equal(CELULA_DO_TETO, TETO_PCT / (ESCALA_PCT / CELULAS));
    assert.equal(CELULA_DO_TETO, 6);
  });
});

describe('dentro do teto — o caso de todo dia', () => {
  it('1% já acende uma célula: quem tem alguma coisa mostra alguma coisa', () => {
    // `ceil`, não `round`. Célula apagada diria "zero", e zero é mentira.
    assert.equal(acesas(1), 1);
    assert.equal(ambar(1), 0);
  });

  it('a diferença entre dois agentes aparece na forma', () => {
    // O ponto inteiro de encurtar a escala pra 50: na régua até 100 estes dois
    // acendiam o mesmo toquinho e as linhas ficavam idênticas.
    assert.equal(acesas(7), 2);
    assert.equal(acesas(25), 5);
  });

  it('encostar no teto ainda é neutro — 30% não passou de 30%', () => {
    assert.equal(acesas(TETO_PCT), 6);
    assert.equal(ambar(TETO_PCT), 0);
  });
});

describe('acima do teto — onde a cor entra', () => {
  it('a Tara em 38,6%: seis neutras e duas âmbar', () => {
    // O caso que estava na tela no dia em que a peça foi desenhada.
    assert.equal(acesas(38.6), 8);
    assert.equal(ambar(38.6), 2);
  });

  it('passar do teto por pouco já acende âmbar', () => {
    assert.equal(ambar(30.1), 1);
  });
});

describe('acima da escala — o buraco que o Daniel apontou', () => {
  it('55% e 95% NÃO desenham igual', () => {
    // Sem a saturação os dois davam dez células âmbar, e a diferença entre
    // "passou do teto" e "vai compactar a qualquer momento" sumia do desenho
    // justamente no caso mais grave.
    const cinquentaCinco = celulasDoMedidor(55);
    const noventaCinco = celulasDoMedidor(95);
    assert.equal(acesas(55), CELULAS);
    assert.equal(acesas(95), CELULAS);
    assert.equal(cinquentaCinco.at(-1)?.saturada, true);
    assert.equal(noventaCinco.at(-1)?.saturada, true);
  });

  it('só a ÚLTIMA célula satura — as outras nove seguem normais', () => {
    const celulas = celulasDoMedidor(95);
    assert.equal(celulas.filter((c) => c.saturada).length, 1);
    assert.equal(celulas.at(-1)?.saturada, true);
  });

  it('exatamente no fim da escala ainda não saturou', () => {
    // 50% cabe na régua: a última célula é a décima, e ela representa 50.
    assert.equal(acesas(ESCALA_PCT), CELULAS);
    assert.equal(celulasDoMedidor(ESCALA_PCT).at(-1)?.saturada, false);
  });
});

describe('bordas que não podem derrubar a coluna', () => {
  it('zero não acende nada', () => {
    assert.equal(acesas(0), 0);
    assert.equal(celulasDoMedidor(0).some((c) => c.saturada), false);
  });

  it('sempre devolve as dez células, aconteça o que acontecer', () => {
    // A moldura do medidor é fixa: o trilho apagado é parte do desenho, e uma
    // lista onde umas linhas têm dez caixinhas e outras têm três lê como
    // quebrado, não como informação.
    for (const pct of [0, 1, 30, 38.6, 50, 95, 100, 1000]) {
      assert.equal(celulasDoMedidor(pct).length, CELULAS);
    }
  });
});
