import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BARRAS,
  LIMITE_VELOCIDADE_SEG,
  PEAK_MAX,
  VELOCIDADES,
  alturasDasBarras,
  aparenciaDaBolha,
  barrasReais,
  destinoDeSeek,
  duracaoDeReferencia,
  emRepouso,
  faseDaRevelacao,
  indiceDoPlayhead,
  proximaVelocidade,
  seekPermitido,
  segundosRevelados,
  type EstadoRevelacao,
} from './bolha-voz.ts';

/** Resposta de 40s a 20 peaks/s, como a medição do Daniel (122 palavras →
 *  40,18s de fala). `peaks` vem acumulado por sentença; `duracaoReal` só chega
 *  no fim. */
function estado(peaks: readonly number[], duracaoReal: number | null = null): EstadoRevelacao {
  // Sem sentença nenhuma ainda: a referência cai no total estimado do `meta`.
  return {
    peaks,
    duracaoEstimada: 40,
    duracoesReais: [],
    estimativasPorSentenca: [],
    duracaoReal,
    peaksPorSegundo: 20,
  };
}

const METADE = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? PEAK_MAX : 10));
const TUDO = Array.from({ length: 800 }, (_, i) => (i % 2 === 0 ? PEAK_MAX : 10));

describe('a revelação — quanto do áudio já existe', () => {
  it('sem nenhum peak é fantasma', () => {
    assert.equal(faseDaRevelacao(estado([])), 'fantasma');
  });

  it('com peaks e sem duração real está revelando', () => {
    assert.equal(faseDaRevelacao(estado(METADE)), 'revelando');
  });

  it('a chegada da duração REAL é o que marca completa — não a contagem de peaks', () => {
    assert.equal(faseDaRevelacao(estado(TUDO, 40.18)), 'completa');
    // E mesmo com poucos peaks, se o segundo evento chegou, acabou:
    // resposta curta cuja estimativa era maior que o real.
    assert.equal(faseDaRevelacao(estado(METADE, 20)), 'completa');
  });

  it('a escala usa a estimada antes e a real depois', () => {
    assert.equal(duracaoDeReferencia(estado(METADE)), 40);
    assert.equal(duracaoDeReferencia(estado(TUDO, 40.18)), 40.18);
  });

  it('segundos revelados = peaks ÷ densidade', () => {
    assert.equal(segundosRevelados(estado(METADE)), 20);
  });
});

