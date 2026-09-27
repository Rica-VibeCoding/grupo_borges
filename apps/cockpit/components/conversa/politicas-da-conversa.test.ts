import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { executaGestoDeInicio, reduzAviso } from './politicas-da-conversa.ts';

describe('políticas locais da conversa', () => {
  it('cancela a fala de erro antes de religar o detector', () => {
    const ordem: string[] = [];

    executaGestoDeInicio({
      cancelaFalaLocal: () => ordem.push('cancelou fala'),
      destravaReprodutor: () => ordem.push('destravou reprodutor'),
      destravaSons: () => ordem.push('destravou sons'),
      pedeWakeLock: () => ordem.push('pediu wake lock'),
      comeca: () => ordem.push('começou'),
    });

    assert.deepEqual(ordem, [
      'cancelou fala',
      'destravou reprodutor',
      'destravou sons',
      'pediu wake lock',
      'começou',
    ]);
  });

  it('mantém o aviso de voz perdida quando o detector religa', () => {
    const falha = reduzAviso(null, {
      tipo: 'vozFalhou',
      mensagem: 'A resposta não pôde ser reproduzida.',
    });
    const detectorLigado = reduzAviso(falha, { tipo: 'detectorLigou' });

    assert.equal(detectorLigado, 'A resposta não pôde ser reproduzida.');
    assert.equal(reduzAviso(detectorLigado, { tipo: 'novoGesto' }), null);
  });
});
