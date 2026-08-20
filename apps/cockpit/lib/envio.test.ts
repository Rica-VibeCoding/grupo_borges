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

test('prazo de eco cobre agente ocupado sem congelar o composer', () => {
  assert.equal(PRAZO_ECO_MS, 12_000);
});

test('200 deixa o envio aceito, ainda sem cantar sucesso', () => {
  const estado = reduzEnvio(enviando(), { tipo: 'aceitar', agoraMs: 1_000 });
  assert.equal(estado.fase, 'aceito');
});

test('rejeição explícita do POST é falha real', () => {
  const erro = new Error('agent_pane_unavailable');
  const estado = reduzEnvio(enviando(), {
    tipo: 'falhar',
    erro,
  });
  assert.deepEqual(estado, {
    fase: 'falhou',
    texto: 'faz isso',
    fronteira: { id: 10, origem: 'barreira-do-servidor' },
    ecosIguaisSemDono: 0,
    erro,
  });
});

test('perda de resposta do POST fica não confirmada, pois pode ter entregado', () => {
  const erro = new Error('rede caiu depois da entrega');
  const estado = reduzEnvio(enviando(), {
    tipo: 'nao-confirmar',
    erro,
  });
  assert.equal(estado.fase, 'nao-confirmado');
  if (estado.fase === 'nao-confirmado') assert.strictEqual(estado.erro, erro);
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

test('novo envio idêntico após não confirmado não rouba eventual eco do primeiro', () => {
  const primeiroNaoConfirmado = reduzEnvio(
    reduzEnvio(enviando('ok', 40), { tipo: 'aceitar', agoraMs: 0 }),
    { tipo: 'tempo-passou', agoraMs: PRAZO_ECO_MS },
  );
  const retry = reduzEnvio(primeiroNaoConfirmado, {
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
  const primeiroNaoConfirmado = reduzEnvio(
    reduzEnvio(enviando('ok', 40), { tipo: 'aceitar', agoraMs: 0 }),
    { tipo: 'tempo-passou', agoraMs: PRAZO_ECO_MS },
  );
  const retry = reduzEnvio(primeiroNaoConfirmado, {
    tipo: 'enviar',
    texto: 'ok',
    fronteira: { id: 40, origem: 'barreira-do-servidor' },
  });
  const retryNaoConfirmado = reduzEnvio(retry, {
    tipo: 'nao-confirmar',
    erro: new Error('rede'),
  });
  assert.equal(retryNaoConfirmado.fase, 'nao-confirmado');
  const textoNovo = reduzEnvio(retryNaoConfirmado, {
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

test('prazo conta a partir do aceite e vira não confirmado no limite', () => {
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
  assert.equal(noLimite.fase, 'nao-confirmado');
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

test('eco tardio recupera um envio não confirmado', () => {
  const naoConfirmado = reduzEnvio(
    reduzEnvio(enviando(), { tipo: 'aceitar', agoraMs: 0 }),
    { tipo: 'tempo-passou', agoraMs: PRAZO_ECO_MS },
  );
  const ecoTardio = reduzEnvio(naoConfirmado, {
    tipo: 'item-do-stream',
    item: { id: 11, papel: 'user', texto: 'faz isso' },
  });
  assert.equal(ecoTardio.fase, 'confirmado');
});

/**
 * A FILA DO SERVIDOR (202), que é o caminho do Codex. Diferente do
 * `kind: "queued"` do Claude Code, aqui o recibo chega no PRÓPRIO POST — não há
 * item de stream a esperar, porque o texto está no banco do servidor e não
 * colado num pane.
 */
test('202 confirma na hora, marcado como fila e sem eco ainda', () => {
  const estado = reduzEnvio(enviando(), { tipo: 'enfileirar' });
  assert.equal(estado.fase, 'confirmado');
  assert.equal(estado.fase === 'confirmado' && estado.fila, true);
  assert.equal(
    estado.fase === 'confirmado' && estado.ecoId,
    null,
    'não há eco a apontar: o texto está no banco, não no pane',
  );
});

/**
 * O ponto que separa consertar de esconder. Se o 202 caísse em `aceito`, o
 * prazo de 12s o levaria a `nao-confirmado` — vermelho na tela por uma entrega
 * garantida, que é o defeito que a fila existe para matar.
 */
test('o 202 não fica preso ao prazo do eco', () => {
  const enfileirado = reduzEnvio(enviando(), { tipo: 'enfileirar' });
  const muitoDepois = reduzEnvio(enfileirado, {
    tipo: 'tempo-passou',
    agoraMs: PRAZO_ECO_MS * 100,
  });
  assert.equal(muitoDepois.fase, 'confirmado', 'entrega garantida não expira');
});

/** Quando a fila drena, o eco chega e só APAGA a marca — não reconfirma. Uma
 *  entrega, uma notificação. */
test('o eco da drenagem apaga a marca de fila e preenche o ecoId', () => {
  const enfileirado = reduzEnvio(enviando('faz isso', 10), { tipo: 'enfileirar' });
  const drenado = reduzEnvio(enfileirado, {
    tipo: 'item-do-stream',
    item: { id: 42, texto: 'faz isso', papel: 'user' },
  });
  assert.equal(drenado.fase, 'confirmado');
  assert.equal(drenado.fase === 'confirmado' && drenado.fila, undefined, 'a marca sai');
  assert.equal(drenado.fase === 'confirmado' && drenado.ecoId, 42);
});

test('eco de outro texto não apaga a marca de fila', () => {
  const enfileirado = reduzEnvio(enviando('faz isso', 10), { tipo: 'enfileirar' });
  const outro = reduzEnvio(enfileirado, {
    tipo: 'item-do-stream',
    item: { id: 42, texto: 'faz outra coisa', papel: 'user' },
  });
  assert.equal(outro.fase === 'confirmado' && outro.fila, true, 'a promessa continua de pé');
});

/** A guarda de fase: `enfileirar` fora de `enviando` é evento fora de hora, e
 *  aplicá-lo reescreveria um estado que já concluiu. */
test('enfileirar só vale saindo de enviando', () => {
  const aceito = reduzEnvio(enviando(), { tipo: 'aceitar', agoraMs: 1_000 });
  assert.equal(reduzEnvio(aceito, { tipo: 'enfileirar' }), aceito);
  assert.equal(reduzEnvio(estadoInicialEnvio, { tipo: 'enfileirar' }), estadoInicialEnvio);
});

/** Sem fronteira não há como reconhecer o eco da drenagem depois — e confirmar
 *  sem esse fio deixaria a marca `fila` presa para sempre. */
test('enfileirar sem fronteira nenhuma não confirma', () => {
  const semFronteira = reduzEnvio(estadoInicialEnvio, { tipo: 'enviar', texto: 'faz isso' });
  assert.equal(reduzEnvio(semFronteira, { tipo: 'enfileirar' }), semFronteira);
});
