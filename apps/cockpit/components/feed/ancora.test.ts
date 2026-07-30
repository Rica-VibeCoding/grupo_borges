import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COLADO_PX,
  capturaAncora,
  distanciaDoFim,
  estaColado,
  scrollTopParaAncora,
  type Faixa,
} from './ancora.ts';

describe('âncora — estar colado no fim', () => {
  it('no fim exato está colado', () => {
    assert.equal(estaColado({ scrollTop: 900, scrollHeight: 1500, clientHeight: 600 }), true);
  });

  it('dentro da tolerância ainda está colado — o dedo raramente para no pixel', () => {
    assert.equal(
      estaColado({ scrollTop: 900 - COLADO_PX, scrollHeight: 1500, clientHeight: 600 }),
      true,
    );
  });

  it('um pixel além da tolerância NÃO está colado', () => {
    assert.equal(
      estaColado({ scrollTop: 900 - COLADO_PX - 1, scrollHeight: 1500, clientHeight: 600 }),
      false,
    );
  });

  it('conteúdo menor que a janela não produz distância negativa', () => {
    assert.equal(distanciaDoFim({ scrollTop: 0, scrollHeight: 200, clientHeight: 600 }), 0);
  });
});

describe('âncora — capturar o item sob o olho', () => {
  const visiveis: Faixa[] = [
    { chave: 'a', start: 0, end: 100 },
    { chave: 'b', start: 100, end: 260 },
    { chave: 'c', start: 260, end: 300 },
  ];

  it('pega o item que cruza o topo do viewport, com o deslocamento negativo', () => {
    const ancora = capturaAncora(visiveis, 150);
    assert.deepEqual(ancora, { chave: 'b', deslocamento: -50 });
  });

  it('item que termina exatamente na dobra já passou — não é o que se lê', () => {
    const ancora = capturaAncora(visiveis, 100);
    assert.equal(ancora?.chave, 'b');
  });

  it('sem itens visíveis não há âncora', () => {
    assert.equal(capturaAncora([], 0), null);
  });
});

describe('âncora — G3: o corte é zero', () => {
  it('20.273 px crescendo ACIMA do item lido não movem o item na tela', () => {
    // O Rica rolou para cima e está lendo `lida`, 50 px acima da dobra.
    const antes: Faixa[] = [
      { chave: 'velha', start: 0, end: 1_000 },
      { chave: 'lida', start: 1_000, end: 1_400 },
    ];
    const scrollTop = 1_050;
    const ancora = capturaAncora(antes, scrollTop);
    assert.deepEqual(ancora, { chave: 'lida', deslocamento: -50 });

    // Tudo o que estava acima é medido e cresce — o número exato que o gate
    // mediu de deslocamento no iPhone.
    const CRESCIMENTO = 20_273;
    const depois: Faixa[] = [
      { chave: 'velha', start: 0, end: 1_000 + CRESCIMENTO },
      { chave: 'lida', start: 1_000 + CRESCIMENTO, end: 1_400 + CRESCIMENTO },
    ];

    const alvo = scrollTopParaAncora(ancora!, depois, scrollTop);
    assert.equal(alvo, scrollTop + CRESCIMENTO);

    // O que importa não é o scrollTop: é o item continuar no mesmo pixel da
    // tela. Deslocamento medido depois da correção: zero.
    const posicaoNaTelaAntes = 1_000 - scrollTop;
    const posicaoNaTelaDepois = (1_000 + CRESCIMENTO) - alvo!;
    assert.equal(posicaoNaTelaDepois - posicaoNaTelaAntes, 0);
  });

  it('não escreve scrollTop quando nada mudou — escrita à toa é tranco', () => {
    const visiveis: Faixa[] = [{ chave: 'a', start: 300, end: 500 }];
    assert.equal(scrollTopParaAncora({ chave: 'a', deslocamento: -20 }, visiveis, 320), null);
  });

  it('âncora que sumiu da lista deixa a tela parada em vez de saltar', () => {
    const visiveis: Faixa[] = [{ chave: 'outra', start: 0, end: 100 }];
    assert.equal(scrollTopParaAncora({ chave: 'sumiu', deslocamento: -10 }, visiveis, 50), null);
  });

  it('nunca devolve scrollTop negativo', () => {
    const visiveis: Faixa[] = [{ chave: 'a', start: 0, end: 100 }];
    assert.equal(scrollTopParaAncora({ chave: 'a', deslocamento: 40 }, visiveis, 10), 0);
  });
});
