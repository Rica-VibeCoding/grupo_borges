import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avanca, inicial } from './maquina.ts';
import type { Conversa, Efeito, Evento, MotivoDeErro } from './tipos.ts';

type Passo = { evento: Evento; agora: number };

// Roda uma sequência de eventos sobre uma conversa nova e devolve o estado final
// e a lista de efeitos na ordem em que saíram.
function roda(sequencia: Passo[]): { conversa: Conversa; efeitos: Efeito[] } {
  let conversa = inicial();
  const efeitos: Efeito[] = [];
  for (const { evento, agora } of sequencia) {
    const r = avanca(conversa, evento, agora);
    conversa = r.conversa;
    efeitos.push(...r.efeitos);
  }
  return { conversa, efeitos };
}

const soTipos = (efeitos: Efeito[]): string[] => efeitos.map((e) => e.tipo);

// Atalho: leva a conversa até `esperandoZe` (comecar → fala → transcrever → enviar).
function ateEspera(agoraEnviou = 300): Passo[] {
  return [
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'falaTerminou', audio: new Float32Array(0) }, agora: 100 },
    { evento: { tipo: 'transcreveu', texto: 'oi' }, agora: 200 },
    { evento: { tipo: 'enviou' }, agora: agoraEnviou },
  ];
}

test('inicial começa parado e sem motivo', () => {
  assert.deepEqual(inicial(), { estado: 'parado' });
});

test('ciclo feliz: parado → ouvindo → transcrevendo → esperandoZe → falando → ouvindo', () => {
  const { conversa, efeitos } = roda([
    ...ateEspera(),
    { evento: { tipo: 'textoDoZe', texto: 'olá' }, agora: 400 },
    { evento: { tipo: 'zeTerminou' }, agora: 500 },
    { evento: { tipo: 'vozTerminou' }, agora: 600 },
  ]);

  assert.equal(conversa.estado, 'ouvindo');
  assert.deepEqual(soTipos(efeitos), [
    'ligarDetector',
    'desligarDetector',
    'transcrever',
    'enviar',
    'tocarTique',
    'desligarDetector',
    'falar',
    'ligarDetector',
  ]);
});

test('comecar repetido não liga detector de novo', () => {
  const { conversa, efeitos } = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'comecar' }, agora: 10 },
    { evento: { tipo: 'comecar' }, agora: 20 },
    { evento: { tipo: 'comecar' }, agora: 30 },
  ]);

  assert.equal(conversa.estado, 'ouvindo');
  assert.equal(soTipos(efeitos).filter((t) => t === 'ligarDetector').length, 1);
});

test('relógio: tique ao enviar, ponte uma vez aos 5 s, aviso uma vez aos 20 s', () => {
  const { efeitos } = roda([
    ...ateEspera(1000),
    { evento: { tipo: 'tique' }, agora: 2000 }, // 1 s: nada
    { evento: { tipo: 'tique' }, agora: 6000 }, // 5 s: ponte
    { evento: { tipo: 'tique' }, agora: 7000 }, // ponte já dita: nada
    { evento: { tipo: 'tique' }, agora: 21000 }, // 20 s: aviso
    { evento: { tipo: 'tique' }, agora: 22000 }, // aviso já dito: nada
  ]);

  assert.deepEqual(soTipos(efeitos), [
    'ligarDetector',
    'desligarDetector',
    'transcrever',
    'enviar',
    'tocarTique',
    'falarPonte',
    'avisarDemora',
  ]);
});

test('tique esparso dispara ponte e aviso juntos, nessa ordem', () => {
  const { efeitos } = roda([...ateEspera(0), { evento: { tipo: 'tique' }, agora: 21000 }]);

  assert.deepEqual(soTipos(efeitos).slice(-2), ['falarPonte', 'avisarDemora']);
});

test('transcricaoVazia (via falhou) volta a ouvir sem avisar', () => {
  const { conversa, efeitos } = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'falaTerminou', audio: new Float32Array(0) }, agora: 100 },
    { evento: { tipo: 'falhou', motivo: 'transcricaoVazia' }, agora: 200 },
  ]);

  assert.equal(conversa.estado, 'ouvindo');
  assert.equal(conversa.motivo, undefined);
  assert.ok(!soTipos(efeitos).includes('avisarErro'));
  assert.deepEqual(soTipos(efeitos), ['ligarDetector', 'desligarDetector', 'transcrever', 'ligarDetector']);
});

