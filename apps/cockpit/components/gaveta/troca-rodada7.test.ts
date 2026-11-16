import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as troca from '../../lib/troca-em-curso.ts';
import { monta, operacao } from './troca-bancada.test.ts';

beforeEach(() => troca.limpaTrocasNoChat());
for (const estado of ['aceito', 'morto', 'adotada', 'conferindo'] as const) {
  test(`R7: Nova conversa fecha gaveta e mostra troca ${estado} sem outro POST`, () => {
    const h = monta('./usa-troca-direta.ts', 'usaTrocaDireta', {
      postConversaNova: async () => { assert.fail('não duplica a troca em curso'); },
    }, ['pavan', 'Pavan']);
    try {
      h.render();
      troca.comecarTroca('pavan', { tipo: 'retomar', alvo: 'destino', forcar: false, desligado: false }, 0, 'cliente');
      if (estado === 'morto') troca.postMorreu('pavan', 'cliente', 2_000);
      else if (estado === 'adotada') {
        troca.postRecusado('pavan', 'cliente', 'operacao_em_curso', 100);
        troca.operacaoLida('pavan', troca.carimboDaLeitura('pavan'), operacao('externa', 'religando'), 2_000);
      } else troca.postRespondeu('pavan', 'cliente', operacao('cliente', estado === 'conferindo' ? 'erro' : 'religando'), 2_000);
      troca.confereTroca('pavan', {}, 2_000);
      const corrente = troca.leTroca('pavan');
      let fechou = false;
      h.render().pede({ tipo: 'nova', alvo: null, interrompe: false, aoAceitar: () => { fechou = true; } });
      assert.equal(fechou, true);
      assert.equal(troca.leTroca('pavan'), corrente);
      assert.equal(troca.leTrocaNoChat('pavan')?.fase, 'trocando');
    } finally { h.desmonta(); }
  });
}
