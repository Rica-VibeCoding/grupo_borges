import { TEMPOS, type Estado } from '../../lib/conversa/tipos.ts';

export type DetectorControlado = {
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
};

type CriaDetector<T extends DetectorControlado> = () => Promise<T>;

export type ControladorDetector = {
  liga(): Promise<void>;
  desliga(): Promise<void>;
  /** Troca o detector por um novo — microfone e áudio novos — e liga. A escuta que emudeceu. */
  reabre(): Promise<void>;
  encerra(): Promise<void>;
};

export function criaControladorDetector<T extends DetectorControlado>(
  inicial: T,
  criaDetector: CriaDetector<T>,
): ControladorDetector {
  let detector = inicial;
  let ligando: Promise<void> | null = null;
  let encerrado = false;
  let intencao = 0;

  const destroiSemFalhar = async (alvo: T) => {
    try {
      await alvo.destroy();
    } catch {
      // O MicVAD pode falhar ao destruir uma instância cujo primeiro start não terminou.
    }
  };

  // Uma ligação ou reabertura em voo termina antes da próxima escolher o detector: sem isso,
  // ligar no meio de uma reabertura daria start no detector que está sendo destruído.
  const esperaAnterior = async (anterior: Promise<void> | null) => {
    try {
      await anterior;
    } catch {
      // A falha anterior já foi entregue a quem a pediu.
    }
  };

  const emVoo = async (tentativa: Promise<void>) => {
    ligando = tentativa;
    try {
      await tentativa;
    } finally {
      if (ligando === tentativa) ligando = null;
    }
  };

  return {
    async liga() {
      if (encerrado) throw new Error('detector encerrado');
      intencao += 1;
      const anterior = ligando;
      await emVoo((async () => {
        if (anterior !== null) await esperaAnterior(anterior);
        const alvo = detector;
        try {
          await alvo.start();
        } catch (erro) {
          await destroiSemFalhar(alvo);
          const substituto = await criaDetector();
          if (encerrado || detector !== alvo) {
            await destroiSemFalhar(substituto);
          } else {
            detector = substituto;
          }
          throw erro;
        }
      })());
    },
    async desliga() {
      const minhaIntencao = ++intencao;
      await esperaAnterior(ligando);
      if (!encerrado && minhaIntencao === intencao) await detector.pause();
    },
    async reabre() {
      if (encerrado) throw new Error('detector encerrado');
      const minhaIntencao = ++intencao;
      const anterior = ligando;
      await emVoo((async () => {
        await esperaAnterior(anterior);
        const velho = detector;
        await destroiSemFalhar(velho);
        const novo = await criaDetector();
        if (encerrado || detector !== velho) {
          await destroiSemFalhar(novo);
          throw new Error('reabertura superada');
        }
        detector = novo;
        // Desligaram no meio: o novo fica pronto e calado; quem desligou já esperou por ele.
        if (minhaIntencao === intencao) await novo.start();
      })());
    },
    async encerra() {
      encerrado = true;
      intencao += 1;
      await esperaAnterior(ligando);
      await destroiSemFalhar(detector);
    },
  };
}

/**
 * Segurar a vez (fase 4): enquanto o dedo está parado na tela, o silêncio não encerra a fala.
 * O limite vai a uma hora e, no soltar, volta aos 2 s — mas só o limite não basta. No
 * `@ricky0123/vad-web` 0.0.31 (`dist/frame-processor.js`) o fim da fala é
 * `++redemptionCounter >= redemptionFrames` a cada quadro de silêncio: o contador seguiu
 * contando durante o segurar e, com o limite de volta, a fala sairia no primeiro quadro
 * depois de soltar. Por isso o soltar zera o contador antes (`zeraContagemDoSilencio`).
 */
export const SILENCIO_SEGURADO_MS = 60 * 60 * 1000;

/** Fala mínima e silêncio que encerra, para o estado da conversa e o dedo na tela. */
export function opcoesDoDetector(estado: Estado, segurando: boolean): { minSpeechMs: number; redemptionMs: number } {
  // Com fone, falar por cima do Zé tem régua própria: confirma e desclassifica mais rápido.
  if (estado === 'falando' || estado === 'interrompendo') {
    return { minSpeechMs: TEMPOS.confirmaFalaPorCima, redemptionMs: TEMPOS.desclassificaFalaPorCima };
  }
  const segura = segurando && estado === 'ouvindo';
  return { minSpeechMs: TEMPOS.falaMinima, redemptionMs: segura ? SILENCIO_SEGURADO_MS : TEMPOS.silencioFimDeFala };
}

type ComContagem = { frameProcessor?: { redemptionCounter?: unknown } };

/**
 * Zera a contagem do silêncio da fala em curso, sem encerrar nem descartar o segmento (o
 * `pause()` do MicVAD faz um dos dois). É o único lugar que mexe no `frameProcessor`, que é
 * `private` no `.d.ts`: acoplamento com a versão 0.0.31, travado por
 * `contagem-do-silencio.test.ts`. Subiu a versão, rode esse teste antes. Devolve `false`
 * quando o campo não existe mais — aí a fala sairia logo depois de soltar.
 */
export function zeraContagemDoSilencio(detector: unknown): boolean {
  const processador = (detector as ComContagem | null)?.frameProcessor;
  if (processador === undefined || typeof processador.redemptionCounter !== 'number') return false;
  processador.redemptionCounter = 0;
  return true;
}

type Ajustavel = { setOptions(opcoes: ReturnType<typeof opcoesDoDetector>): void };

/**
 * Segura ou solta a vez no detector. Soltar zera a contagem ANTES de o limite voltar aos 2 s:
 * sem isso, o silêncio contado no segurar encerraria a fala no quadro seguinte.
 */
export function seguraNoDetector(detector: Ajustavel | null, estado: Estado, segurando: boolean): void {
  if (detector === null) return;
  if (!segurando) zeraContagemDoSilencio(detector);
  detector.setOptions(opcoesDoDetector(estado, segurando));
}
