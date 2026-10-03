/**
 * A legenda da fala do agente acompanha a voz por frase (fase 4, item 7) — PURO.
 *
 * O servidor corta a resposta em sentenças e manda um áudio por sentença (`_split_sentences` em
 * `apps/api/routers/tts.py`); a tela corta o mesmo texto pela mesma regra e troca a frase quando o
 * áudio dela começa, pelo relógio do reprodutor. O que ainda não foi falado não aparece.
 */

// Espelho de `_SENTENCE_END` e `_ABBREVIATION_END` do servidor: mudou lá, muda aqui.
const FIM_DE_FRASE = /(?<=[.!?…])\s+|(?:\r?\n){2,}/;
const ABREVIACAO = /\b(?:Dr|Dra|Sr|Sra|Srta|Prof|Profa|Ex|Exmo|Exma|etc|Fig|Cap|Art|Ref|Vol|pp|vs|Obs|av|s|p)\.$/i;

export function frasesDoTexto(texto: string): string[] {
  const pedacos = texto
    .split(FIM_DE_FRASE)
    .map((p) => p.trim())
    .filter(Boolean);
  const frases: string[] = [];
  for (let i = 0; i < pedacos.length; i += 1) {
    let frase = pedacos[i];
    // "Dr." + "Silva" é uma frase só.
    while (i + 1 < pedacos.length && ABREVIACAO.test(frase)) {
      i += 1;
      frase = `${frase} ${pedacos[i]}`;
    }
    frases.push(frase);
  }
  return frases;
}

/** Resposta "curta" da tela de voz: duas frases faladas; o texto inteiro fica no chat (Rica, 03/10). */
export function cortaParaVoz(texto: string): string {
  const frases = frasesDoTexto(texto);
  if (frases.length <= 2) return texto;
  return `${frases[0]} ${frases[1]} O resto está no chat.`;
}

/**
 * Folga (s) na troca: o começo de cada áudio vem da duração que o servidor mediu, e o relógio do
 * reprodutor soma a que o navegador mediu — um fio de diferença não pode atrasar a frase.
 */
const FOLGA_DA_TROCA_S = 0.25;

/** Qual áudio toca, dado o começo de cada um e os segundos do reprodutor (-1: nenhum ainda). */
export function audioTocando(inicios: readonly number[], segundos: number): number {
  let tocando = -1;
  for (let i = 0; i < inicios.length; i += 1) {
    if (inicios[i] <= segundos + FOLGA_DA_TROCA_S) tocando = i;
  }
  return tocando;
}

/** Um áudio da fila: o texto que foi para a voz, o número da sentença dele e a duração real (s). */
export type AudioDaFrase = { texto: string; frase: number; duracao: number };

/**
 * A fala dele na legenda: o que já foi dito neste turno (frases inteiras) e a frase do áudio que
 * toca, com a duração dele — as palavras dela entram ao longo do áudio (`inicioDasPalavras`).
 * `indice` é o do áudio: mudou, a frase recomeça.
 */
export type FalaDoZe = { dito: string[]; atual: string; indice: number; duracao: number };

function fraseDo(audio: AudioDaFrase): string | null {
  const frases = frasesDoTexto(audio.texto);
  if (frases.length === 0) return null;
  // Servidor e tela discordando no corte (markdown, bloco de código): fica na última.
  return frases[Math.min(audio.frase, frases.length - 1)];
}

export function falaDoZe(audios: readonly AudioDaFrase[], tocando: number): FalaDoZe | null {
  const audio = audios[tocando];
  if (tocando < 0 || audio === undefined) return null;
  const atual = fraseDo(audio);
  if (atual === null) return null;
  const dito: string[] = [];
  for (let i = 0; i < tocando; i += 1) {
    const frase = fraseDo(audios[i]);
    if (frase !== null && frase !== dito[dito.length - 1]) dito.push(frase);
  }
  if (dito[dito.length - 1] === atual) dito.pop();
  return { dito, atual, indice: tocando, duracao: audio.duracao };
}

export function palavrasDe(texto: string): string[] {
  return texto.split(/\s+/).filter(Boolean);
}

/** O fim de cada áudio é respiro: as palavras se distribuem nos primeiros 90% dele. */
const FRACAO_FALADA = 0.9;

/** Quando cada palavra entra (s desde o começo do áudio), pelo peso em letras: palavra longa dura mais. */
export function inicioDasPalavras(palavras: readonly string[], duracao: number): number[] {
  const pesos = palavras.map((p) => p.length + 1);
  const total = pesos.reduce((a, b) => a + b, 0);
  const inicios: number[] = [];
  let antes = 0;
  for (const peso of pesos) {
    inicios.push(total > 0 ? (antes / total) * duracao * FRACAO_FALADA : 0);
    antes += peso;
  }
  return inicios;
}

/** Quantas palavras já entraram, dados os começos e os segundos decorridos no áudio. */
export function palavrasAte(inicios: readonly number[], decorrido: number): number {
  let n = 0;
  while (n < inicios.length && inicios[n] <= decorrido) n += 1;
  return n;
}
