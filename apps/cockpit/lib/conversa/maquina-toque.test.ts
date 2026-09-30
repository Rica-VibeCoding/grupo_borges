import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avanca, inicial, turnoDescartado } from './maquina.ts';
import type { Conversa, Efeito, Evento } from './tipos.ts';

// Fase 3: o toque que para. Com o turno do Zé em voo, parar freia no servidor e o
// texto que ainda chegar do turno freado não traz a voz de volta depois do recomeço.

function roda(eventos: Evento[], de: Conversa = inicial()): { conversa: Conversa; efeitos: Efeito[] } {
  let conversa = de;
  const efeitos: Efeito[] = [];
  eventos.forEach((evento, i) => {
    const r = avanca(conversa, evento, i * 100);
    conversa = r.conversa;
    efeitos.push(...r.efeitos);
  });
  return { conversa, efeitos };
}

const tipos = (efeitos: Efeito[]) => efeitos.map((e) => e.tipo);
const audio = new Float32Array(0);
const ATE_ESPERA: Evento[] = [
  { tipo: 'comecar' },
  { tipo: 'falaTerminou', audio },
  { tipo: 'transcreveu', texto: 'oi' },
  { tipo: 'enviou' },
];
const ATE_FALANDO: Evento[] = [...ATE_ESPERA, { tipo: 'textoDoZe', texto: 'olá' }];

test('parar esperando o Zé freia o turno e marca o descarte', () => {
  const espera = roda(ATE_ESPERA).conversa;
  const { conversa, efeitos } = roda([{ tipo: 'parar' }], espera);
  assert.equal(conversa.estado, 'parado');
  // A espera ouve: parar desliga o detector antes do freio.
  assert.deepEqual(efeitos, [{ tipo: 'desligarDetector' }, { tipo: 'frearZe', antesDaResposta: true }]);
  assert.equal(turnoDescartado(conversa), true);
});

test('parar com ele falando, antes do fim do stream, freia; com fone desliga o detector antes', () => {
  const semFone = roda([{ tipo: 'parar' }], roda(ATE_FALANDO).conversa);
  assert.deepEqual(semFone.efeitos, [{ tipo: 'frearZe', antesDaResposta: false }]);

  const comFone = roda([{ tipo: 'fone', ligado: true }, ...ATE_FALANDO, { tipo: 'parar' }]);
  assert.deepEqual(tipos(comFone.efeitos).slice(-2), ['desligarDetector', 'frearZe']);
});

test('parar em interrompendo com o turno em voo também freia', () => {
  const { efeitos, conversa } = roda([
    { tipo: 'fone', ligado: true },
    ...ATE_FALANDO,
    { tipo: 'falaIniciou' },
    { tipo: 'parar' },
  ]);
  assert.equal(conversa.estado, 'parado');
  assert.deepEqual(tipos(efeitos).slice(-2), ['desligarDetector', 'frearZe']);
});

test('parar com o stream já encerrado (só a voz tocando) não freia nem descarta', () => {
  const { conversa, efeitos } = roda([...ATE_FALANDO, { tipo: 'zeTerminou' }, { tipo: 'parar' }]);
  assert.equal(conversa.estado, 'parado');
  assert.ok(!tipos(efeitos).includes('frearZe'));
  assert.equal(turnoDescartado(conversa), false);
});

test('parar ouvindo ou transcrevendo não freia: o Zé não recebeu nada', () => {
  const ouvindo = roda([{ tipo: 'comecar' }, { tipo: 'parar' }]);
  assert.deepEqual(tipos(ouvindo.efeitos), ['ligarDetector', 'desligarDetector']);
  const transcrevendo = roda([{ tipo: 'comecar' }, { tipo: 'falaTerminou', audio }, { tipo: 'parar' }]);
  assert.ok(!tipos(transcrevendo.efeitos).includes('frearZe'));
  assert.equal(turnoDescartado(transcrevendo.conversa), false);
});

test('texto do turno freado não traz a voz de volta depois do recomeço', () => {
  const parado = roda([...ATE_ESPERA, { tipo: 'parar' }]).conversa;
  const residual = roda([{ tipo: 'comecar' }, { tipo: 'textoDoZe', texto: 'resto velho' }], parado);
  assert.equal(residual.conversa.estado, 'ouvindo');
  assert.ok(!tipos(residual.efeitos).includes('falar'));

  // O fim do turno freado limpa a marca; a resposta seguinte volta a falar.
  const depois = roda([{ tipo: 'zeTerminou' }, { tipo: 'textoDoZe', texto: 'novo' }], residual.conversa);
  assert.equal(depois.conversa.estado, 'falando');
  assert.deepEqual(tipos(depois.efeitos), ['desligarDetector', 'falar']);
});

