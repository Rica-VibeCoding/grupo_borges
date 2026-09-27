import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { defaultFrameProcessorOptions, FrameProcessor } from '@ricky0123/vad-web/dist/frame-processor.js';

import { TEMPOS } from '../../lib/conversa/tipos.ts';
import {
  opcoesDoDetector,
  seguraNoDetector,
  SILENCIO_SEGURADO_MS,
  zeraContagemDoSilencio,
} from './controlador-detector.ts';

/**
 * A regra do contador contra o `FrameProcessor` de verdade do `@ricky0123/vad-web` 0.0.31 —
 * o mesmo que o MicVAD usa no navegador —, com o modelo trocado por uma probabilidade
 * escolhida a cada quadro. Modelo v5: 512 amostras a 16 kHz, 32 ms por quadro.
 */
const MS_POR_QUADRO = 32;
const AMOSTRAS = 512;
const FIM_DEPOIS_DE_SOLTAR_MS = Math.floor(TEMPOS.silencioFimDeFala / MS_POR_QUADRO) * MS_POR_QUADRO;

type Ocorrido = { tipo: string; quadro: number; amostras?: number };

function detector() {
  let probabilidade = 0;
  let quadro = 0;
  const ocorridos: Ocorrido[] = [];
  const processador = new FrameProcessor(
    async () => ({ isSpeech: probabilidade, notSpeech: 1 - probabilidade }),
    () => {},
    { ...defaultFrameProcessorOptions, ...opcoesDoDetector('ouvindo', false), preSpeechPadMs: TEMPOS.preGravacao },
    MS_POR_QUADRO,
  );
  processador.resume();
  // O formato do MicVAD 0.0.31: o processador em `frameProcessor` e o `setOptions` repassado a ele.
  const micVad = { frameProcessor: processador, setOptions: processador.setOptions };
  const passa = async (ms: number, fala: boolean) => {
    for (let i = 0; i < Math.round(ms / MS_POR_QUADRO); i += 1) {
      probabilidade = fala ? 0.9 : 0.05;
      quadro += 1;
      await processador.process(new Float32Array(AMOSTRAS), (evento) => {
        const tipo: string = evento.msg;
        if (tipo === 'FRAME_PROCESSED') return;
        ocorridos.push({ tipo, quadro, amostras: 'audio' in evento ? evento.audio.length : undefined });
      });
    }
  };
  const fins = () => ocorridos.filter((o) => o.tipo === 'SPEECH_END');
  return { micVad, passa, fins, ocorridos, agora: () => quadro };
}

describe('contagem do silêncio: segurar a vez', () => {
  it('sem segurar, 2 s de silêncio entregam a fala — não antes', async () => {
    const d = detector();
    await d.passa(1000, true);
    const calou = d.agora();
    await d.passa(1900, false);
    assert.equal(d.fins().length, 0, '1,9 s de silêncio ainda não encerra');
    await d.passa(300, false);
    assert.equal(d.fins().length, 1);
    assert.equal((d.fins()[0].quadro - calou) * MS_POR_QUADRO, FIM_DEPOIS_DE_SOLTAR_MS);
  });

  it('segurar depois de 1,5 s de silêncio: a fala só sai 2 s depois do soltar, inteira e uma vez', async () => {
    const d = detector();
    await d.passa(500, false);
    await d.passa(1000, true);
    await d.passa(1500, false);
    seguraNoDetector(d.micVad, 'ouvindo', true);
    await d.passa(4000, false);
    assert.equal(d.fins().length, 0, 'segurando, o silêncio não encerra');
    seguraNoDetector(d.micVad, 'ouvindo', false);
    const soltou = d.agora();
    await d.passa(1900, false);
    assert.equal(d.fins().length, 0, 'o silêncio do segurar não conta depois de soltar');
    await d.passa(300, false);
    assert.equal(d.fins().length, 1, 'uma fala só');
    const [fim] = d.fins();
    assert.equal((fim.quadro - soltou) * MS_POR_QUADRO, FIM_DEPOIS_DE_SOLTAR_MS);
    // Inteira: do silêncio de antes (dentro da pré-gravação) até o último quadro de silêncio.
    assert.equal(fim.amostras, fim.quadro * AMOSTRAS);
    assert.deepEqual(d.ocorridos.map((o) => o.tipo), ['SPEECH_START', 'SPEECH_REAL_START', 'SPEECH_END']);
  });

  it('controle: soltar só com o limite de volta, sem zerar, entrega a fala no primeiro quadro', async () => {
    const d = detector();
    await d.passa(1000, true);
    await d.passa(1500, false);
    d.micVad.setOptions(opcoesDoDetector('ouvindo', true));
    await d.passa(4000, false);
    d.micVad.setOptions(opcoesDoDetector('ouvindo', false));
    const soltou = d.agora();
    await d.passa(MS_POR_QUADRO, false);
    assert.equal(d.fins().length, 1);
    assert.equal(d.fins()[0].quadro - soltou, 1, 'o defeito que o zerar evita');
  });

  it('voltar a falar segurando continua a mesma fala; soltar conta 2 s dali', async () => {
    const d = detector();
    await d.passa(1000, true);
    await d.passa(1500, false);
    seguraNoDetector(d.micVad, 'ouvindo', true);
    await d.passa(1000, false);
    await d.passa(1500, true);
    await d.passa(2500, false);
    seguraNoDetector(d.micVad, 'ouvindo', false);
    const soltou = d.agora();
    await d.passa(2300, false);
    assert.equal(d.fins().length, 1);
    assert.equal((d.fins()[0].quadro - soltou) * MS_POR_QUADRO, FIM_DEPOIS_DE_SOLTAR_MS);
  });

  it('segurar antes de começar a falar também segura o silêncio que vem depois da fala', async () => {
    const d = detector();
    seguraNoDetector(d.micVad, 'ouvindo', true);
    await d.passa(600, false);
    await d.passa(1000, true);
    await d.passa(3000, false);
    assert.equal(d.fins().length, 0);
    seguraNoDetector(d.micVad, 'ouvindo', false);
    const soltou = d.agora();
    await d.passa(2300, false);
    assert.equal(d.fins().length, 1);
    assert.equal((d.fins()[0].quadro - soltou) * MS_POR_QUADRO, FIM_DEPOIS_DE_SOLTAR_MS);
  });
});

