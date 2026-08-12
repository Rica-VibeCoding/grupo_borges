/**
 * UM elemento de áudio pra aba inteira — e a razão é o iPhone.
 *
 * O Safari libera áudio por "ativação pegajosa": o primeiro `play()` precisa
 * acontecer SÍNCRONO dentro do manipulador do toque. Depois disso, o MESMO
 * elemento pode trocar de fonte e tocar sozinho quantas vezes quiser. Criar um
 * `new Audio()` por resposta perde o destrave e o play volta a ser rejeitado —
 * por isso este módulo guarda um elemento só, em escopo de módulo, e todas as
 * bolhas do feed passam por ele. Como efeito colateral desejado, duas respostas
 * nunca falam por cima uma da outra: começar a segunda para a primeira.
 *
 * O silêncio de destrave existe porque no instante do toque a primeira sentença
 * ainda não chegou do servidor (~1,6s). Tocar um WAV vazio na hora do gesto
 * consome a ativação; quando o áudio real chega, é só trocar a fonte.
 */

/** WAV válido de zero samples: carrega na hora e não faz som. */
const SILENCIO =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

let elemento: HTMLAudioElement | null = null;
/** Quem está tocando agora — usado pra parar a bolha anterior sem tocar nela. */
let donoAtual: symbol | null = null;
let pararAtual: (() => void) | null = null;

function elementoUnico(): HTMLAudioElement {
  if (elemento === null) {
    elemento = new Audio();
    elemento.preload = 'auto';
  }
  return elemento;
}

/** Chamar SÍNCRONO no manipulador do toque, antes de qualquer `await`. */
export function destravaNoGesto(): void {
  const audio = elementoUnico();
  audio.src = SILENCIO;
  // A promessa pode rejeitar em navegador sem gesto válido; o play real
  // depois disso é que decide a fase `falha` da bolha.
  void audio.play().catch(() => {});
}

export type Sequencia = {
  /** Enfileira a próxima sentença. Se nada estiver tocando, começa. */
  enfileira(url: string): void;
  /** Marca que não vêm mais sentenças — o fim da última encerra a fala. */
  fecha(): void;
  para(): void;
};

export type EscutaSequencia = {
  /** Segundos desde o começo da fala inteira, somando as sentenças passadas. */
  aoProgredir(segundos: number): void;
  aoTerminar(): void;
  /** `play()` recusado pelo navegador — a bolha vira "toque para ouvir". */
  aoFalhar(): void;
};

/**
 * Toca sentenças em sequência no elemento único. A síntese corre ~5× à frente
 * da fala, então quando uma sentença acaba a próxima já chegou; se não chegou,
 * a fala espera nela em vez de pular.
 */
export function iniciaSequencia(escuta: EscutaSequencia): Sequencia {
  const dono = Symbol('bolha');
  const audio = elementoUnico();

  // Começar uma fala para a anterior: um alto-falante, uma voz.
  if (pararAtual !== null) pararAtual();
  donoAtual = dono;

  const fila: string[] = [];
  let indice = 0;
  let decorridoAntes = 0;
  let fechada = false;
  let vivo = true;
  let tocando = false;

  const meu = () => vivo && donoAtual === dono;

  const aoTempo = () => {
    if (!meu()) return;
    escuta.aoProgredir(decorridoAntes + audio.currentTime);
  };

  const aoFim = () => {
    if (!meu()) return;
    decorridoAntes += Number.isFinite(audio.duration) ? audio.duration : 0;
    indice += 1;
    tocando = false;
    if (indice < fila.length) {
      void toca();
      return;
    }
    if (fechada) {
      limpa();
      escuta.aoTerminar();
    }
  };

  function limpa() {
    vivo = false;
    audio.removeEventListener('timeupdate', aoTempo);
    audio.removeEventListener('ended', aoFim);
    if (donoAtual === dono) {
      donoAtual = null;
      pararAtual = null;
    }
  }

  async function toca() {
    if (!meu() || tocando) return;
    const url = fila[indice];
    if (url === undefined) return;
    tocando = true;
    audio.src = url;
    try {
      await audio.play();
    } catch {
      if (!meu()) return;
      tocando = false;
      limpa();
      escuta.aoFalhar();
    }
  }

  audio.addEventListener('timeupdate', aoTempo);
  audio.addEventListener('ended', aoFim);

  pararAtual = () => {
    if (!vivo) return;
    audio.pause();
    limpa();
  };

  return {
    enfileira(url: string) {
      if (!meu()) return;
      fila.push(url);
      if (!tocando && indice === fila.length - 1) void toca();
    },
    fecha() {
      fechada = true;
      // A última sentença já acabou enquanto o stream fechava.
      if (meu() && !tocando && indice >= fila.length) {
        limpa();
        escuta.aoTerminar();
      }
    },
    para() {
      if (pararAtual !== null) pararAtual();
    },
  };
}

/** Pausa/retoma sem perder a posição — o botão da bolha que está tocando. */
export function pausa(): void {
  elemento?.pause();
}

export function retoma(): Promise<void> {
  const audio = elemento;
  if (audio === null) return Promise.resolve();
  return audio.play().catch(() => {});
}

export function estaTocando(): boolean {
  return elemento !== null && !elemento.paused && !elemento.ended;
}
