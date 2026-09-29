import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aceitaAtalhoDoMudo } from './atalho-do-mudo.ts';

type Tecla = Parameters<typeof aceitaAtalhoDoMudo>[0];
function tecla(mudancas: Partial<Tecla> = {}): Tecla {
  return {
    key: 'm', repeat: false, isComposing: false, altKey: false, ctrlKey: false,
    metaKey: false, shiftKey: false, defaultPrevented: false, composedPath: () => [],
    ...mudancas,
  };
}

test('M alterna somente no computador com tela ativa', () => {
  assert.equal(aceitaAtalhoDoMudo(tecla(), true, true), true);
  assert.equal(aceitaAtalhoDoMudo(tecla({ key: 'M' }), true, true), true);
  assert.equal(aceitaAtalhoDoMudo(tecla(), false, true), false);
  assert.equal(aceitaAtalhoDoMudo(tecla(), true, false), false);
  assert.equal(aceitaAtalhoDoMudo(tecla({ key: 'a' }), true, true), false);
});

for (const propriedade of ['repeat', 'isComposing', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'defaultPrevented'] as const) {
  test(`não captura tecla com ${propriedade}`, () => {
    assert.equal(aceitaAtalhoDoMudo(tecla({ [propriedade]: true }), true, true), false);
  });
}

for (const campo of ['input', 'textarea', 'select', '[role="textbox"]', '[role="combobox"]']) {
  test(`não captura digitação em ${campo}`, () => {
    const alvo = { closest: (seletor: string) => seletor.split(', ').includes(campo) ? {} : null };
    const evento = tecla({ composedPath: () => [alvo as unknown as EventTarget] });
    assert.equal(aceitaAtalhoDoMudo(evento, true, true), false);
  });
}

test('não captura edição rica, inclusive dentro de árvore encapsulada', () => {
  const editavel = { isContentEditable: true } as unknown as EventTarget;
  assert.equal(aceitaAtalhoDoMudo(tecla({ composedPath: () => [editavel, new EventTarget()] }), true, true), false);
});

test('aceita tecla com botão focado', () => {
  const botao = { isContentEditable: false, closest: () => null } as unknown as EventTarget;
  assert.equal(aceitaAtalhoDoMudo(tecla({ composedPath: () => [botao] }), true, true), true);
});