describe('régua do detector por estado', () => {
  it('segurar só estica o silêncio na vez do Rica', () => {
    assert.deepEqual(opcoesDoDetector('ouvindo', false), { minSpeechMs: TEMPOS.falaMinima, redemptionMs: 2000 });
    assert.deepEqual(opcoesDoDetector('ouvindo', true), { minSpeechMs: TEMPOS.falaMinima, redemptionMs: SILENCIO_SEGURADO_MS });
    for (const estado of ['parado', 'transcrevendo', 'esperandoZe', 'erro'] as const) {
      assert.equal(opcoesDoDetector(estado, true).redemptionMs, TEMPOS.silencioFimDeFala, estado);
    }
  });

  it('a fala por cima (com fone) mantém a régua dela, segurando ou não', () => {
    for (const estado of ['falando', 'interrompendo'] as const) {
      const esperado = { minSpeechMs: TEMPOS.confirmaFalaPorCima, redemptionMs: TEMPOS.desclassificaFalaPorCima };
      assert.deepEqual(opcoesDoDetector(estado, false), esperado);
      assert.deepEqual(opcoesDoDetector(estado, true), esperado);
    }
  });

  it('o silêncio que entrega a fala é 2 s, e não passa disso', () => {
    assert.equal(TEMPOS.silencioFimDeFala, 2000);
  });
});

describe('acoplamento com o @ricky0123/vad-web', () => {
  const requer = createRequire(import.meta.url);

  it('a versão é a 0.0.31 — subiu, revise `zeraContagemDoSilencio` antes', () => {
    const pacote = JSON.parse(readFileSync(requer.resolve('@ricky0123/vad-web/package.json'), 'utf8')) as { version: string };
    assert.equal(pacote.version, '0.0.31');
  });

  it('o MicVAD guarda o processador em `frameProcessor` e repassa o `setOptions` a ele', () => {
    const fonte = readFileSync(requer.resolve('@ricky0123/vad-web/dist/real-time-vad.js'), 'utf8');
    assert.match(fonte, /this\.frameProcessor = frameProcessor;/);
    assert.match(fonte, /this\.setOptions = \(update\) => \{\s*this\.frameProcessor\.setOptions\(update\);/);
  });

  it('zerar sem o campo não quebra e avisa que não zerou', () => {
    assert.equal(zeraContagemDoSilencio(null), false);
    assert.equal(zeraContagemDoSilencio({}), false);
    assert.equal(zeraContagemDoSilencio({ frameProcessor: {} }), false);
    const comCampo = { frameProcessor: { redemptionCounter: 40 } };
    assert.equal(zeraContagemDoSilencio(comCampo), true);
    assert.equal(comCampo.frameProcessor.redemptionCounter, 0);
  });
});
