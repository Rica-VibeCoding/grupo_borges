import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estadoInicialEnvio,
  normalizaTextoDoEco,
  PRAZO_ECO_MS,
  reduzEnvio,
  type EstadoEnvio,
} from './envio.ts';

function enviando(texto = 'faz isso', fronteiraId = 10): EstadoEnvio {
  return reduzEnvio(estadoInicialEnvio, {
    tipo: 'enviar',
    texto,
    fronteira: { id: fronteiraId, origem: 'barreira-do-servidor' },
  });
}

test('200 deixa o envio aceito, ainda sem cantar sucesso', () => {
  const estado = reduzEnvio(enviando(), { tipo: 'aceitar', agoraMs: 1_000 });
  assert.equal(estado.fase, 'aceito');
});

test('409, rede ou erro do back falha durante o POST', () => {
  const erro = new Error('agent_pane_unavailable');
  const estado = reduzEnvio(enviando(), {
    tipo: 'falhar',
    erro,
    entregaIncerta: false,
  });
  assert.deepEqual(estado, {
    fase: 'falhou',
    texto: 'faz isso',
    fronteira: { id: 10, origem: 'barreira-do-servidor' },
    ecosIguaisSemDono: 0,
    erro,
    entregaIncerta: false,
  });
});

test('só item user posterior e com o mesmo texto confirma', () => {
  const aceito = reduzEnvio(enviando(), {
    tipo: 'aceitar',
    agoraMs: 1_000,
  });
  const assistente = reduzEnvio(aceito, {
    tipo: 'item-do-stream',
    item: { id: 11, papel: 'assistant', texto: 'faz isso' },
  });
  const diferente = reduzEnvio(assistente, {
    tipo: 'item-do-stream',
    item: { id: 12, papel: 'user', texto: 'outra coisa' },
  });
  const confirmado = reduzEnvio(diferente, {
    tipo: 'item-do-stream',
    item: { id: 13, papel: 'user', texto: 'faz isso' },
  });

  assert.equal(assistente.fase, 'aceito');
  assert.equal(diferente.fase, 'aceito');
  assert.equal(confirmado.fase, 'confirmado');
  if (confirmado.fase === 'confirmado') assert.equal(confirmado.ecoId, 13);
});

test('normaliza Unicode, whitespace, CRLF e quebras refluídas', () => {
  assert.equal(normalizaTextoDoEco('  cafe\u0301\r\n com\tleite  '), 'café com leite');

  const candidato = reduzEnvio(enviando('café\ncom leite'), {
    tipo: 'item-do-stream',
    item: { id: 11, papel: 'user', texto: ' cafe\u0301  com\r\nleite ' },
  });
  const estado = reduzEnvio(candidato, { tipo: 'aceitar', agoraMs: 0 });
  assert.equal(estado.fase, 'confirmado');
});

test('item que já estava no feed, coberto pelo replay-end, nunca confirma', () => {
  const estado = reduzEnvio(enviando('ok', 42), {
    tipo: 'item-do-stream',
    item: { id: 42, papel: 'user', texto: 'ok' },
  });
  assert.equal(estado.fase, 'enviando');
});

test('dois envios iguais em sequência não reutilizam o primeiro eco', () => {
  const primeiro = reduzEnvio(
    reduzEnvio(enviando('ok', 40), { tipo: 'aceitar', agoraMs: 0 }),
    {
      tipo: 'item-do-stream',
      item: { id: 41, papel: 'user', texto: 'ok' },
    },
  );
  assert.equal(primeiro.fase, 'confirmado');

  const segundo = reduzEnvio(primeiro, {
    tipo: 'enviar',
    texto: 'ok',
    fronteira: { id: 41, origem: 'barreira-do-servidor' },
  });
  const ecoRepetido = reduzEnvio(segundo, {
    tipo: 'item-do-stream',
    item: { id: 41, papel: 'user', texto: 'ok' },
  });
  const segundoEco = reduzEnvio(ecoRepetido, {
    tipo: 'item-do-stream',
    item: { id: 42, papel: 'user', texto: 'ok' },
  });
  const segundoAceito = reduzEnvio(segundoEco, {
    tipo: 'aceitar',
    agoraMs: 1,
  });

  assert.equal(ecoRepetido.fase, 'enviando');
  assert.equal(segundoEco.fase, 'enviando');
  assert.equal(segundoAceito.fase, 'confirmado');
});

