import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  emCaptura,
  modoDaFala,
  type EntradaDaFala,
  type ModoDaFala,
} from './modo-da-fala.ts';

/** Repouso puro. Cada teste muda só o que interessa a ele. */
const PARADO: EntradaDaFala = { faseVoz: 'ociosa', falaFalhou: false };

const em = (mudanca: Partial<EntradaDaFala>): ModoDaFala =>
  modoDaFala({ ...PARADO, ...mudanca });

describe('os modos de hoje, um a um', () => {
  // A tabela é o eixo de voz da seção 3 de `docs/cockpit-v2-composer-mapa.md`: cada modo que o
  // JSX remonta hoje a partir de predicados soltos tem de sair desta função com
  // o mesmo nome. Se um modo daquela lista não aparecer aqui, a peça está
  // incompleta — não é o teste que está faltando.

  it('nada acontecendo é repouso', () => {
    assert.equal(em({}), 'repouso');
  });

  it('gravando e cancelando são o mesmo modo — a caixa está ouvindo', () => {
    assert.equal(em({ faseVoz: 'gravando' }), 'ouvindo');
    assert.equal(em({ faseVoz: 'cancelando' }), 'ouvindo');
  });

  it('travada é modo PRÓPRIO, não uma variação de ouvindo', () => {
    // `capturando()` junta as três (`voz.ts:447`), mas a travada mostra botões
    // que o gesto em curso não mostra: quem encerra ali é dedo em botão.
    assert.equal(em({ faseVoz: 'travada' }), 'travada');
  });

  it('pedir o microfone e esperar a transcrição são o mesmo compasso', () => {
    assert.equal(em({ faseVoz: 'pedindo' }), 'transcrevendo');
    assert.equal(em({ faseVoz: 'transcrevendo' }), 'transcrevendo');
  });

  it('microfone barrado e transcrição que não veio caem no mesmo modo', () => {
    assert.equal(em({ faseVoz: 'impedida' }), 'impedido');
    assert.equal(em({ falaFalhou: true }), 'impedido');
  });
});

describe('precedência dentro do eixo da fala', () => {
  it('impedido vence qualquer outra fase de voz', () => {
    // É o único modo que pede decisão dele. Os outros passam sozinhos.
    assert.equal(em({ faseVoz: 'impedida' }), 'impedido');
    assert.equal(em({ faseVoz: 'gravando', falaFalhou: true }), 'impedido');
  });

  it('travada vence ouvindo — o gesto acabou, a gravação não', () => {
    assert.equal(em({ faseVoz: 'travada' }), 'travada');
  });
});

describe('o que se deriva do modo', () => {
  it('captura é o microfone aberto: com o dedo ou travado', () => {
    assert.equal(emCaptura('ouvindo'), true);
    assert.equal(emCaptura('travada'), true);
  });

  it('transcrevendo NÃO é captura — o campo continua editável', () => {
    // `readOnly` sai daqui (`composer.tsx:832`). Trancar enquanto a transcrição
    // volta tiraria a janela em que ele corrige o rascunho pelo teclado.
    assert.equal(emCaptura('transcrevendo'), false);
  });

  it('microfone parado ou barrado não conta como captura', () => {
    assert.equal(emCaptura('repouso'), false);
    assert.equal(emCaptura('impedido'), false);
  });
});
