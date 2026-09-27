import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CATALOGO, VISUAL_PADRAO, gravaVisual, leVisual, nomeDoVisual, pecasDoVisual } from './preferencia-visual.ts';

describe('preferência de visual da conversa', () => {
  it('sem nada gravado, abre na Moldura', () => {
    assert.deepEqual(leVisual(null), { opcao: 'moldura', variacao: 'fio' });
    assert.deepEqual(leVisual(''), VISUAL_PADRAO);
  });

  it('lê de volta o que gravou, em cada opção', () => {
    for (const item of CATALOGO) {
      for (const v of item.variacoes) {
        const visual = { opcao: item.opcao, variacao: v.id };
        assert.deepEqual(leVisual(gravaVisual(visual)), visual);
      }
    }
  });

  it('opção desconhecida, ou lixo, cai no padrão', () => {
    assert.deepEqual(leVisual('mostrador/relogio'), VISUAL_PADRAO);
    assert.deepEqual(leVisual('{"x":1}'), VISUAL_PADRAO);
  });

  it('variação desconhecida de opção válida cai na primeira variação dela', () => {
    assert.deepEqual(leVisual('moldura/neon'), { opcao: 'moldura', variacao: 'fio' });
    assert.deepEqual(leVisual('esfera/gema'), { opcao: 'esfera', variacao: 'materia' });
    assert.deepEqual(leVisual('esferaMoldura'), { opcao: 'esferaMoldura', variacao: 'juntas' });
  });

  it('as três opções têm exatamente duas variações com nome', () => {
    assert.deepEqual(CATALOGO.map((i) => i.opcao), ['moldura', 'esfera', 'esferaMoldura']);
    for (const item of CATALOGO) {
      assert.equal(item.variacoes.length, 2, item.opcao);
      for (const v of item.variacoes) assert.ok(v.nome && v.descricao);
    }
  });

  it('dá nome legível ao que está escolhido', () => {
    assert.equal(nomeDoVisual({ opcao: 'moldura', variacao: 'aurora' }), 'Moldura, aurora');
    assert.equal(nomeDoVisual({ opcao: 'esferaMoldura', variacao: 'divididas' }), 'Esfera e moldura, divididas');
  });
});

describe('peças de cada visual', () => {
  it('Moldura e Esfera sozinhas desenham só a sua peça, na cena real', () => {
    assert.deepEqual(pecasDoVisual({ opcao: 'moldura', variacao: 'aurora' }, 'ouvindo'), {
      moldura: { cena: 'ouvindo', variacao: 'aurora' },
      esfera: null,
    });
    assert.deepEqual(pecasDoVisual({ opcao: 'esfera', variacao: 'vidro' }, 'falando'), {
      moldura: null,
      esfera: { cena: 'falando', variacao: 'vidro' },
    });
  });

  it('Juntas: as duas peças mostram o mesmo momento', () => {
    const pecas = pecasDoVisual({ opcao: 'esferaMoldura', variacao: 'juntas' }, 'esperandoZe');
    assert.equal(pecas.moldura?.cena, 'esperandoZe');
    assert.equal(pecas.esfera?.cena, 'esperandoZe');
  });

  it('Divididas: a borda é a sua vez, a esfera é a dele', () => {
    const divididas = { opcao: 'esferaMoldura' as const, variacao: 'divididas' };
    const em = (cena: Parameters<typeof pecasDoVisual>[1]) => {
      const p = pecasDoVisual(divididas, cena);
      return [p.moldura?.cena, p.esfera?.cena];
    };
    assert.deepEqual(em('ouvindo'), ['ouvindo', 'parado']);
    assert.deepEqual(em('preparando'), ['preparando', 'parado']);
    assert.deepEqual(em('esperandoZe'), ['parado', 'esperandoZe']);
    assert.deepEqual(em('falando'), ['parado', 'falando']);
    // Interromper: você sobe pela borda, ele congela na esfera.
    assert.deepEqual(em('interrompendo'), ['ouvindo', 'interrompendo']);
    assert.deepEqual(em('erro'), ['erro', 'erro']);
  });
});
