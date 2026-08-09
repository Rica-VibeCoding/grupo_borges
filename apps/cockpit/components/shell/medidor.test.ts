import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FATIA_ATE_O_TETO,
  PISO_VISIVEL,
  TETO_PCT,
  fracaoDoMedidor,
  passouDoTeto,
} from './medidor.ts';

/** Quanto da barra o valor pinta, em % — como se lê batendo o olho na linha. */
const largura = (pct: number) => fracaoDoMedidor(pct) * 100;

describe('o teto manda na régua', () => {
  it('o teto cai exatamente na fronteira dos dois trechos', () => {
    // Se o Rica mudar o teto da frota, a barra reajusta sozinha: a faixa de
    // operação continua valendo 70% do desenho, seja ela até 30% ou até 20%.
    assert.equal(fracaoDoMedidor(TETO_PCT), FATIA_ATE_O_TETO);
  });

  it('encostar no teto ainda não é passar dele', () => {
    assert.equal(passouDoTeto(TETO_PCT), false);
    assert.equal(passouDoTeto(TETO_PCT + 0.1), true);
  });
});

describe('a faixa onde a frota vive — o caso de todo dia', () => {
  it('dois agentes comuns desenham barras claramente diferentes', () => {
    // O ponto inteiro de não usar 0–100 linear: nessa escala 7% e 25% pintavam
    // 7px e 25px de 100 e as linhas ficavam quase idênticas. Aqui a diferença
    // passa de 40% da barra.
    assert.ok(largura(25) - largura(7) > 40);
  });

  it('a faixa de operação toma a maior parte do desenho', () => {
    // Metade do teto pinta metade da fatia: dentro do trecho a régua é linear,
    // então o olho pode comparar dois agentes por proporção.
    assert.equal(fracaoDoMedidor(TETO_PCT / 2), FATIA_ATE_O_TETO / 2);
  });

  it('1% já pinta alguma coisa', () => {
    // Sem o piso daria 0,7% da barra — meio pixel, que na tela é zero. E zero
    // seria mentira: o agente tem contexto.
    assert.equal(fracaoDoMedidor(1), PISO_VISIVEL);
    assert.ok(fracaoDoMedidor(1) > 0);
  });
});

describe('acima do teto — o buraco que o Daniel apontou', () => {
  it('55% e 95% NÃO desenham igual', () => {
    // Numa régua que parasse em 50 os dois encostavam no fim e empatavam, e a
    // diferença entre "passou do teto" e "vai compactar a qualquer momento"
    // sumia justamente no caso mais grave.
    assert.notEqual(fracaoDoMedidor(55), fracaoDoMedidor(95));
    // E não empatam por pouco: mais de 10% da barra separa os dois.
    assert.ok(largura(95) - largura(55) > 10);
  });

  it('nenhum par de valores distintos empata, do piso até o fim', () => {
    // A garantia de verdade é a monotonicidade estrita, não dois casos
    // escolhidos a dedo: se a função nunca repete valor, nenhum par de agentes
    // pode desenhar igual desenhando números diferentes.
    //
    // Começa em 2% porque abaixo disso o PISO_VISIVEL achata de propósito —
    // 0,1% e 1,5% pintam o mesmo fio mínimo, e é o comportamento desejado: ali
    // a pergunta que a barra responde é "tem alguma coisa?", não "quanto".
    let anterior = -1;
    for (let pct = 2; pct <= 100; pct += 0.5) {
      const atual = fracaoDoMedidor(pct);
      assert.ok(atual > anterior, `${pct}% não avançou em relação ao passo anterior`);
      anterior = atual;
    }
  });

  it('100% enche a barra, e nada passa disso', () => {
    assert.equal(fracaoDoMedidor(100), 1);
    assert.equal(fracaoDoMedidor(1000), 1);
  });
});

describe('bordas que não podem derrubar a coluna', () => {
  it('zero não pinta nada', () => {
    assert.equal(fracaoDoMedidor(0), 0);
  });

  it('valor torto vindo do pane não inverte nem estoura a barra', () => {
    // A barra é largura em CSS: fração negativa ou NaN viraria layout quebrado
    // numa lista inteira por causa de uma leitura ruim de um agente só.
    for (const torto of [-1, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const f = fracaoDoMedidor(torto);
      assert.ok(f >= 0 && f <= 1, `${torto} devolveu ${f}`);
    }
  });
});
