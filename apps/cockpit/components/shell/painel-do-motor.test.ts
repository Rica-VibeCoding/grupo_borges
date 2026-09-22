import assert from 'node:assert/strict';
import { it } from 'node:test';
import { rotulaModelo } from './motor.ts';

it('rótulo oficial vence a tabela local', () => {
  assert.equal(rotulaModelo('gpt-5.6-sol', { 'gpt-5.6-sol': 'GPT 5.6 Sol' }), 'GPT 5.6 Sol');
});

it('DeepSeek chega com a janela colada no id e sai legível', () => {
  assert.equal(rotulaModelo('deepseek-v4-flash[1m]'), 'DeepSeek V4-Flash');
});
