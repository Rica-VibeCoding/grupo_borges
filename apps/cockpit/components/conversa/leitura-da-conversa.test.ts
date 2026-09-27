import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { falasVisiveis, leituraDaConversa, rotuloDaAcao } from './leitura-da-conversa.ts';
import type { Cena } from './moldura-estado.ts';

const base = { preparacaoFalhou: false, abrindoMicrofone: false, falaDetectada: false, fone: false };
const CENAS: Cena[] = ['parado', 'preparando', 'ouvindo', 'transcrevendo', 'esperandoZe', 'falando', 'interrompendo', 'erro'];

describe('leitura da tela de conversa', () => {
  it('toda cena tem título e detalhe curtos', () => {
    for (const cena of CENAS) {
      const { titulo, detalhe } = leituraDaConversa({ ...base, cena });
      assert.ok(titulo.length > 0 && titulo.length <= 24, `${cena}: ${titulo}`);
      assert.ok(detalhe.length > 0, cena);
    }
  });

  it('ouvindo muda de "pode falar" para "estou ouvindo" quando a fala começa', () => {
    assert.equal(leituraDaConversa({ ...base, cena: 'ouvindo' }).titulo, 'Pode falar');
    assert.equal(leituraDaConversa({ ...base, cena: 'ouvindo', falaDetectada: true }).titulo, 'Estou ouvindo');
  });

  it('o erro diz o que caiu e como voltar', () => {
    const leitura = leituraDaConversa({ ...base, cena: 'erro', motivo: 'capturaCaiu' });
    assert.equal(leitura.titulo, 'O microfone desligou');
    assert.match(leitura.detalhe, /microfone/);
    assert.equal(leituraDaConversa({ ...base, cena: 'erro' }).titulo, 'A conversa parou');
  });

  it('com fone, a resposta ensina a interromper', () => {
    assert.match(leituraDaConversa({ ...base, cena: 'falando', fone: true }).detalhe, /por cima/);
    assert.doesNotMatch(leituraDaConversa({ ...base, cena: 'falando' }).detalhe, /por cima/);
  });

  it('falha de preparo e microfone abrindo passam na frente da cena', () => {
    assert.equal(leituraDaConversa({ ...base, cena: 'parado', preparacaoFalhou: true }).titulo, 'O detector não carregou');
    assert.equal(leituraDaConversa({ ...base, cena: 'ouvindo', abrindoMicrofone: true }).titulo, 'Liberando o microfone');
  });

  it('o botão mantém os nomes que o E2E e o Rica conhecem', () => {
    assert.equal(rotuloDaAcao('parado', false), 'Começar conversa');
    assert.equal(rotuloDaAcao('ouvindo', false), 'Encerrar conversa');
    assert.equal(rotuloDaAcao('erro', false), 'Retomar conversa');
    assert.equal(rotuloDaAcao('preparando', false), 'Preparando…');
    assert.equal(rotuloDaAcao('parado', true), 'Detector indisponível');
  });

  it('a sua fala aparece depois de transcrita; a dele só enquanto responde', () => {
    assert.deepEqual(falasVisiveis('ouvindo'), { voce: null, ze: false });
    assert.deepEqual(falasVisiveis('esperandoZe'), { voce: 'cheia', ze: false });
    assert.deepEqual(falasVisiveis('falando'), { voce: 'recuada', ze: true });
    assert.deepEqual(falasVisiveis('interrompendo'), { voce: 'recuada', ze: true });
  });
});
