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
