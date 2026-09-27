export type DetectorControlado = {
  start(): Promise<void>;
  pause(): Promise<void>;
  destroy(): Promise<void>;
};

type CriaDetector<T extends DetectorControlado> = () => Promise<T>;

export type ControladorDetector = {
  liga(): Promise<void>;
  desliga(): Promise<void>;
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

  return {
    async liga() {
      if (encerrado) throw new Error('detector encerrado');
      intencao += 1;
      const alvo = detector;
      const tentativa = (async () => {
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
      })();
      ligando = tentativa;
      try {
        await tentativa;
      } finally {
        if (ligando === tentativa) ligando = null;
      }
    },
    async desliga() {
      const minhaIntencao = ++intencao;
      try {
        await ligando;
      } catch {
        // A falha da abertura é entregue por liga(); ainda precisamos fechar a substituta.
      }
      if (!encerrado && minhaIntencao === intencao) await detector.pause();
    },
    async encerra() {
      encerrado = true;
      intencao += 1;
      try {
        await ligando;
      } catch {
        // A substituição já foi tentada; o encerramento só garante a limpeza final.
      }
      await destroiSemFalhar(detector);
    },
  };
}
