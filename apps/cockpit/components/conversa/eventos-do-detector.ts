import type { RefObject } from 'react';
import type { Evento } from '../../lib/conversa/tipos.ts';

/** Quem acompanha a fala quadro a quadro — o canal ao vivo (`use-canal-da-fala.ts`). */
export type OuvinteDaFala = {
  quadro(quadro: Float32Array): void;
  inicio(): void;
  /** Curta demais, ou o detector parou no meio: a fala some. */
  descarte(): void;
  fim(): void;
};

/**
 * `falaVale`: a fala que COMEÇA com ele falso é ignorada inteira, até o fim — sem fone, é a frase
 * de apoio tocando na espera e voltando pelo microfone. Os quadros seguem contando para a vigia
 * (`ultimoQuadroRef`), mas o volume fica em zero: o eco não mexe na esfera.
 */
export function eventosDoDetector({ podeOuvir, falaVale = () => true, falaRef, eventoRef, ultimoQuadroRef, nivelRef, setFalaDetectada }: {
  podeOuvir(): boolean;
  falaVale?(): boolean;
  falaRef: RefObject<OuvinteDaFala | null>;
  eventoRef: RefObject<(evento: Evento) => void>;
  ultimoQuadroRef: RefObject<number>;
  nivelRef: RefObject<number>;
  setFalaDetectada(fala: boolean): void;
}) {
  let ignorada = false;
  return {
    onSpeechStart: () => {
      if (!podeOuvir()) return;
      ignorada = !falaVale();
      if (ignorada) return;
      setFalaDetectada(true);
      falaRef.current?.inicio();
      eventoRef.current({ tipo: 'falaIniciou' });
    },
    onSpeechRealStart: () => {
      if (podeOuvir() && !ignorada) eventoRef.current({ tipo: 'falaConfirmada' });
    },
    onSpeechEnd: (audio: Float32Array) => {
      if (!podeOuvir()) return;
      if (ignorada) { ignorada = false; return; }
      setFalaDetectada(false);
      falaRef.current?.fim(); // antes da máquina: a confirmação sai já, junto com o fim
      eventoRef.current({ tipo: 'falaTerminou', audio });
    },
    onVADMisfire: () => {
      if (!podeOuvir()) return;
      if (ignorada) { ignorada = false; return; }
      setFalaDetectada(false);
      falaRef.current?.descarte();
      eventoRef.current({ tipo: 'falaDescartada' });
    },
    onFrameProcessed: (_probabilidades: unknown, quadro: Float32Array) => {
      if (!podeOuvir()) return;
      ultimoQuadroRef.current = performance.now();
      if (ignorada || !falaVale()) { nivelRef.current = 0; return; }
      falaRef.current?.quadro(quadro);
      let soma = 0;
      for (const amostra of quadro) soma += amostra * amostra;
      nivelRef.current = Math.min(1, Math.sqrt(soma / quadro.length) * 8);
    },
  };
}
