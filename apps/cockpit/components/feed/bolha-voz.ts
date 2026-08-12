/**
 * A bolha que fala — o modelo puro. Sem React, sem DOM, sem rede.
 *
 * POR QUE DUAS MÁQUINAS ORTOGONAIS E NÃO UMA. A bolha responde a duas perguntas
 * independentes: QUANTO DO ÁUDIO JÁ EXISTE (revelação — a síntese por sentença
 * do Canário entrega peaks progressivamente, e a duração real só chega no fim)
 * e O QUE O PLAYHEAD ESTÁ FAZENDO (reprodução — parada, tocando, pausada,
 * falha). Cruzar as duas num enum único produziria doze estados com nome
 * composto; separadas, cada pergunta tem três ou quatro respostas e a pele só
 * combina.
 *
 * A RÉGUA QUE VIROU CONTRATO (§7 de docs/voz-de-volta/pesquisa-hiro-ui.md,
 * aprovada pelo Rica): **o futuro pode chegar; o passado não pode mudar.** As
 * barras atrás do playhead — o que o Rica já ouviu — nasceram reais e nunca
 * mudam de forma; o que se revela está sempre à frente do que ele ouve. Por
 * isso a largura da bolha nasce final (duração ESTIMADA pelo texto) e cada
 * sentença que chega substitui fantasmas no lugar que já era deles. E por isso
 * o seek é limitado ao já revelado: tocar no futuro não busca nada.
 *
 * O NÚMERO NÃO SE CORRIGE. Enquanto a duração real não existe, o tempo mostra
 * só o decorrido — um total estimado exibido e depois trocado lê como erro.
 * Quando a duração real chega, o rótulo vira o restante da convenção dos
 * mensageiros (duração em repouso, restante ao tocar). É informação que se
 * completa, não que se corrige.
 */

// ---------------------------------------------------------------------------
// Constantes — a régua visual compartilhada com a pele e com o back.
// ---------------------------------------------------------------------------

/** Barras fixas da onda. A largura da bolha nasce final: o que muda com a
 *  revelação é QUANTAS barras têm valor real, nunca quantas existem. */
export const BARRAS = 64;

/** Pico máximo: 5 bits, 0–31 — o padrão do Telegram, que o back adota. */
export const PEAK_MAX = 31;

/** Piso e teto em px, mesma régua da `Onda` do composer (captura-voz.tsx):
 *  barra de altura zero some e a onda vira um buraco; o piso mantém a linha de
 *  base legível no silêncio entre frases. */
export const PISO_BARRA_PX = 3;
export const TETO_BARRA_PX = 28;

/** Abaixo disto o botão de velocidade some: acelerar uma resposta de 8s ganha
 *  segundos e custa um alvo de toque na linha. */
export const LIMITE_VELOCIDADE_SEG = 15;

/** O ciclo do botão, na ordem do Telegram. Sem slider — resposta de trabalho
 *  não é podcast. */
export const VELOCIDADES = [1, 1.5, 2] as const;

// ---------------------------------------------------------------------------
// As duas máquinas.
// ---------------------------------------------------------------------------

/** Quanto do áudio já existe no cliente. `fantasma` = nada revelado; a fase
 *  vira `completa` quando a duração REAL chega — o sinal de que o último peak
 *  chegou junto. */
export type FaseRevelacao = 'fantasma' | 'revelando' | 'completa';

/** O que o playhead está fazendo. `falha` é o play() rejeitado pelo navegador
 *  (iOS sem destrave, contexto suspenso): a bolha vira "toque para ouvir" e o
 *  próximo gesto re-tenta — nunca um banner fora dela. */
export type FaseReproducao = 'parada' | 'tocando' | 'pausada' | 'falha';

export type EstadoRevelacao = {
  /** Peaks acumulados (0–31), na ordem em que as sentenças chegaram. */
  peaks: readonly number[];
  /** Segundos, estimada pelo servidor a partir do texto inteiro
   *  (`meta.duration_estimate`). É o ponto de partida da escala e o fallback
   *  quando ainda não há sentença nenhuma. */
  duracaoEstimada: number;
  /** Durações REAIS das sentenças já chegadas, na ordem (`peaks.duration`). */
  duracoesReais: readonly number[];
  /** Estimativa de CADA sentença, na ordem (`meta.segments[].duration_estimate`). */
  estimativasPorSentenca: readonly number[];
  /** Segundos reais do total; chega no `done`. Com convergência ele confirma
   *  o que a escala já alcançou, em vez de corrigi-la. */
  duracaoReal: number | null;
  /** Densidade dos peaks, constante por geração (o back define, ex.: 20). */
  peaksPorSegundo: number;
};

export function faseDaRevelacao(est: EstadoRevelacao): FaseRevelacao {
  if (est.duracaoReal !== null) return 'completa';
  return est.peaks.length === 0 ? 'fantasma' : 'revelando';
}

/** A duração que governa a escala: real acumulada mais a estimativa do que
 *  ainda falta. CONVERGE em vez de saltar — quando a última sentença chega, a
 *  escala já é a real, e o `done` confirma. O salto único (estimada até o fim,
 *  real de uma vez) movia 245 das 320 barras já ouvidas, medido; com
 *  convergência o resíduo cai pra 1 barra, abaixo do próprio não-determinismo
 *  da síntese do Google (56,8s a 59,9s no mesmo texto). */
export function duracaoDeReferencia(est: EstadoRevelacao): number {
  if (est.duracaoReal !== null) return est.duracaoReal;
  const real = est.duracoesReais.reduce((a, b) => a + b, 0);
  const falta = est.estimativasPorSentenca
    .slice(est.duracoesReais.length)
    .reduce((a, b) => a + b, 0);
  const convergida = real + falta;
  return convergida > 0 ? convergida : est.duracaoEstimada;
}

