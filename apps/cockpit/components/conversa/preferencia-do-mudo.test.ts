import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHAVE_MUDO, criaPreferenciaDoMudo } from './preferencia-do-mudo.ts';

function armazenamento() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => { dados.set(chave, valor); },
  };
}

test('começa ligado sem preferência e conserva mudo após recriar o estado', () => {
  const local = armazenamento();
  const estado = criaPreferenciaDoMudo(() => local);
  assert.equal(estado.le(), false);
  estado.muda(true);
  assert.equal(local.getItem(CHAVE_MUDO), 'true');
  const recarregado = criaPreferenciaDoMudo(() => local);
  assert.equal(recarregado.le(), true);
  recarregado.muda(false);
  assert.equal(criaPreferenciaDoMudo(() => local).le(), false);
});

test('notifica a própria aba depois de escrever e remove assinatura', () => {
  const leituras: boolean[] = [];
  const local = armazenamento();
  const persistido = criaPreferenciaDoMudo(() => local);
  const sai = persistido.inscreve(() => leituras.push(persistido.le()));
  persistido.muda(true);
  sai();
  persistido.muda(false);
  assert.deepEqual(leituras, [true]);
});

test('mudança de outra aba pode notificar o valor atualizado', () => {
  const local = armazenamento();
  const estado = criaPreferenciaDoMudo(() => local);
  const leituras: boolean[] = [];
  estado.inscreve(() => leituras.push(estado.le()));
  local.setItem(CHAVE_MUDO, 'true');
  estado.avisa();
  assert.deepEqual(leituras, [true]);
});

test('armazenamento recusado mantém escolha em memória e começa seguro', () => {
  const estado = criaPreferenciaDoMudo(() => { throw new Error('Armazenamento bloqueado'); });
  assert.equal(estado.le(), true);
  estado.muda(false);
  assert.equal(estado.le(), false);
  estado.muda(true);
  assert.equal(estado.le(), true);
});

test('falha só na escrita não devolve o valor antigo nem perde o aviso', () => {
  const estado = criaPreferenciaDoMudo(() => ({
    getItem: () => 'false',
    setItem: () => { throw new Error('Sem espaço'); },
  }));
  let avisos = 0;
  estado.inscreve(() => avisos++);
  estado.muda(true);
  assert.equal(estado.le(), true);
  assert.equal(avisos, 1);
});