test('transcreveu vazio volta a ouvir sem incomodar', () => {
  const { conversa, efeitos } = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'falaTerminou', audio: new Float32Array(0) }, agora: 100 },
    { evento: { tipo: 'transcreveu', texto: '   ' }, agora: 200 },
  ]);

  assert.equal(conversa.estado, 'ouvindo');
  assert.ok(!soTipos(efeitos).includes('enviar'));
  assert.ok(!soTipos(efeitos).includes('avisarErro'));
});

test('cada erro duro leva a erro com avisarErro e motivo', () => {
  const motivos: MotivoDeErro[] = [
    'microfoneNegado',
    'capturaCaiu',
    'transcricaoFalhou',
    'envioFalhou',
    'agenteOcupado',
  ];
  for (const motivo of motivos) {
    const { conversa, efeitos } = roda([
      { evento: { tipo: 'comecar' }, agora: 0 },
      { evento: { tipo: 'falhou', motivo }, agora: 100 },
    ]);

    assert.equal(conversa.estado, 'erro', `${motivo} deveria levar a erro`);
    assert.equal(conversa.motivo, motivo);
    assert.deepEqual(soTipos(efeitos), ['ligarDetector', 'desligarDetector', 'avisarErro']);
  }
});

test('evento capturaCaiu leva a erro com aviso', () => {
  const { conversa, efeitos } = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'capturaCaiu' }, agora: 100 },
  ]);

  assert.equal(conversa.estado, 'erro');
  assert.equal(conversa.motivo, 'capturaCaiu');
  assert.deepEqual(soTipos(efeitos), ['ligarDetector', 'desligarDetector', 'avisarErro']);
});

test('do erro, comecar recomeça limpo e parar volta ao parado', () => {
  const a = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'falhou', motivo: 'microfoneNegado' }, agora: 100 },
    { evento: { tipo: 'comecar' }, agora: 200 },
  ]);
  assert.equal(a.conversa.estado, 'ouvindo');
  assert.equal(a.conversa.motivo, undefined);

  const b = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'falhou', motivo: 'microfoneNegado' }, agora: 100 },
    { evento: { tipo: 'parar' }, agora: 200 },
  ]);
  assert.equal(b.conversa.estado, 'parado');
  assert.equal(b.conversa.motivo, undefined);
});

test('sai de falando só quando voz E stream terminam', () => {
  const soVoz = roda([...ateEspera(), { evento: { tipo: 'textoDoZe', texto: 'a' }, agora: 400 }, { evento: { tipo: 'vozTerminou' }, agora: 500 }]);
  assert.equal(soVoz.conversa.estado, 'falando', 'Zé ainda não terminou');

  const ambos = roda([
    ...ateEspera(),
    { evento: { tipo: 'textoDoZe', texto: 'a' }, agora: 400 },
    { evento: { tipo: 'vozTerminou' }, agora: 500 },
    { evento: { tipo: 'zeTerminou' }, agora: 600 },
  ]);
  assert.equal(ambos.conversa.estado, 'ouvindo');
});

test('texto novo em falando zera vozAcabou — não religa detector com voz tocando', () => {
  const { conversa, efeitos } = roda([
    ...ateEspera(),
    { evento: { tipo: 'textoDoZe', texto: 'texto 1' }, agora: 400 },
    { evento: { tipo: 'vozTerminou' }, agora: 500 }, // voz do texto 1 acaba
    { evento: { tipo: 'textoDoZe', texto: 'texto 2' }, agora: 600 }, // voz nova entra na fila
    { evento: { tipo: 'zeTerminou' }, agora: 700 }, // stream cai logo depois
  ]);

  // A voz do texto 2 ainda está tocando: continua em falando, detector desligado.
  assert.equal(conversa.estado, 'falando');
  assert.equal(soTipos(efeitos).filter((t) => t === 'ligarDetector').length, 1);

  // Só quando a voz do texto 2 termina é que volta a ouvir e religa o detector.
  const fim = roda([
    ...ateEspera(),
    { evento: { tipo: 'textoDoZe', texto: 'texto 1' }, agora: 400 },
    { evento: { tipo: 'vozTerminou' }, agora: 500 },
    { evento: { tipo: 'textoDoZe', texto: 'texto 2' }, agora: 600 },
    { evento: { tipo: 'zeTerminou' }, agora: 700 },
    { evento: { tipo: 'vozTerminou' }, agora: 800 },
  ]);
  assert.equal(fim.conversa.estado, 'ouvindo');
});

