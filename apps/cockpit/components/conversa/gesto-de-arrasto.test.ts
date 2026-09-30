import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cliqueVale,
  gestoDaConversa,
  leArrasto,
  LIMIAR,
  origemImpedeArrasto,
  type NoDaOrigem,
} from './gesto-de-arrasto.ts';

const MEIO = { x: 200, y: 450 };
const anda = (dx: number, dy: number) => ({ x: MEIO.x + dx, y: MEIO.y + dy });
const FAIXA = 852 - 34 - 40;

function no(tagName: string, extra: Partial<NoDaOrigem> & { atributos?: Record<string, string> } = {}): NoDaOrigem {
  const { atributos = {}, ...resto } = extra;
  return {
    tagName,
    scrollWidth: 100,
    clientWidth: 100,
    parentElement: null,
    getAttribute: (nome) => atributos[nome] ?? null,
    ...resto,
  };
}
function arvore(...nos: NoDaOrigem[]): NoDaOrigem {
  for (let i = 0; i < nos.length - 1; i += 1) nos[i].parentElement = nos[i + 1];
  return nos[0];
}
const rolagem = (valores: Map<NoDaOrigem, string>) => (n: NoDaOrigem) => valores.get(n) ?? 'visible';

describe('leitura do arrasto', () => {
  it('o dedo que quase não andou é toque', () => {
    assert.equal(leArrasto(MEIO, MEIO), 'toque');
    assert.equal(leArrasto(MEIO, anda(6, -7)), 'toque');
    assert.equal(leArrasto(MEIO, anda(LIMIAR.toque + 1, 0)), 'indeciso');
  });

  it('só vira gesto passado o limiar, no eixo em que andou', () => {
    assert.equal(leArrasto(MEIO, anda(-(LIMIAR.arrasto - 1), 0)), 'indeciso');
    assert.equal(leArrasto(MEIO, anda(-LIMIAR.arrasto, 0)), 'esquerda');
    assert.equal(leArrasto(MEIO, anda(LIMIAR.arrasto, 0)), 'direita');
    assert.equal(leArrasto(MEIO, anda(0, -LIMIAR.arrasto)), 'cima');
    assert.equal(leArrasto(MEIO, anda(0, LIMIAR.arrasto)), 'baixo');
  });

  it('diagonal não é gesto: o eixo precisa valer o dobro do outro', () => {
    assert.equal(leArrasto(MEIO, anda(-120, 60)), 'esquerda');
    assert.equal(leArrasto(MEIO, anda(-120, 61)), 'indeciso');
    assert.equal(leArrasto(MEIO, anda(80, -100)), 'indeciso');
    assert.equal(leArrasto(MEIO, anda(40, -100)), 'cima');
  });
});

describe('gestos da conversa', () => {
  it('cima abre as configurações, toque segue sendo toque', () => {
    assert.equal(gestoDaConversa(MEIO, anda(5, -200), FAIXA), 'cima');
    assert.equal(gestoDaConversa(MEIO, anda(3, 3), FAIXA), 'toque');
  });

  it('arrasto que não é gesto não vira toque — os de lado são do pager e não passam por aqui', () => {
    assert.equal(gestoDaConversa(MEIO, anda(150, 10), FAIXA), 'nada');
    assert.equal(gestoDaConversa(MEIO, anda(-150, 0), FAIXA), 'nada');
    assert.equal(gestoDaConversa(MEIO, anda(0, 150), FAIXA), 'nada');
    assert.equal(gestoDaConversa(MEIO, anda(-40, -30), FAIXA), 'nada');
  });

  it('para cima só conta começado acima da faixa de baixo, a borda do iPhone', () => {
    const naFaixa = { x: 200, y: FAIXA + 5 };
    assert.equal(gestoDaConversa(naFaixa, { x: 200, y: naFaixa.y - 300 }, FAIXA), 'nada');
    const acima = { x: 200, y: FAIXA - 1 };
    assert.equal(gestoDaConversa(acima, { x: 200, y: acima.y - 300 }, FAIXA), 'cima');
    // A borda lateral não importa para cima.
    assert.equal(gestoDaConversa({ x: 10, y: 400 }, { x: 10, y: 200 }, FAIXA), 'cima');
  });
});

describe('origem do arrasto no chat', () => {
  it('a origem impede em campo, composer, gaveta, folha e no que rola de lado', () => {
    const livre = arvore(no('P'), no('DIV'), no('MAIN'));
    assert.equal(origemImpedeArrasto(livre, rolagem(new Map())), false);
    assert.equal(origemImpedeArrasto(null, rolagem(new Map())), false);

    assert.equal(origemImpedeArrasto(arvore(no('TEXTAREA'), no('FORM')), rolagem(new Map())), true);
    assert.equal(origemImpedeArrasto(arvore(no('svg'), no('BUTTON'), no('FORM'), no('DIV')), rolagem(new Map())), true);
    assert.equal(origemImpedeArrasto(arvore(no('SPAN'), no('ASIDE')), rolagem(new Map())), true);
    assert.equal(origemImpedeArrasto(arvore(no('P', { isContentEditable: true })), rolagem(new Map())), true);
    assert.equal(origemImpedeArrasto(arvore(no('P'), no('DIV', { atributos: { role: 'dialog' } })), rolagem(new Map())), true);

    const pre = no('PRE', { scrollWidth: 900, clientWidth: 340 });
    const codigo = arvore(no('CODE'), pre, no('DIV'));
    assert.equal(origemImpedeArrasto(codigo, rolagem(new Map([[pre, 'auto']]))), true);
    // Rolagem de lado que não transborda (ou que não rola) não é dona do dedo.
    const curto = no('PRE', { scrollWidth: 300, clientWidth: 340 });
    assert.equal(origemImpedeArrasto(arvore(no('CODE'), curto), rolagem(new Map([[curto, 'auto']]))), false);
    const cortado = no('DIV', { scrollWidth: 900, clientWidth: 340 });
    assert.equal(origemImpedeArrasto(arvore(no('P'), cortado), rolagem(new Map([[cortado, 'hidden']]))), false);
  });
});

describe('arrasto não é toque', () => {
  it('o clique depois de um arrasto não conta; o do teclado sempre conta', () => {
    assert.equal(cliqueVale(1, false), true);
    assert.equal(cliqueVale(1, true), false);
    assert.equal(cliqueVale(0, true), true);
  });
});