/** Segundos de áudio que já existem no cliente. Também é o limite do seek. */
export function segundosRevelados(est: EstadoRevelacao): number {
  return est.peaks.length / est.peaksPorSegundo;
}

// ---------------------------------------------------------------------------
// A onda.
// ---------------------------------------------------------------------------

/** Quantas das BARRAS já têm valor real. O resto é fantasma: altura de piso,
 *  cor apagada — "ainda não existe", não "vale zero". */
export function barrasReais(est: EstadoRevelacao): number {
  const totalEsperado = duracaoDeReferencia(est) * est.peaksPorSegundo;
  if (totalEsperado <= 0) return 0;
  return Math.min(BARRAS, Math.floor((est.peaks.length / totalEsperado) * BARRAS));
}

/** Alturas das BARRAS, de 0 a 1. Barra real agrega seus peaks pelo MÁXIMO do
 *  bucket (o pico é o que se lê numa onda, não a média); fantasma é 0 — a pele
 *  desenha o piso. Peaks além da duração de referência agregam na última barra
 *  — com a referência convergindo, isso é o resíduo de uma sentença em voo, não
 *  um acúmulo que depois se redistribui. */
export function alturasDasBarras(est: EstadoRevelacao): number[] {
  const alturas = new Array<number>(BARRAS).fill(0);
  const totalEsperado = duracaoDeReferencia(est) * est.peaksPorSegundo;
  if (totalEsperado <= 0 || est.peaks.length === 0) return alturas;

  est.peaks.forEach((peak, i) => {
    const barra = Math.min(BARRAS - 1, Math.floor((i / totalEsperado) * BARRAS));
    alturas[barra] = Math.max(alturas[barra], peak / PEAK_MAX);
  });
  return alturas;
}

/** A barra em que o playhead está. Tudo antes dela é passado — e o passado não
 *  muda: a pele pinta de ouvido só o que nasceu real. */
export function indiceDoPlayhead(posicaoSeg: number, est: EstadoRevelacao): number {
  const referencia = duracaoDeReferencia(est);
  if (referencia <= 0) return 0;
  return Math.min(BARRAS - 1, Math.max(0, Math.floor((posicaoSeg / referencia) * BARRAS)));
}

// ---------------------------------------------------------------------------
// Seek — limitado ao que existe.
// ---------------------------------------------------------------------------

/** Tocar na zona fantasma não busca nada: o áudio de lá ainda não existe. */
export function seekPermitido(posicaoSeg: number, est: EstadoRevelacao): boolean {
  return posicaoSeg >= 0 && posicaoSeg <= segundosRevelados(est);
}

/** O destino de um toque na onda, já limitado ao revelado. */
export function destinoDeSeek(fracao: number, est: EstadoRevelacao): number {
  const bruto = Math.max(0, Math.min(1, fracao)) * duracaoDeReferencia(est);
  return Math.min(bruto, segundosRevelados(est));
}

// ---------------------------------------------------------------------------
// Velocidade.
// ---------------------------------------------------------------------------

export function proximaVelocidade(atual: number): number {
  const i = VELOCIDADES.indexOf(atual as (typeof VELOCIDADES)[number]);
  return VELOCIDADES[(i + 1) % VELOCIDADES.length];
}

// ---------------------------------------------------------------------------
// Aparência — o que a pele mostra, dado o par de fases.
// ---------------------------------------------------------------------------

/** `0:12` — reutilizada de components/shell/voz.ts: a duração falada é a mesma
 *  na captura e na volta. */
import { duracaoLegivel } from '../shell/voz.ts';

export type AparenciaBolha = {
  /** O que o botão redondo mostra e faz. `falha` é o "toque para ouvir". */
  botao: 'tocar' | 'pausar' | 'falha';
  /** O número da linha: decorrido durante a revelação, restante quando a
   *  duração real existe e algo toca, duração em repouso. Nunca se corrige. */
  rotuloTempo: string;
  /** Frase visível só na falha — nunca só o diagnóstico, sempre a saída. */
  instrucao: string;
  /** O botão "1×" só existe se a resposta é longa o bastante pra ganhar algo. */
  mostraVelocidade: boolean;
  anuncio: string;
};

export function aparenciaDaBolha(
  faseRev: FaseRevelacao,
  faseRep: FaseReproducao,
  ctx: { posicaoSeg?: number; est: EstadoRevelacao; nome?: string },
): AparenciaBolha {
  const posicao = ctx.posicaoSeg ?? 0;
  const referencia = duracaoDeReferencia(ctx.est);
  const nome = ctx.nome ?? 'o agente';

  let rotuloTempo: string;
  if (faseRev !== 'completa') {
    rotuloTempo = duracaoLegivel(posicao);
  } else if (faseRep === 'tocando' || faseRep === 'pausada') {
    rotuloTempo = `-${duracaoLegivel(Math.max(0, referencia - posicao))}`;
  } else {
    rotuloTempo = duracaoLegivel(referencia);
  }

  const botao =
    faseRep === 'falha' ? 'falha' : faseRep === 'tocando' ? 'pausar' : 'tocar';

  const instrucao = faseRep === 'falha' ? 'não consegui tocar — toque para ouvir' : '';

  const anuncio =
    faseRep === 'falha'
      ? `a resposta em áudio de ${nome} não tocou. Toque para ouvir.`
      : faseRev === 'completa'
        ? `resposta em áudio de ${nome}, ${duracaoLegivel(referencia)}`
        : `resposta em áudio de ${nome} chegando`;

  return {
    botao,
    rotuloTempo,
    instrucao,
    mostraVelocidade: referencia >= LIMITE_VELOCIDADE_SEG,
    anuncio,
  };
}
