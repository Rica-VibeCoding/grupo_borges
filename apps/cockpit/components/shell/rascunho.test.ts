import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createControleRascunho,
  type ArmazenamentoRascunho,
} from './rascunho.ts';

function armazenamentoFalso(): ArmazenamentoRascunho & { mapa: Map<string, string> } {
  const mapa = new Map<string, string>();
  return {
    mapa,
    getItem: (chave) => mapa.get(chave) ?? null,
    setItem: (chave, valor) => {
      mapa.set(chave, valor);
    },
    removeItem: (chave) => {
      mapa.delete(chave);
    },
  };
}

test('rascunho reaparece ao remontar o mesmo agente', () => {
  const storage = armazenamentoFalso();
  const primeiro = createControleRascunho('hiro', storage);
  primeiro.escrever('não perde esta análise');

  const remontado = createControleRascunho('hiro', storage);

  assert.equal(remontado.getSnapshot(), 'não perde esta análise');
  assert.equal(remontado.getServerSnapshot(), '');
});

test('cada agente conserva o próprio rascunho', () => {
  const storage = armazenamentoFalso();
  createControleRascunho('hiro', storage).escrever('rascunho do Hiro');
  createControleRascunho('pavan', storage).escrever('rascunho do Pavan');

  assert.equal(createControleRascunho('hiro', storage).getSnapshot(), 'rascunho do Hiro');
  assert.equal(createControleRascunho('pavan', storage).getSnapshot(), 'rascunho do Pavan');
});

test('campo limpo remove o rascunho persistido', () => {
  const storage = armazenamentoFalso();
  const controle = createControleRascunho('hiro', storage);
  controle.escrever('já vai sair');
  controle.escrever('');

  assert.equal(createControleRascunho('hiro', storage).getSnapshot(), '');
  assert.equal(storage.mapa.size, 0);
});

test('falha do armazenamento não impede continuar escrevendo', () => {
  const storage: ArmazenamentoRascunho = {
    getItem: () => {
      throw new Error('indisponível');
    },
    setItem: () => {
      throw new Error('indisponível');
    },
    removeItem: () => {
      throw new Error('indisponível');
    },
  };
  const controle = createControleRascunho('hiro', storage);

  controle.escrever('continua no campo');

  assert.equal(controle.getSnapshot(), 'continua no campo');
});
