import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { EstadoEnvio } from '../../lib/envio.ts';
import {
  deveEnviarPorEnter,
  deveIniciarCompact,
  envioVeioDaFila,
  textoDepoisDaEntregaDoAnexo,
} from './regras-do-composer.ts';

describe('regras do composer', () => {
  it('não inicia espera de compact para executor Codex', () => {
    assert.equal(deveIniciarCompact('/compact', true), false);
    assert.equal(deveIniciarCompact('/compact resumindo vendas', false), true);
  });

  it('preserva o que foi digitado durante a subida do anexo', () => {
    assert.equal(textoDepoisDaEntregaDoAnexo('legenda nova', 'legenda enviada'), 'legenda nova');
    assert.equal(textoDepoisDaEntregaDoAnexo('legenda enviada', 'legenda enviada'), '');
  });

  it('leva o recibo de fila da máquina para a apresentação', () => {
    const estado: EstadoEnvio = {
      fase: 'confirmado',
      texto: 'faça isso',
      fronteira: { id: 10, origem: 'barreira-do-servidor' },
      ecoId: 11,
      ecosIguaisSemDono: 0,
      fila: true,
    };

    assert.equal(envioVeioDaFila(estado), true);
    assert.equal(envioVeioDaFila({ fase: 'ocioso' }), false);
  });

  it('não envia Enter durante composição de caracteres', () => {
    assert.equal(
      deveEnviarPorEnter({
        key: 'Enter',
        shiftKey: false,
        tecladoTouch: false,
        temAnexo: false,
        isComposing: true,
      }),
      false,
    );
  });

  it('preserva as regras existentes de teclado', () => {
    assert.equal(
      deveEnviarPorEnter({
        key: 'Enter',
        shiftKey: false,
        tecladoTouch: false,
        temAnexo: false,
        isComposing: false,
      }),
      true,
    );
    assert.equal(
      deveEnviarPorEnter({
        key: 'Enter',
        shiftKey: false,
        tecladoTouch: true,
        temAnexo: false,
        isComposing: false,
      }),
      false,
    );
  });
});
