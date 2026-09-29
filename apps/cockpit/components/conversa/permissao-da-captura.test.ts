import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criaPermissaoDaCaptura } from './permissao-da-captura.ts';
import { transcreveFala } from './transcricao-da-fala.ts';

test('mudo invalida transcrição em voo mesmo se desmutar antes de ela resolver', async () => {
  const p = criaPermissaoDaCaptura();
  p.muda(false);
  let resolve!: (texto: string) => void;
  const arquivo = new Promise<string>((r) => { resolve = r; });
  const enviados: string[] = [];
  const tarefa = transcreveFala({ aoVivo: null, paciencia: 0, arquivo: () => arquivo,
    vivo: p.vigente(), transcreveu: (texto) => enviados.push(texto), falhou: () => assert.fail() });
  p.muda(true);
  p.muda(false);
  resolve('Fala anterior ao mudo.');
  await tarefa;
  assert.deepEqual(enviados, []);
  assert.equal(p.vigente()(), true);
});

test('mudo desde a hidratação impede pedir transcrição', async () => {
  const p = criaPermissaoDaCaptura();
  p.muda(true);
  await transcreveFala({ aoVivo: null, paciencia: 0,
    arquivo: () => { assert.fail('não pode enviar áudio'); },
    vivo: p.vigente(), transcreveu: () => assert.fail(), falhou: () => assert.fail() });
});