test('cada texto do Zé vira falar; desligarDetector só ao entrar em falando', () => {
  const { efeitos } = roda([
    ...ateEspera(),
    { evento: { tipo: 'textoDoZe', texto: 'olá' }, agora: 400 },
    { evento: { tipo: 'textoDoZe', texto: 'tudo bem?' }, agora: 500 },
    { evento: { tipo: 'textoDoZe', texto: 'fim' }, agora: 600 },
  ]);

  assert.deepEqual(soTipos(efeitos), [
    'ligarDetector',
    'desligarDetector',
    'transcrever',
    'enviar',
    'tocarTique',
    'desligarDetector',
    'falar',
    'falar',
    'falar',
  ]);
});

test('parar no meio reseta e só desliga se o detector estava ligado', () => {
  const { conversa, efeitos } = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'falaTerminou', audio: new Float32Array(0) }, agora: 100 },
    { evento: { tipo: 'transcreveu', texto: 'oi' }, agora: 200 },
    { evento: { tipo: 'parar' }, agora: 300 },
    { evento: { tipo: 'comecar' }, agora: 400 },
  ]);

  assert.equal(conversa.estado, 'ouvindo');
  // parar em `transcrevendo` não emite desligar (detector já tinha caído no falaTerminou).
  assert.deepEqual(soTipos(efeitos), [
    'ligarDetector',
    'desligarDetector',
    'transcrever',
    'enviar',
    'tocarTique',
    'ligarDetector',
  ]);
});

test('eventos fora de ordem em parado não produzem efeito', () => {
  const { conversa, efeitos } = roda([
    { evento: { tipo: 'transcreveu', texto: 'x' }, agora: 0 },
    { evento: { tipo: 'enviou' }, agora: 0 },
    { evento: { tipo: 'textoDoZe', texto: 'y' }, agora: 0 },
    { evento: { tipo: 'vozTerminou' }, agora: 0 },
    { evento: { tipo: 'zeTerminou' }, agora: 0 },
  ]);

  assert.equal(conversa.estado, 'parado');
  assert.deepEqual(efeitos, []);
});

test('falaIniciou e falaDescartada em ouvindo não mudam estado', () => {
  const { conversa, efeitos } = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'falaIniciou' }, agora: 100 },
    { evento: { tipo: 'falaDescartada' }, agora: 200 },
  ]);

  assert.equal(conversa.estado, 'ouvindo');
  assert.deepEqual(soTipos(efeitos), ['ligarDetector']);
});

test('textoDoZe em ouvindo volta para falando (defensivo)', () => {
  const { conversa, efeitos } = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'textoDoZe', texto: 'sem aviso' }, agora: 100 },
  ]);

  assert.equal(conversa.estado, 'falando');
  assert.deepEqual(soTipos(efeitos), ['ligarDetector', 'desligarDetector', 'falar']);
});

test('Zé terminou sem falar nada volta a ouvir', () => {
  const { conversa, efeitos } = roda([...ateEspera(), { evento: { tipo: 'zeTerminou' }, agora: 400 }]);

  assert.equal(conversa.estado, 'ouvindo');
  assert.deepEqual(soTipos(efeitos), [
    'ligarDetector',
    'desligarDetector',
    'transcrever',
    'enviar',
    'tocarTique',
    'ligarDetector',
  ]);
});

test('efeitos carregam o payload certo', () => {
  const audio = new Float32Array(4);
  const { efeitos } = roda([
    { evento: { tipo: 'comecar' }, agora: 0 },
    { evento: { tipo: 'falaTerminou', audio }, agora: 100 },
    { evento: { tipo: 'transcreveu', texto: 'oi' }, agora: 200 },
    { evento: { tipo: 'textoDoZe', texto: 'resposta' }, agora: 300 },
  ]);

  const transcrever = efeitos.find((e) => e.tipo === 'transcrever');
  const enviar = efeitos.find((e) => e.tipo === 'enviar');
  const falar = efeitos.find((e) => e.tipo === 'falar');

  assert.ok(transcrever && transcrever.tipo === 'transcrever' && transcrever.audio === audio);
  assert.ok(enviar && enviar.tipo === 'enviar' && enviar.texto === 'oi');
  assert.ok(falar && falar.tipo === 'falar' && falar.texto === 'resposta');
});