describe('a onda — o futuro chega, o passado não muda', () => {
  it('metade dos peaks revela metade das barras', () => {
    assert.equal(barrasReais(estado(METADE)), BARRAS / 2);
  });

  it('barras fantasma têm altura zero — a pele desenha o piso, não um valor', () => {
    const alturas = alturasDasBarras(estado(METADE));
    assert.equal(alturas.length, BARRAS);
    assert.ok(alturas[BARRAS - 1] === 0, 'última barra é fantasma');
    assert.ok(alturas[0] > 0, 'primeira barra é real');
  });

  it('a barra agrega pelo MÁXIMO do bucket — o pico é o que se lê numa onda', () => {
    // 4 peaks por barra (40s×20pps = 800 esperados; 64 barras → 12,5 peaks/barra).
    // Um bucket de baixos com um estalo alto tem a altura do estalo.
    const baixos = Array.from({ length: 12 }, () => 2);
    const alturas = alturasDasBarras(estado([...baixos, PEAK_MAX]));
    assert.equal(alturas[0], 1);
  });

  it('estimada curta demais: os peaks excedentes agregam na última barra até a real chegar', () => {
    const est = estado(TUDO);
    est.duracaoEstimada = 20; // metade do que o áudio vai medir
    const alturas = alturasDasBarras(est);
    assert.equal(barrasReais(est), BARRAS, 'tudo revela — nunca passa da largura final');
    assert.ok(alturas[BARRAS - 1] > 0);
  });

  it('a invariante: o trecho já ouvido não muda quando a duração real chega', () => {
    // A régua do Rica é "o passado não pode mudar". A estimativa por caracteres
    // erra ~3% (Canário, 11/08) e a síntese do Google nem é determinística
    // (56,8s a 59,9s no mesmo texto) — então a referência SEMPRE difere da real.
    // Com convergência, as durações reais das sentenças já chegadas mandam na
    // escala, e o `done` confirma em vez de corrigir.
    // Um estalo isolado: fixture uniforme não detectaria o deslocamento, porque
    // toda barra teria o mesmo máximo. O pico no índice 300 está dentro do
    // trecho ouvido e denuncia a barra em que caiu.
    const peaks = Array.from({ length: 800 }, (_, i) => (i === 300 ? PEAK_MAX : 0));
    const ouvidos = 320; // ~16s, onde o playhead está quando o stream fecha

    // Quatro sentenças de 10s reais. A régua por caracteres erra ~3% (Canário),
    // então cada uma é estimada em 10,3s.
    const REAL = [10, 10, 10, 10];
    const EST = [10.3, 10.3, 10.3, 10.3];
    const base = { peaks, duracaoEstimada: 41.2, peaksPorSegundo: 20 };

    // Três sentenças chegaram; a quarta está em voo.
    const convergindo: EstadoRevelacao = {
      ...base,
      duracaoReal: null,
      duracoesReais: REAL.slice(0, 3),
      estimativasPorSentenca: EST,
    };
    // Como era antes: a escala é a estimativa do texto inteiro até o `done`.
    const semConvergencia: EstadoRevelacao = {
      ...base,
      duracaoReal: null,
      duracoesReais: [],
      estimativasPorSentenca: [],
    };
    const completa: EstadoRevelacao = { ...convergindo, duracaoReal: 40, duracoesReais: REAL };

    // O que a convergência garante é estrutural: a escala já alcançou o real
    // ANTES do `done`, então o salto final é o erro da última sentença em voo
    // (0,3s) e não o erro acumulado do texto inteiro (1,2s).
    const saltoConvergindo = Math.abs(
      duracaoDeReferencia(convergindo) - duracaoDeReferencia(completa),
    );
    const saltoSemConvergencia = Math.abs(
      duracaoDeReferencia(semConvergencia) - duracaoDeReferencia(completa),
    );

    assert.ok(
      saltoConvergindo < saltoSemConvergencia,
      `convergir (${saltoConvergindo.toFixed(2)}s) tem que saltar menos que` +
        ` esperar o done (${saltoSemConvergencia.toFixed(2)}s)`,
    );
    // E o estalo em i=300, dentro do trecho ouvido, não anda mais que uma barra.
    const barraDoEstalo = (est: EstadoRevelacao) => alturasDasBarras(est).indexOf(1);
    assert.ok(
      Math.abs(barraDoEstalo(convergindo) - barraDoEstalo(completa)) <= 1,
      'o passado não anda mais que uma barra — abaixo do ruído da própria síntese',
    );
  });

  it('o playhead anda pela escala de referência', () => {
    assert.equal(indiceDoPlayhead(20, estado(METADE)), BARRAS / 2);
    assert.equal(indiceDoPlayhead(0, estado(METADE)), 0);
    assert.equal(indiceDoPlayhead(999, estado(METADE)), BARRAS - 1, 'nunca sai da onda');
  });
});

describe('o seek — limitado ao que existe', () => {
  it('dentro do revelado, permite; na zona fantasma, não', () => {
    assert.equal(seekPermitido(19.9, estado(METADE)), true);
    assert.equal(seekPermitido(20, estado(METADE)), true);
    assert.equal(seekPermitido(20.1, estado(METADE)), false, 'o futuro não se busca');
  });

  it('completo, libera até o fim da duração real', () => {
    assert.equal(seekPermitido(40, estado(TUDO, 40.18)), true);
  });

  it('o destino de um toque na onda já volta limitado ao revelado', () => {
    assert.equal(destinoDeSeek(0.25, estado(METADE)), 10);
    assert.equal(destinoDeSeek(0.9, estado(METADE)), 20, 'clamp no revelado, não na referência');
    assert.equal(destinoDeSeek(-1, estado(METADE)), 0);
  });
});

describe('a velocidade — ciclo do Telegram, sem slider', () => {
  it('1 → 1.5 → 2 → 1', () => {
    assert.equal(proximaVelocidade(1), 1.5);
    assert.equal(proximaVelocidade(1.5), 2);
    assert.equal(proximaVelocidade(2), 1);
  });

  it('velocidade desconhecida cai no começo do ciclo', () => {
    assert.equal(proximaVelocidade(3), VELOCIDADES[0]);
  });
});