test('o fim do turno freado chegando ainda parado já limpa a marca', () => {
  const parado = roda([...ATE_FALANDO, { tipo: 'parar' }]).conversa;
  const limpo = roda([{ tipo: 'zeTerminou' }], parado).conversa;
  assert.equal(limpo.estado, 'parado');
  assert.equal(turnoDescartado(limpo), false);
});

test('turno já descartado não freia de novo — um Escape por turno', () => {
  const parado = roda([...ATE_ESPERA, { tipo: 'parar' }]).conversa;
  const esperaDeNovo = roda([...ATE_ESPERA], parado).conversa;
  assert.equal(esperaDeNovo.estado, 'esperandoZe');
  const { conversa, efeitos } = roda([{ tipo: 'parar' }], esperaDeNovo);
  assert.deepEqual(tipos(efeitos), ['desligarDetector']); // sem `frearZe`
  assert.equal(turnoDescartado(conversa), true, 'o turno velho ainda não terminou');
});

test('do erro, parar e tentar de novo não freiam', () => {
  const erro = roda([{ tipo: 'comecar' }, { tipo: 'falhou', motivo: 'capturaCaiu' }]).conversa;
  assert.deepEqual(tipos(roda([{ tipo: 'parar' }], erro).efeitos), []);
  assert.deepEqual(tipos(roda([{ tipo: 'comecar' }], erro).efeitos), ['ligarDetector']);
});

test('pergunta nova emendada no turno descartado: quando ela entra, a resposta volta a falar', () => {
  // Parou antes da resposta (sem freio), recomeçou e perguntou de novo: o Claude Code enfileira.
  const parado = roda([...ATE_ESPERA, { tipo: 'parar' }]).conversa;
  const esperando = roda(ATE_ESPERA, parado).conversa;
  assert.equal(esperando.estado, 'esperandoZe');
  assert.equal(turnoDescartado(esperando), true);
  const residual = roda([{ tipo: 'textoDoZe', texto: 'resto velho' }], esperando);
  assert.ok(!tipos(residual.efeitos).includes('falar'), 'antes da entrada, ainda é o turno velho');

  const { conversa, efeitos } = roda([{ tipo: 'pedidoEntrou' }, { tipo: 'textoDoZe', texto: 'Pronto. Dois.' }], residual.conversa);
  assert.equal(conversa.estado, 'falando');
  assert.deepEqual(tipos(efeitos), ['desligarDetector', 'falar']);
});

test('pedido que entra sem turno descartado não muda nada', () => {
  const espera = roda(ATE_ESPERA).conversa;
  const { conversa, efeitos } = roda([{ tipo: 'pedidoEntrou' }], espera);
  assert.deepEqual(conversa, espera);
  assert.deepEqual(efeitos, []);
});

// O toque durante o turno do Zé interrompe sem encerrar: freia, corta a voz e segue ouvindo.

test('interromper esperando o Zé freia, marca o descarte e volta a ouvir', () => {
  const { conversa, efeitos } = roda([{ tipo: 'interromper', rodando: true }], roda(ATE_ESPERA).conversa);
  assert.equal(conversa.estado, 'ouvindo');
  // A espera já ouvia: o detector segue ligado.
  assert.deepEqual(efeitos, [{ tipo: 'frearZe', antesDaResposta: true }]);
  assert.equal(turnoDescartado(conversa), true);
});

test('interromper com ele falando corta a voz e freia; com fone o detector já está ligado', () => {
  const semFone = roda([{ tipo: 'interromper', rodando: true }], roda(ATE_FALANDO).conversa);
  assert.equal(semFone.conversa.estado, 'ouvindo');
  assert.deepEqual(tipos(semFone.efeitos), ['descartarVoz', 'frearZe', 'ligarDetector']);

  const comFone = roda([{ tipo: 'fone', ligado: true }, ...ATE_FALANDO, { tipo: 'interromper', rodando: true }]);
  assert.equal(comFone.conversa.estado, 'ouvindo');
  assert.deepEqual(tipos(comFone.efeitos).slice(-2), ['descartarVoz', 'frearZe']);
});

