import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aplicaQuadro, type EscutaVoz, type MetaVoz } from './stream-voz.ts';

/** Coletor: o que o quadro SSE virou. */
function escuta() {
  const visto: string[] = [];
  const meta: MetaVoz[] = [];
  const peaks: { id: number; duracao: number; peaks: readonly number[] }[] = [];
  const erros: string[] = [];
  const alvo: EscutaVoz = {
    aoMeta: (m) => {
      visto.push('meta');
      meta.push(m);
    },
    aoPeaks: (id, duracao, p) => {
      visto.push('peaks');
      peaks.push({ id, duracao, peaks: p });
    },
    aoAudio: () => visto.push('audio'),
    aoFim: () => visto.push('done'),
    aoErro: (m) => {
      visto.push('erro');
      erros.push(m);
    },
  };
  return { alvo, visto, meta, peaks, erros };
}

describe('o quadro SSE vira chamada', () => {
  it('meta traz a escala que a onda usa antes de existir áudio', () => {
    const e = escuta();
    aplicaQuadro(
      'event: meta\ndata: {"voice":"pt-BR-Chirp3-HD-Orus","engine":"google",' +
        '"degraded":false,"duration_estimate":57.7,"peaks_per_second":20,' +
        '"segments":[{"id":0,"start":0,"duration_estimate":6.4}]}',
      e.alvo,
    );
    assert.deepEqual(e.visto, ['meta']);
    assert.equal(e.meta[0]?.duration_estimate, 57.7);
    assert.equal(e.meta[0]?.peaks_per_second, 20);
    assert.equal(e.meta[0]?.segments.length, 1);
  });

  it('peaks traz a duração REAL da sentença — é ela que faz a escala convergir', () => {
    const e = escuta();
    aplicaQuadro('event: peaks\ndata: {"id":2,"duration":6.9,"peaks":[0,31,15]}', e.alvo);
    assert.deepEqual(e.peaks[0], { id: 2, duracao: 6.9, peaks: [0, 31, 15] });
  });

  it('degradação no meio não interrompe a fala — o áudio continua chegando', () => {
    const e = escuta();
    aplicaQuadro('event: degraded\ndata: {"engine":"edge","sentenca":3}', e.alvo);
    assert.deepEqual(e.visto, [], 'evento desconhecido é ignorado, não derruba');
  });

  it('erro chega com mensagem, não em silêncio', () => {
    const e = escuta();
    aplicaQuadro('event: error\ndata: {"id":4,"message":"sentença 4 falhou"}', e.alvo);
    assert.deepEqual(e.visto, ['erro']);
    assert.match(e.erros[0] ?? '', /sentença 4/);
  });

  it('quadro com JSON partido não derruba a fala inteira', () => {
    const e = escuta();
    aplicaQuadro('event: peaks\ndata: {"id":1,"dura', e.alvo);
    assert.deepEqual(e.visto, []);
  });

  it('quadro sem data é ignorado (é o comentário de keep-alive)', () => {
    const e = escuta();
    aplicaQuadro(': ping', e.alvo);
    assert.deepEqual(e.visto, []);
  });
});
