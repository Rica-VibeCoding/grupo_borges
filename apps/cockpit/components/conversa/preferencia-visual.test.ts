import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CATALOGO, VISUAL_PADRAO, gravaVisual, leVisual, nomeDoVisual } from './preferencia-visual.ts';

describe('preferência de visual da conversa', () => {
  it('sem nada gravado, abre na Moldura', () => {
    assert.deepEqual(leVisual(null), { opcao: 'moldura', variacao: 'fio' });
    assert.deepEqual(leVisual(''), VISUAL_PADRAO);
  });

  it('lê de volta o que gravou', () => {
    const aurora = { opcao: 'moldura' as const, variacao: 'aurora' };
    assert.deepEqual(leVisual(gravaVisual(aurora)), aurora);
  });

  it('opção ainda não entregue, ou lixo, cai no padrão', () => {
    assert.deepEqual(leVisual('esfera/gema'), VISUAL_PADRAO);
    assert.deepEqual(leVisual('esferaMoldura/qualquer'), VISUAL_PADRAO);
    assert.deepEqual(leVisual('{"x":1}'), VISUAL_PADRAO);
  });

  it('variação desconhecida de opção válida cai na primeira variação dela', () => {
    assert.deepEqual(leVisual('moldura/neon'), { opcao: 'moldura', variacao: 'fio' });
  });

  it('toda opção disponível tem exatamente duas variações com nome', () => {
    for (const item of CATALOGO.filter((i) => i.disponivel)) {
      assert.equal(item.variacoes.length, 2, item.opcao);
      for (const v of item.variacoes) assert.ok(v.nome && v.descricao);
    }
    assert.equal(CATALOGO.length, 3);
  });

  it('dá nome legível ao que está escolhido', () => {
    assert.equal(nomeDoVisual({ opcao: 'moldura', variacao: 'aurora' }), 'Moldura, aurora');
  });
});