describe('o rótulo de tempo — nunca se corrige', () => {
  it('durante a revelação mostra só o decorrido, sem total', () => {
    const ap = aparenciaDaBolha('revelando', 'tocando', { posicaoSeg: 12, est: estado(METADE) });
    assert.equal(ap.rotuloTempo, '0:12');
  });

  it('completo e tocando, mostra o restante — a convenção dos mensageiros', () => {
    const ap = aparenciaDaBolha('completa', 'tocando', { posicaoSeg: 12, est: estado(TUDO, 40) });
    assert.equal(ap.rotuloTempo, '-0:28');
  });

  it('completo e pausado também mostra restante — a posição continua valendo', () => {
    const ap = aparenciaDaBolha('completa', 'pausada', { posicaoSeg: 12, est: estado(TUDO, 40) });
    assert.equal(ap.rotuloTempo, '-0:28');
  });

  it('em repouso mostra a duração', () => {
    const ap = aparenciaDaBolha('completa', 'parada', { est: estado(TUDO, 40) });
    assert.equal(ap.rotuloTempo, '0:40');
  });
});

describe('a aparência — o par de fases combinado', () => {
  it('tocando mostra pausar; parada e pausada mostram tocar', () => {
    assert.equal(aparenciaDaBolha('completa', 'tocando', { est: estado(TUDO, 40) }).botao, 'pausar');
    assert.equal(aparenciaDaBolha('completa', 'parada', { est: estado(TUDO, 40) }).botao, 'tocar');
    assert.equal(aparenciaDaBolha('completa', 'pausada', { est: estado(TUDO, 40) }).botao, 'tocar');
  });

  it('a falha vira "toque para ouvir" na própria bolha — nunca um banner fora dela', () => {
    const ap = aparenciaDaBolha('completa', 'falha', { est: estado(TUDO, 40), nome: 'Daniel' });
    assert.equal(ap.botao, 'falha');
    assert.equal(ap.instrucao, 'não consegui tocar — toque para ouvir');
    assert.match(ap.anuncio, /não tocou/);
    assert.match(ap.anuncio, /Daniel/);
  });

  it('resposta curta esconde a velocidade — alvo a mais na linha por segundos de ganho', () => {
    const curta = estado(Array.from({ length: 160 }, () => 20), 8); // 8s
    assert.ok(duracaoDeReferencia(curta) < LIMITE_VELOCIDADE_SEG);
    assert.equal(aparenciaDaBolha('completa', 'parada', { est: curta }).mostraVelocidade, false);
    assert.equal(aparenciaDaBolha('completa', 'parada', { est: estado(TUDO, 40) }).mostraVelocidade, true);
  });

  it('o anúncio diz "chegando" enquanto revela — a máquina não está muda no tempo morto', () => {
    const ap = aparenciaDaBolha('revelando', 'tocando', { est: estado(METADE), nome: 'Daniel' });
    assert.match(ap.anuncio, /chegando/);
  });
});

describe('o repouso — antes de alguém pedir a fala', () => {
  const NADA = estado([]);

  it('só o repouso é repouso: um pedido em voo já saiu dele', () => {
    assert.equal(emRepouso('fantasma', 'parada'), true);
    assert.equal(emRepouso('fantasma', 'tocando'), false, 'pediu, esperando a 1ª sentença');
    assert.equal(emRepouso('completa', 'parada'), false, 'já ouviu: a onda fica na tela');
  });

  it('o botão é alto-falante e não play — em repouso não existe áudio pra tocar', () => {
    assert.equal(aparenciaDaBolha('fantasma', 'parada', { est: NADA }).botao, 'ouvir');
    assert.equal(
      aparenciaDaBolha('fantasma', 'tocando', { est: NADA }).botao,
      'pausar',
      'do toque em diante é um tocador comum',
    );
  });

  it('o anúncio oferece a leitura em vez de prometer um arquivo que não existe', () => {
    const ap = aparenciaDaBolha('fantasma', 'parada', { est: NADA, nome: 'Daniel' });
    assert.match(ap.anuncio, /ouvir a resposta de Daniel em voz alta/);
    assert.doesNotMatch(ap.anuncio, /chegando/, 'nada está chegando: ninguém pediu');
  });
});
