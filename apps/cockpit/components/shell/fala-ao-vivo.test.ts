import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TAXA_AO_VIVO,
  criaReamostrador,
  interpretaEvento,
  paraBase64,
} from './fala-ao-vivo.ts';

describe('interpretaEvento', () => {
  it('delta vira texto parcial', () => {
    const evento = JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: ' Rica',
    });
    assert.deepEqual(interpretaEvento(evento), { tipo: 'parcial', texto: ' Rica' });
  });

  it('completed vira texto final', () => {
    const evento = JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Oi, Rica.',
    });
    assert.deepEqual(interpretaEvento(evento), { tipo: 'final', texto: 'Oi, Rica.' });
  });

  it('erro do fornecedor chega com o motivo dele, não com um genérico nosso', () => {
    const evento = JSON.stringify({ type: 'error', error: { message: 'cota estourada' } });
    assert.deepEqual(interpretaEvento(evento), { tipo: 'erro', motivo: 'cota estourada' });
  });

  it('o resto do protocolo é ruído', () => {
    for (const tipo of [
      'session.created',
      'conversation.item.added',
      'input_audio_buffer.committed',
    ]) {
      assert.deepEqual(interpretaEvento(JSON.stringify({ type: tipo })), { tipo: 'ignorar' });
    }
  });

  it('lixo na linha não derruba o canal', () => {
    // Fronteira de sistema: o que vem do fornecedor pode ser qualquer coisa, e
    // uma exceção aqui mataria a gravação inteira por causa de um quadro solto.
    for (const bruto of ['', '{', 'null', '"texto solto"', '[]']) {
      assert.deepEqual(interpretaEvento(bruto), { tipo: 'ignorar' });
    }
  });
});

describe('criaReamostrador', () => {
  it('48 kHz vira metade das amostras', () => {
    const reamostra = criaReamostrador(48_000);
    const bloco = new Float32Array(2048);
    assert.equal(reamostra(bloco).length, 1024);
  });

  it('a rampa atravessa a emenda dos blocos sem degrau', () => {
    // A prova de que o cursor e o `anterior` são guardados: uma rampa contínua
    // cortada em blocos tem de sair contínua. Reamostrar cada bloco do zero
    // repetiria a primeira amostra e deixaria um degrau exatamente aqui.
    const reamostra = criaReamostrador(48_000);
    const saida: number[] = [];
    let valor = 0;
    for (let b = 0; b < 4; b++) {
      const bloco = new Float32Array(8);
      for (let i = 0; i < 8; i++) bloco[i] = (valor++ / 32767) * 1;
      saida.push(...Array.from(reamostra(bloco)));
    }
    for (let i = 1; i < saida.length; i++) {
      assert.equal(saida[i] - saida[i - 1], 2, `passo errado na posição ${i}`);
    }
  });

  it('44,1 kHz não escorrega ao longo do tempo', () => {
    // A razão 1,8375 não é inteira. Sem guardar a fração, cada bloco perderia
    // um pedaço de amostra e em minutos o áudio chegaria adiantado.
    const reamostra = criaReamostrador(44_100);
    const BLOCOS = 200;
    const POR_BLOCO = 2048;
    let total = 0;
    for (let b = 0; b < BLOCOS; b++) total += reamostra(new Float32Array(POR_BLOCO)).length;
    const esperado = (BLOCOS * POR_BLOCO * TAXA_AO_VIVO) / 44_100;
    // Uma amostra de folga por bloco seria 200; exigimos menos de 2 no total.
    assert.ok(Math.abs(total - esperado) < 2, `saiu ${total}, esperado ~${Math.round(esperado)}`);
  });

  it('pico acima de 1 satura em vez de dar a volta', () => {
    // Sem o clamp, 1.5 * 32767 estoura o Int16 e vira número NEGATIVO — um
    // estalo que o STT ouve como consoante.
    const reamostra = criaReamostrador(TAXA_AO_VIVO);
    const bloco = new Float32Array([2, 2, 2, 2, -2, -2, -2, -2]);
    const pcm = reamostra(bloco);
    for (const amostra of pcm) {
      assert.ok(amostra === 32767 || amostra === -32767, `saiu ${amostra}`);
    }
  });

  it('bloco vazio não quebra nem move o cursor', () => {
    const reamostra = criaReamostrador(48_000);
    assert.equal(reamostra(new Float32Array(0)).length, 0);
    assert.equal(reamostra(new Float32Array(8)).length, 4);
  });
});

describe('paraBase64', () => {
  it('vai e volta', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    const bytes = Uint8Array.from(atob(paraBase64(pcm)), (c) => c.charCodeAt(0));
    assert.deepEqual(new Int16Array(bytes.buffer), pcm);
  });

  it('bloco grande não estoura a pilha', () => {
    // `String.fromCharCode(...bytes)` com dezenas de milhares de argumentos
    // derruba o V8. A gravação longa é exatamente onde isso apareceria.
    const pcm = new Int16Array(200_000);
    assert.ok(paraBase64(pcm).length > 0);
  });
});
