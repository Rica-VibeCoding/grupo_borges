import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BATIDA_DA_VIGIA_MS,
  PRAZOS_DA_ESCUTA,
  criaVigiaDaEscuta,
  passoDaVigia,
  quedaDaEscuta,
  type SinaisDaEscuta,
  type Vigia,
} from './vigia-da-escuta.ts';

const VIVOS: SinaisDaEscuta = { contexto: 'running', faixaMuda: false, semQuadroHaMs: 40 };

test('a escuta caiu: contexto fora de running, faixa muda ou quadros parados', () => {
  assert.equal(quedaDaEscuta(VIVOS), null);
  assert.equal(quedaDaEscuta({ ...VIVOS, contexto: 'suspended' }), 'contexto');
  assert.equal(quedaDaEscuta({ ...VIVOS, contexto: 'interrupted' }), 'contexto', 'o estado que só o Safari tem');
  assert.equal(quedaDaEscuta({ ...VIVOS, faixaMuda: true }), 'faixa');
  assert.equal(quedaDaEscuta({ ...VIVOS, semQuadroHaMs: PRAZOS_DA_ESCUTA.semQuadro }), 'quadros');
  assert.equal(quedaDaEscuta({ ...VIVOS, semQuadroHaMs: PRAZOS_DA_ESCUTA.semQuadro - 1 }), null);
  assert.equal(quedaDaEscuta({ ...VIVOS, contexto: null }), null, 'antes do primeiro contexto não há o que conferir');
});

test('a escada: retoma, reabre depois de ~1 s, desiste depois do prazo da reabertura', () => {
  let v: Vigia = { fase: 'viva' };
  const passo = (queda: 'contexto' | null, agora: number) => {
    const r = passoDaVigia(v, queda, agora);
    v = r.vigia;
    return r.acao;
  };
  assert.equal(passo('contexto', 0), 'retomar');
  assert.equal(passo('contexto', 250), 'nada');
  assert.equal(passo('contexto', PRAZOS_DA_ESCUTA.retomar), 'reabrir');
  const reabriuEm = PRAZOS_DA_ESCUTA.retomar;
  assert.equal(passo('contexto', reabriuEm + PRAZOS_DA_ESCUTA.reabrir - 1), 'nada');
  assert.equal(passo('contexto', reabriuEm + PRAZOS_DA_ESCUTA.reabrir), 'desistir');
  assert.deepEqual(v, { fase: 'viva' }, 'depois de desistir, a próxima escuta começa do zero');
});

test('qualquer sinal de vida volta ao começo da escada', () => {
  const retomando = passoDaVigia({ fase: 'viva' }, 'faixa', 0).vigia;
  assert.deepEqual(passoDaVigia(retomando, null, 500), { vigia: { fase: 'viva' }, acao: 'nada' });
  const reabrindo: Vigia = { fase: 'reabrindo', desde: 0 };
  assert.deepEqual(passoDaVigia(reabrindo, null, 900), { vigia: { fase: 'viva' }, acao: 'nada' });
});

function relogio() {
  let agora = 0;
  let batida: (() => void) | null = null;
  return {
    agora: () => agora,
    bate: (fn: () => void, ms: number) => {
      assert.equal(ms, BATIDA_DA_VIGIA_MS);
      batida = fn;
      return () => { batida = null; };
    },
    avanca(ms: number) {
      for (let i = 0; i < ms / BATIDA_DA_VIGIA_MS; i++) {
        agora += BATIDA_DA_VIGIA_MS;
        batida?.();
      }
    },
    batendo: () => batida !== null,
  };
}

test('a vigia confere na hora em que o detector liga e pede o toque quando nada volta', async () => {
  const r = relogio();
  const acoes: string[] = [];
  let sinais: SinaisDaEscuta = { ...VIVOS, contexto: 'suspended' };
  const vigia = criaVigiaDaEscuta({
    leSinais: () => sinais,
    retoma: () => acoes.push('retoma'),
    reabre: async () => { acoes.push('reabre'); },
    desiste: () => acoes.push('desiste'),
    agora: r.agora,
    bate: r.bate,
  });
  vigia.comeca();
  assert.deepEqual(acoes, ['retoma'], 'a volta de "falando" para "ouvindo" já confere o contexto');
  r.avanca(PRAZOS_DA_ESCUTA.retomar);
  assert.deepEqual(acoes, ['retoma', 'reabre']);
  r.avanca(PRAZOS_DA_ESCUTA.reabrir);
  assert.deepEqual(acoes, ['retoma', 'reabre', 'desiste']);
  assert.equal(r.batendo(), false, 'desistiu: a vigia para até o próximo toque');

  // O toque religa o detector; com o áudio de volta, a vigia fica quieta.
  sinais = VIVOS;
  vigia.comeca();
  r.avanca(3000);
  assert.deepEqual(acoes, ['retoma', 'reabre', 'desiste']);
});

test('a vigia desiste na hora se reabrir falha, e ignora a reabertura depois de parar', async () => {
  const r = relogio();
  const acoes: string[] = [];
  let falha: (erro: Error) => void = () => {};
  const vigia = criaVigiaDaEscuta({
    leSinais: () => ({ ...VIVOS, faixaMuda: true }),
    retoma: () => acoes.push('retoma'),
    reabre: () => new Promise<void>((_, rejeita) => { acoes.push('reabre'); falha = rejeita; }),
    desiste: () => acoes.push('desiste'),
    agora: r.agora,
    bate: r.bate,
  });
  vigia.comeca();
  r.avanca(PRAZOS_DA_ESCUTA.retomar);
  falha(new Error('microfone negado'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(acoes, ['retoma', 'reabre', 'desiste']);

  // Parou (o usuário tocou para encerrar) com a reabertura em voo: a falha dela não é alarme.
  vigia.comeca();
  r.avanca(PRAZOS_DA_ESCUTA.retomar);
  vigia.para();
  falha(new Error('tarde demais'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(acoes, ['retoma', 'reabre', 'desiste', 'retoma', 'reabre']);
});

test('um sinal que muda (statechange, mute) confere sem esperar a batida — só com a vigia ligada', () => {
  const r = relogio();
  const acoes: string[] = [];
  let sinais = VIVOS;
  const vigia = criaVigiaDaEscuta({
    leSinais: () => sinais,
    retoma: () => acoes.push('retoma'),
    reabre: async () => {},
    desiste: () => {},
    agora: r.agora,
    bate: r.bate,
  });
  sinais = { ...VIVOS, contexto: 'interrupted' };
  vigia.confere();
  assert.deepEqual(acoes, [], 'detector desligado: o contexto parado é o esperado');
  vigia.comeca();
  assert.deepEqual(acoes, ['retoma']);
});
