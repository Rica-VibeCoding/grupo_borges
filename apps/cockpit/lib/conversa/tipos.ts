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
  | 'interrompendo' // fase 2: fala por cima detectada, voz do Zé pausada até confirmar ou descartar
  | 'erro';

export type MotivoDeErro =
  | 'microfoneNegado'
  | 'capturaCaiu' // tela bloqueada ou aba em segundo plano mataram o microfone
  | 'transcricaoFalhou'
  | 'transcricaoVazia'
  | 'envioFalhou'
  | 'agenteOcupado'; // o Zé já estava num turno quando a fala chegou

export type Evento =
  | { tipo: 'comecar' } // o toque que destrava áudio, microfone e Wake Lock; repetido não faz nada
  | { tipo: 'tique' } // a tela bate a cada ~250 ms; é o que move o relógio da espera
  | { tipo: 'parar' }
  | { tipo: 'falaIniciou' }
  | { tipo: 'falaDescartada' } // curta demais: o Silero chama de misfire
  | { tipo: 'falaConfirmada' } // fase 2: passou da fala mínima (o `onSpeechRealStart` do Silero)
  | { tipo: 'fone'; ligado: boolean } // fase 2: chave "estou de fone"; só com ela existe fala por cima
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
  | { tipo: 'avisarErro'; motivo: MotivoDeErro }
  | { tipo: 'pausarVoz' } // fase 2: fala por cima começou
  | { tipo: 'retomarVoz' } // fase 2: era tosse — a voz continua de onde parou
  | { tipo: 'descartarVoz' }; // fase 2: fala por cima confirmada — a fila do Zé é jogada fora

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
  /** Fase 2: fala por cima só vale depois disso de fala contínua. */
  confirmaFalaPorCima: 500,
  /** Fase 2: sem confirmar até aqui, a fala por cima é descartada e a voz retoma. */
  desclassificaFalaPorCima: 2_000,
  /** Fase 2: rede de segurança da máquina — se o Silero perdeu o callback, desclassifica aqui. */
  socorroFalaPorCima: 6_000,
} as const;

/**
 * O estado completo da conversa. `estado` é o que a tela desenha; o resto é a
 * memória que a máquina precisa (frase-ponte já dita neste turno etc.). Os
 * campos além de `estado` e `motivo` são da trilha lógica e podem crescer.
 */
export type Conversa = {
  estado: Estado;
  motivo?: MotivoDeErro;
};

/**
 * A máquina é PURA: o relógio entra por `agora` (ms, `performance.now()` na
 * tela, número fixo no teste). Quem implementa: `lib/conversa/maquina.ts`.
 */
export type Avanca = (
  conversa: Conversa,
  evento: Evento,
  agora: number,
) => { conversa: Conversa; efeitos: Efeito[] };
