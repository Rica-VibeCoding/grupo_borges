/**
 * CONTRATO DO MODO CONVERSA — o que a trilha lógica (`lib/conversa/`) e a
 * trilha tela (`app/conversa/`, `components/conversa/`) combinam entre si.
 *
 * Plano guia: `docs/cockpit-v2-modo-conversa-PLANO.md`. Mudar este arquivo é
 * mudar o combinado das duas cadeiras: passa pela coordenação.
 *
 * A máquina é MEIO-DUPLEX: enquanto o Zé fala, o detector fica surdo. O Chrome
 * não cancela o eco do áudio que a própria página toca (pesquisa §3), então
 * ouvir durante a voz faria o Zé se interromper sozinho.
 */

export type Estado =
  | 'parado'
  | 'ouvindo'
  | 'transcrevendo'
  | 'esperandoZe'
  | 'falando'
  | 'erro';

export type MotivoDeErro =
  | 'microfoneNegado'
  | 'capturaCaiu' // tela bloqueada ou aba em segundo plano mataram o microfone
  | 'transcricaoFalhou'
  | 'transcricaoVazia'
  | 'envioFalhou'
  | 'agenteOcupado'; // o Zé já estava num turno quando a fala chegou

export type Evento =
  | { tipo: 'comecar' } // o toque que destrava áudio, microfone e Wake Lock
  | { tipo: 'parar' }
  | { tipo: 'falaIniciou' }
  | { tipo: 'falaDescartada' } // curta demais: o Silero chama de misfire
  | { tipo: 'falaTerminou'; audio: Float32Array } // 16 kHz, mono, -1..1
  | { tipo: 'transcreveu'; texto: string }
  | { tipo: 'enviou' }
  | { tipo: 'textoDoZe'; texto: string } // cada texto novo do assistente
  | { tipo: 'zeTerminou' } // `isRunning` do stream caiu
  | { tipo: 'vozTerminou' } // a fila do reprodutor esvaziou
  | { tipo: 'capturaCaiu' }
  | { tipo: 'falhou'; motivo: MotivoDeErro; detalhe?: string };

/** O que a tela tem de fazer. A lógica decide; quem toca, grava e envia é a tela. */
export type Efeito =
  | { tipo: 'ligarDetector' }
  | { tipo: 'desligarDetector' }
  | { tipo: 'transcrever'; audio: Float32Array }
  | { tipo: 'enviar'; texto: string }
  | { tipo: 'falar'; texto: string }
  | { tipo: 'tocarTique' }
  | { tipo: 'falarPonte' } // frase local enquanto o Zé não responde
  | { tipo: 'avisarDemora' }
  | { tipo: 'avisarErro'; motivo: MotivoDeErro };

/** Tempos em ms. Os do detector vêm da pesquisa §2 e se confirmam na fase 0. */
export const TEMPOS = {
  /** Silêncio que encerra a fala. 900 ms corta quem respira no meio da frase. */
  silencioFimDeFala: 1400,
  /** Áudio guardado antes do início detectado, para não perder a primeira sílaba. */
  preGravacao: 800,
  /** Fala mais curta que isso é tosse ou estalo, não pedido. */
  falaMinima: 400,
  /** Sem nenhum texto do Zé até aqui → frase-ponte (uma por turno). */
  ponte: 5_000,
  /** Sem nenhum texto do Zé até aqui → aviso falado de demora. */
  avisoDemora: 20_000,
} as const;
