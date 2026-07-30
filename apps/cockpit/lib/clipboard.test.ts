import assert from 'node:assert/strict';
import test from 'node:test';

import { copyText } from './clipboard.ts';

test('usa o clipboard moderno sem chamar o fallback', async () => {
  const calls: string[] = [];

  const result = await copyText('const ok = true;', {
    writeText(text) {
      calls.push(`modern:${text}`);
      return Promise.resolve();
    },
    fallbackCopy(text) {
      calls.push(`fallback:${text}`);
      return true;
    },
  });

  assert.equal(result, 'modern');
  assert.deepEqual(calls, ['modern:const ok = true;']);
});

test('invoca writeText antes de devolver controle ao chamador', async () => {
  let invoked = false;

  const pending = copyText('agora', {
    writeText() {
      invoked = true;
      return Promise.resolve();
    },
    fallbackCopy() {
      return false;
    },
  });

  assert.equal(invoked, true);
  assert.equal(await pending, 'modern');
});

test('cai no fallback quando o clipboard moderno rejeita', async () => {
  const calls: string[] = [];

  const result = await copyText('fallback', {
    writeText(text) {
      calls.push(`modern:${text}`);
      return Promise.reject(new Error('clipboard indisponível'));
    },
    fallbackCopy(text) {
      calls.push(`fallback:${text}`);
      return true;
    },
  });

  assert.equal(result, 'fallback');
  assert.deepEqual(calls, ['modern:fallback', 'fallback:fallback']);
});

test('usa o fallback quando a API moderna não existe', async () => {
  const result = await copyText('legado', {
    fallbackCopy: () => true,
  });

  assert.equal(result, 'fallback');
});

test('relata falha quando os dois caminhos falham', async () => {
  const result = await copyText('não copiado', {
    writeText: () => Promise.reject(new Error('moderno falhou')),
    fallbackCopy: () => false,
  });

  assert.equal(result, 'failed');
});

test('relata falha quando o fallback lança', async () => {
  const result = await copyText('não copiado', {
    fallbackCopy() {
      throw new Error('execCommand falhou');
    },
  });

  assert.equal(result, 'failed');
});
