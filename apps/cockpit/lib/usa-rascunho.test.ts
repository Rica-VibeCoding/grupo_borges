import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codificaRascunho, decodificaRascunho } from './usa-rascunho.ts';

describe('rascunho persistido', () => {
  it('preserva texto e origem de voz no recarregamento', () => {
    const salvo = codificaRascunho({ texto: 'fala revisada', origem: 'stt' });
    assert.deepEqual(decodificaRascunho(salvo), {
      texto: 'fala revisada',
      origem: 'stt',
    });
  });

  it('migra o formato antigo de texto puro como origem digitada', () => {
    assert.deepEqual(decodificaRascunho('rascunho antigo'), {
      texto: 'rascunho antigo',
      origem: 'text',
    });
  });

  it('não confunde JSON digitado pelo usuário com o envelope interno', () => {
    const texto = '{"texto":"não sou metadado"}';
    assert.deepEqual(decodificaRascunho(texto), { texto, origem: 'text' });
  });
});