test('interromper em interrompendo corta a voz pausada e freia', () => {
  const { conversa, efeitos } = roda([
    { tipo: 'fone', ligado: true },
    ...ATE_FALANDO,
    { tipo: 'falaIniciou' },
    { tipo: 'interromper', rodando: true },
  ]);
  assert.equal(conversa.estado, 'ouvindo');
  assert.deepEqual(tipos(efeitos).slice(-2), ['descartarVoz', 'frearZe']);
});

test('interromper com o stream já encerrado só corta a voz: não freia nem descarta', () => {
  const { conversa, efeitos } = roda([...ATE_FALANDO, { tipo: 'zeTerminou' }, { tipo: 'interromper', rodando: false }]);
  assert.equal(conversa.estado, 'ouvindo');
  assert.deepEqual(tipos(efeitos).slice(-2), ['descartarVoz', 'ligarDetector']);
  assert.equal(turnoDescartado(conversa), false);
});

test('interromper ouvindo com o Zé rodando freia sem mexer no detector nem na captura', () => {
  const ouvindo = roda([{ tipo: 'comecar' }, { tipo: 'falaIniciou' }]).conversa;
  const { conversa, efeitos } = roda([{ tipo: 'interromper', rodando: true }], ouvindo);
  assert.equal(conversa.estado, 'ouvindo');
  assert.deepEqual(efeitos, [{ tipo: 'frearZe', antesDaResposta: false }]);
  assert.equal(turnoDescartado(conversa), true);
  // A fala em curso segue para o envio, como correção.
  const envio = roda([{ tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: 'na verdade' }], conversa);
  assert.ok(envio.efeitos.some((e) => e.tipo === 'enviar' && e.texto === 'na verdade'));
});

test('interromper com a resposta guardada durante a gravação corta a voz guardada', () => {
  let c = roda([{ tipo: 'comecar' }, { tipo: 'falaIniciou' }, { tipo: 'textoDoZe', texto: 'Guardada.' }]).conversa;
  const r = roda([{ tipo: 'interromper', rodando: true }], c);
  assert.deepEqual(tipos(r.efeitos), ['descartarVoz', 'frearZe']);
  c = roda([{ tipo: 'falaTerminou', audio }, { tipo: 'transcreveu', texto: 'outra coisa' }, { tipo: 'enviou' }], r.conversa).conversa;
  assert.equal(c.estado, 'esperandoZe', 'nada guardado para retomar: espera a resposta da correção');
});

test('transcrevendo, interromper freia e a fala que estava saindo ainda é enviada', () => {
  const transcrevendo = roda([{ tipo: 'comecar' }, { tipo: 'falaTerminou', audio }]).conversa;
  const { conversa, efeitos } = roda([{ tipo: 'interromper', rodando: true }], transcrevendo);
  assert.equal(conversa.estado, 'transcrevendo');
  assert.deepEqual(tipos(efeitos), ['frearZe']);
  const r = roda([{ tipo: 'transcreveu', texto: 'corrigindo' }], conversa);
  assert.ok(r.efeitos.some((e) => e.tipo === 'enviar'));
});

test('a marca do interromper atravessa a correção — residual e fim velho não atropelam a resposta nova', () => {
  const { conversa, efeitos } = roda([
    ...ATE_FALANDO,
    { tipo: 'interromper', rodando: true },
    { tipo: 'textoDoZe', texto: 'residual' },
    { tipo: 'falaTerminou', audio },
    { tipo: 'transcreveu', texto: 'correção' },
    { tipo: 'enviou' },
    { tipo: 'zeTerminou' }, // o fim do turno freado: só limpa a marca
  ]);
  assert.equal(conversa.estado, 'esperandoZe');
  assert.equal(efeitos.filter((e) => e.tipo === 'falar').length, 1, 'só o olá');
  const nova = roda([{ tipo: 'textoDoZe', texto: 'resposta nova' }], conversa);
  assert.equal(nova.conversa.estado, 'falando');
});

test('turno já descartado não freia de novo no segundo toque; parado e erro não interrompem', () => {
  const interrompido = roda([...ATE_ESPERA, { tipo: 'interromper', rodando: true }]).conversa;
  assert.deepEqual(tipos(roda([{ tipo: 'interromper', rodando: true }], interrompido).efeitos), []);
  assert.deepEqual(roda([{ tipo: 'interromper', rodando: true }]).efeitos, []);
  const erro = roda([{ tipo: 'comecar' }, { tipo: 'falhou', motivo: 'capturaCaiu' }]).conversa;
  assert.deepEqual(roda([{ tipo: 'interromper', rodando: true }], erro).efeitos, []);
});
