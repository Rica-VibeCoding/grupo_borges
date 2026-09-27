import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cliqueVale,
  gestoDaConversa,
  gestoDoChat,
  leArrasto,
  LIMIAR,
  origemImpedeArrasto,
  type NoDaOrigem,
} from './gesto-de-arrasto.ts';

const MEIO = { x: 200, y: 450 };
const anda = (dx: number, dy: number) => ({ x: MEIO.x + dx, y: MEIO.y + dy });
const TELA = { largura: 393, faixaDeBaixo: 852 - 34 - 40 };

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
  it('esquerda leva ao chat, cima abre as configurações, toque segue sendo toque', () => {
    assert.equal(gestoDaConversa(MEIO, anda(-150, 10), TELA), 'chat');
    assert.equal(gestoDaConversa(MEIO, anda(5, -200), TELA), 'configuracoes');
    assert.equal(gestoDaConversa(MEIO, anda(3, 3), TELA), 'toque');
  });

  it('arrasto que não é gesto não vira toque', () => {
    assert.equal(gestoDaConversa(MEIO, anda(150, 0), TELA), 'nada');
    assert.equal(gestoDaConversa(MEIO, anda(0, 150), TELA), 'nada');
    assert.equal(gestoDaConversa(MEIO, anda(-40, -30), TELA), 'nada');
  });

  it('para cima só conta começado acima da faixa de baixo, a borda do iPhone', () => {
    const naFaixa = { x: 200, y: TELA.faixaDeBaixo + 5 };
    assert.equal(gestoDaConversa(naFaixa, { x: 200, y: naFaixa.y - 300 }, TELA), 'nada');
    const acima = { x: 200, y: TELA.faixaDeBaixo - 1 };
    assert.equal(gestoDaConversa(acima, { x: 200, y: acima.y - 300 }, TELA), 'configuracoes');
  });

  it('não depende da borda lateral: do meio funciona, da borda não começa', () => {
    assert.equal(gestoDaConversa({ x: 250, y: 400 }, { x: 150, y: 400 }, TELA), 'chat');
    assert.equal(gestoDaConversa({ x: 385, y: 400 }, { x: 200, y: 400 }, TELA), 'nada');
    assert.equal(gestoDaConversa({ x: 10, y: 400 }, { x: 10, y: 200 }, TELA), 'configuracoes');
  });
});

describe('gesto do chat', () => {
  it('direita do meio da tela volta para a conversa; o resto não', () => {
    assert.equal(gestoDoChat({ x: 120, y: 500 }, { x: 260, y: 520 }, 393), 'conversa');
    assert.equal(gestoDoChat({ x: 260, y: 500 }, { x: 120, y: 500 }, 393), 'nada');
    assert.equal(gestoDoChat({ x: 120, y: 500 }, { x: 200, y: 600 }, 393), 'nada');
    assert.equal(gestoDoChat({ x: 8, y: 500 }, { x: 200, y: 500 }, 393), 'nada');
  });

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