test('retry idêntico após pendurado não rouba eventual eco do primeiro', () => {
  const primeiroPendurado = reduzEnvio(
    reduzEnvio(enviando('ok', 40), { tipo: 'aceitar', agoraMs: 0 }),
    { tipo: 'tempo-passou', agoraMs: PRAZO_ECO_MS },
  );
  const retry = reduzEnvio(primeiroPendurado, {
    tipo: 'enviar',
    texto: 'ok',
    fronteira: { id: 40, origem: 'barreira-do-servidor' },
  });
  const ecoAmbiguo = reduzEnvio(retry, {
    tipo: 'item-do-stream',
    item: { id: 41, papel: 'user', texto: 'ok' },
  });
  const ecoSeguinte = reduzEnvio(ecoAmbiguo, {
    tipo: 'item-do-stream',
    item: { id: 42, papel: 'user', texto: 'ok' },
  });
  const aceito = reduzEnvio(ecoSeguinte, { tipo: 'aceitar', agoraMs: 1 });

  assert.equal(ecoAmbiguo.fase, 'enviando');
  assert.equal(aceito.fase, 'confirmado');
});

test('dívida de eco idêntico não contamina um texto diferente', () => {
  const primeiroPendurado = reduzEnvio(
    reduzEnvio(enviando('ok', 40), { tipo: 'aceitar', agoraMs: 0 }),
    { tipo: 'tempo-passou', agoraMs: PRAZO_ECO_MS },
  );
  const retry = reduzEnvio(primeiroPendurado, {
    tipo: 'enviar',
    texto: 'ok',
    fronteira: { id: 40, origem: 'barreira-do-servidor' },
  });
  const retryFalhou = reduzEnvio(retry, {
    tipo: 'falhar',
    erro: new Error('rede'),
    entregaIncerta: true,
  });
  const textoNovo = reduzEnvio(retryFalhou, {
    tipo: 'enviar',
    texto: 'agora outra coisa',
    fronteira: { id: 40, origem: 'barreira-do-servidor' },
  });
  const ecoNovo = reduzEnvio(textoNovo, {
    tipo: 'item-do-stream',
    item: { id: 41, papel: 'user', texto: 'agora outra coisa' },
  });
  const aceito = reduzEnvio(ecoNovo, { tipo: 'aceitar', agoraMs: 1 });

  assert.equal(aceito.fase, 'confirmado');
});

test('não substitui uma tentativa ainda em voo por outro envio', () => {
  const primeiro = enviando('primeiro', 10);
  const sobreposto = reduzEnvio(primeiro, {
    tipo: 'enviar',
    texto: 'segundo',
    fronteira: { id: 10, origem: 'barreira-do-servidor' },
  });
  assert.strictEqual(sobreposto, primeiro);
});

test('prazo conta a partir do aceite e vira pendurado no limite', () => {
  const aceito = reduzEnvio(enviando(), {
    tipo: 'aceitar',
    agoraMs: 5_000,
  });
  const antes = reduzEnvio(aceito, {
    tipo: 'tempo-passou',
    agoraMs: 5_000 + PRAZO_ECO_MS - 1,
  });
  const noLimite = reduzEnvio(antes, {
    tipo: 'tempo-passou',
    agoraMs: 5_000 + PRAZO_ECO_MS,
  });

  assert.equal(antes.fase, 'aceito');
  assert.equal(noLimite.fase, 'pendurado');
});

test('eco durante o POST só confirma depois do 200', () => {
  const candidato = reduzEnvio(enviando('rápido'), {
    tipo: 'item-do-stream',
    item: { id: 11, papel: 'user', texto: 'rápido' },
  });
  const estado = reduzEnvio(candidato, { tipo: 'aceitar', agoraMs: 1 });
  assert.equal(candidato.fase, 'enviando');
  assert.equal(estado.fase, 'confirmado');
});

test('409 vence um eco candidato e retry idêntico usa o primeiro eco real', () => {
  const candidato = reduzEnvio(enviando('ok', 40), {
    tipo: 'item-do-stream',
    item: { id: 41, papel: 'user', texto: 'ok' },
  });
  const falhou = reduzEnvio(candidato, {
    tipo: 'falhar',
    erro: new Error('409'),
    entregaIncerta: false,
  });
  const retry = reduzEnvio(falhou, {
    tipo: 'enviar',
    texto: 'ok',
    fronteira: { id: 41, origem: 'barreira-do-servidor' },
  });
  const aceito = reduzEnvio(retry, { tipo: 'aceitar', agoraMs: 1 });
  const ecoReal = reduzEnvio(aceito, {
    tipo: 'item-do-stream',
    item: { id: 42, papel: 'user', texto: 'ok' },
  });

  assert.equal(falhou.fase, 'falhou');
  assert.equal(ecoReal.fase, 'confirmado');
});

test('eco tardio recupera um envio pendurado', () => {
  const pendurado = reduzEnvio(
    reduzEnvio(enviando(), { tipo: 'aceitar', agoraMs: 0 }),
    { tipo: 'tempo-passou', agoraMs: PRAZO_ECO_MS },
  );
  const ecoTardio = reduzEnvio(pendurado, {
    tipo: 'item-do-stream',
    item: { id: 11, papel: 'user', texto: 'faz isso' },
  });
  assert.equal(ecoTardio.fase, 'confirmado');
});
