export type SonsLocais = {
  destrava(): void;
  tocaTique(): void;
  /** Retorno do toque sem texto: duas notas subindo ao começar, descendo ao parar. */
  sinalizaInicio(): void;
  sinalizaFim(): void;
  /** Segurar a vez: uma nota grave e curta, que não se confunde com o tique nem com o começar. */
  sinalizaSegurar(): void;
  fala(texto: string, aoTerminar?: () => void): void;
  cancelaFala(): void;
  encerra(): void;
};

type FraseComVolume = { volume: number };

/** Bônus onde existe (Android): o iPhone não tem vibração na web, o som é o aviso. */
export function vibraSePuder(padrao: number | number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(padrao);
}

// Uma nota curta com ataque e queda rápidos, sem estalo: o timbre do tique.
function nota(audio: AudioContext, frequencia: number, inicio: number, duracao: number): void {
  const oscilador = audio.createOscillator();
  const volume = audio.createGain();
  oscilador.frequency.value = frequencia;
  volume.gain.setValueAtTime(0.0001, inicio);
  volume.gain.exponentialRampToValueAtTime(0.08, inicio + 0.008);
  volume.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao - 0.005);
  oscilador.connect(volume);
  volume.connect(audio.destination);
  oscilador.start(inicio);
  oscilador.stop(inicio + duracao);
}

// Dó e sol: um intervalo que não se confunde com o tique (lá, uma nota só).
const GRAVE = 523;
const AGUDA = 784;
// Sol uma oitava abaixo: o segurar, uma nota só e mais baixa que todas.
const SEGURA = 392;

export function destravaSintese<T extends FraseComVolume>(
  sintese: { resume(): void; speak(frase: T): void },
  criaFrase: (texto: string) => T,
): void {
  sintese.resume();
  const fraseSilenciosa = criaFrase('');
  fraseSilenciosa.volume = 0;
  sintese.speak(fraseSilenciosa);
}

export function criaSonsLocais(): SonsLocais {
  let contexto: AudioContext | null = null;

  const garanteContexto = () => {
    contexto ??= new AudioContext();
    return contexto;
  };

  return {
    destrava() {
      const audio = garanteContexto();
      void audio.resume().catch(() => {});
      if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
        try {
          destravaSintese(
            window.speechSynthesis,
            (texto) => new window.SpeechSynthesisUtterance(texto),
          );
        } catch {
          // A conversa ainda funciona sem os avisos locais do navegador.
        }
      }
    },
    tocaTique() {
      const audio = garanteContexto();
      nota(audio, 660, audio.currentTime, 0.08);
    },
    sinalizaInicio() {
      const audio = garanteContexto();
      nota(audio, GRAVE, audio.currentTime, 0.07);
      nota(audio, AGUDA, audio.currentTime + 0.09, 0.09);
      vibraSePuder(15);
    },
    sinalizaFim() {
      const audio = garanteContexto();
      nota(audio, AGUDA, audio.currentTime, 0.07);
      nota(audio, GRAVE, audio.currentTime + 0.09, 0.11);
      vibraSePuder([10, 60, 10]);
    },
    sinalizaSegurar() {
      const audio = garanteContexto();
      nota(audio, SEGURA, audio.currentTime, 0.06);
      vibraSePuder(8);
    },
    fala(texto, aoTerminar) {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const frase = new SpeechSynthesisUtterance(texto);
      frase.lang = 'pt-BR';
      frase.rate = 1.02;
      frase.onend = () => aoTerminar?.();
      window.speechSynthesis.speak(frase);
    },
    cancelaFala() {
      window.speechSynthesis?.cancel();
    },
    encerra() {
      window.speechSynthesis?.cancel();
      if (contexto !== null) void contexto.close().catch(() => {});
      contexto = null;
    },
  };
}
