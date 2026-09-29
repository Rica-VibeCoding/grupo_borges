import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  avisoDaTela,
  avisoQuePedeAcao,
  falasVisiveis,
  leituraDaConversa,
  rotuloDaAcao,
  voceDisseParaLeitor,
} from './leitura-da-conversa.ts';
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

  it('a escuta que emudeceu pede o toque para voltar a ouvir', () => {
    const leitura = leituraDaConversa({ ...base, cena: 'erro', motivo: 'escutaMuda' });
    assert.equal(leitura.titulo, 'Parei de te ouvir');
    assert.match(leitura.detalhe, /Toque para voltar a ouvir/);
    assert.equal(rotuloDaAcao('erro', false), 'Tentar de novo');
    // Voltou da recarga com a conversa aberta: o toque continua a conversa, não começa outra.
    assert.equal(rotuloDaAcao('parado', false, true), 'Continuar conversa');
    assert.equal(rotuloDaAcao('parado', false, false), 'Começar conversa');
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
    assert.equal(rotuloDaAcao('erro', false), 'Tentar de novo');
    assert.equal(rotuloDaAcao('preparando', false), 'Preparando…');
    assert.equal(rotuloDaAcao('parado', true), 'Detector indisponível');
  });

  it('a sua fala aparece depois de transcrita; a dele só enquanto responde', () => {
    assert.deepEqual(falasVisiveis('ouvindo'), { voce: null, ze: false });
    assert.deepEqual(falasVisiveis('esperandoZe'), { voce: 'cheia', ze: false });
    assert.deepEqual(falasVisiveis('falando'), { voce: 'recuada', ze: true });
    assert.deepEqual(falasVisiveis('interrompendo'), { voce: 'recuada', ze: true });
  });

  it('com o texto desligado, a linha junto do botão só aparece quando pede ação', () => {
    const quieto = { preparacaoFalhou: false, aviso: null, wakeLockSuportado: true, wakeLockFalhou: false };
    for (const cena of CENAS.filter((c) => c !== 'erro')) assert.equal(avisoQuePedeAcao({ ...quieto, cena }), null, cena);
    assert.equal(avisoQuePedeAcao({ ...quieto, cena: 'erro', motivo: 'microfoneNegado' }), 'Sem acesso ao microfone');
    assert.equal(avisoQuePedeAcao({ ...quieto, cena: 'erro' }), 'A conversa parou');
    assert.match(avisoQuePedeAcao({ ...quieto, cena: 'parado', preparacaoFalhou: true }) ?? '', /detector não carregou/);
    assert.match(avisoQuePedeAcao({ ...quieto, cena: 'ouvindo', wakeLockFalhou: true }) ?? '', /tela acesa/);
    assert.match(avisoQuePedeAcao({ ...quieto, cena: 'falando', wakeLockSuportado: false }) ?? '', /tela acesa/);
    assert.equal(avisoQuePedeAcao({ ...quieto, cena: 'falando', aviso: 'O navegador impediu a reprodução da resposta.' }), 'O navegador impediu a reprodução da resposta.');
  });

  it('parado não carrega aviso velho nem reclama da tela acesa', () => {
    const velho = { preparacaoFalhou: false, aviso: 'O navegador impediu a reprodução da resposta.', wakeLockSuportado: false, wakeLockFalhou: true };
    assert.equal(avisoQuePedeAcao({ ...velho, cena: 'parado' }), null);
  });

  it('o aviso do pé: com o texto, o erro ganha o que fazer numa segunda linha, sem repetir o título', () => {
    const quieto = { preparacaoFalhou: false, aviso: null, wakeLockSuportado: true, wakeLockFalhou: false };
    const envio = { ...quieto, cena: 'erro' as const, motivo: 'envioFalhou' as const };
    assert.deepEqual(avisoDaTela(envio, false), { linha: 'A mensagem não saiu', detalhe: null });
    assert.deepEqual(avisoDaTela(envio, true), {
      linha: 'A mensagem não saiu',
      detalhe: 'A mensagem não chegou ao agente. Toque para tentar novamente.',
    });
    // "Não ouvi uma frase" + "Não ouvi uma frase completa." diria a mesma coisa duas vezes.
    assert.deepEqual(avisoDaTela({ ...quieto, cena: 'erro', motivo: 'transcricaoVazia' }, true), {
      linha: 'Não ouvi uma frase',
      detalhe: null,
    });
    assert.equal(avisoDaTela({ ...quieto, cena: 'parado', preparacaoFalhou: true }, true)?.detalhe, null);
    assert.equal(avisoDaTela({ ...quieto, cena: 'ouvindo', wakeLockFalhou: true }, true)?.detalhe, null);
    assert.equal(avisoDaTela({ ...quieto, cena: 'falando' }, true), null);
  });

  it('o leitor de tela ouve o que foi entendido enquanto ele pensa, não o texto antigo', () => {
    assert.equal(voceDisseParaLeitor('esperandoZe', 'Qual a previsão?'), 'Você disse: “Qual a previsão?”');
    assert.equal(voceDisseParaLeitor('transcrevendo', 'frase anterior'), null);
    assert.equal(voceDisseParaLeitor('ouvindo', 'frase anterior'), null);
    assert.equal(voceDisseParaLeitor('esperandoZe', null), null);
  });
});
