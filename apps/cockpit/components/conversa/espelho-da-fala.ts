/**
 * O espelho da fala (fase 4, item 6) — PURO. Decide o que do microfone entra no canal ao vivo
 * e se o canal tem a fala inteira quando o detector diz que ela acabou.
 *
 * O canal recebe o MESMO trecho que o WAV levaria: a pré-gravação do detector, a fala e o
 * silêncio até o fim — nada do silêncio de antes, que só daria ao transcritor chance de
 * inventar texto. Quem decide começo e fim continua sendo o detector (`@ricky0123/vad-web`
 * 0.0.31): este arquivo só imita o `audioBuffer` dele (`dist/frame-processor.js`), que entrega
 * o quadro ANTES de avisar que a fala começou e zera a pré-gravação a cada fim ou descarte.
 *
 * Qualquer quadro perdido — canal que caiu no meio, espera acima do teto — tira a fala do
 * caminho ao vivo: ela sobe pelo WAV, como sempre subiu. O canal nunca confirma fala pela metade.
 */
import { TEMPOS } from '../../lib/conversa/tipos.ts';

/** Quadro do Silero v5: 512 amostras a 16 kHz. */
export const MS_POR_QUADRO = 32;
/** O detector guarda `floor(800 / 32)` quadros e empilha o da fala antes de avisar: 26. */
export const QUADROS_DE_PRE_GRAVACAO = Math.floor(TEMPOS.preGravacao / MS_POR_QUADRO) + 1;
/** Fala guardada à espera do canal (~60 s, ~4 MB). Passou disso, o canal não alcança mais. */
export const TETO_DE_ESPERA = Math.ceil(60_000 / MS_POR_QUADRO);

export type Comando = { tipo: 'limpa' } | { tipo: 'manda'; quadros: Float32Array[] };
export type Caminho = 'aoVivo' | 'arquivo';

export type EspelhoDaFala = {
  /** Cada quadro que o detector processou, na ordem. */
  quadro(quadro: Float32Array): Comando[];
  /** O detector viu fala (`onSpeechStart`). */
  inicio(): Comando[];
  /** Curta demais (`onVADMisfire`): nada dela pode ficar no canal. */
  descarte(): Comando[];
  abrindo(): void;
  abriu(): Comando[];
  caiu(): void;
  /** O detector encerrou a fala. `aoVivo` = o canal tem ela inteira: confirmar e esperar o texto. */
  fim(): Caminho;
};

export function criaEspelhoDaFala({
  preGravacao = QUADROS_DE_PRE_GRAVACAO,
  teto = TETO_DE_ESPERA,
}: { preGravacao?: number; teto?: number } = {}): EspelhoDaFala {
  let canal: 'ausente' | 'abrindo' | 'aberto' = 'ausente';
  let falando = false;
  /** A fala em curso chegou (ou ainda vai chegar) inteira ao canal. */
  let inteira = true;
  /** O buffer do canal tem áudio que ainda não foi confirmado nem limpo. */
  let sujo = false;
  let antes: Float32Array[] = [];
  let espera: Float32Array[] = [];

  const manda = (quadros: Float32Array[]): Comando[] => {
    if (quadros.length === 0) return [];
    sujo = true;
    return [{ tipo: 'manda', quadros }];
  };
  const limpa = (): Comando[] => {
    if (!sujo || canal !== 'aberto') return [];
    sujo = false;
    return [{ tipo: 'limpa' }];
  };
  const encerraFala = () => {
    falando = false;
    inteira = true;
    antes = [];
    espera = [];
  };

  return {
    quadro(quadro) {
      // Os últimos quadros ficam sempre à mão: uma fala que recomeça sem fim (detector trocado
      // no meio) leva a pré-gravação dela, como o `audioBuffer` do detector novo.
      antes.push(quadro);
      if (antes.length > preGravacao) antes.shift();
      if (!falando || !inteira) return [];
      if (canal === 'aberto') return manda([quadro]);
      espera.push(quadro);
      if (espera.length > teto) {
        inteira = false;
        espera = [];
      }
      return [];
    },
    inicio() {
      const comandos = limpa();
      falando = true;
      inteira = true;
      espera = antes.slice();
      if (canal !== 'aberto') return comandos;
      const quadros = espera;
      espera = [];
      return [...comandos, ...manda(quadros)];
    },
    descarte() {
      const comandos = limpa();
      encerraFala();
      return comandos;
    },
    abrindo() {
      canal = 'abrindo';
      sujo = false;
    },
    abriu() {
      canal = 'aberto';
      if (!falando || !inteira) return [];
      const quadros = espera;
      espera = [];
      return manda(quadros);
    },
    caiu() {
      canal = 'ausente';
      sujo = false;
      espera = [];
      if (falando) inteira = false;
    },
    fim() {
      const caminho: Caminho = falando && inteira && canal === 'aberto' ? 'aoVivo' : 'arquivo';
      if (caminho === 'aoVivo') sujo = false; // a confirmação consome o buffer
      encerraFala();
      return caminho;
    },
  };
}
