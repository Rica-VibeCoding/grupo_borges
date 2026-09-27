export type SonsLocais = {
  destrava(): void;
  tocaTique(): void;
  fala(texto: string): void;
  cancelaFala(): void;
  encerra(): void;
};

type FraseComVolume = { volume: number };

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
      const inicio = audio.currentTime;
      const oscilador = audio.createOscillator();
      const volume = audio.createGain();
      oscilador.frequency.value = 660;
      volume.gain.setValueAtTime(0.0001, inicio);
      volume.gain.exponentialRampToValueAtTime(0.08, inicio + 0.008);
      volume.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.075);
      oscilador.connect(volume);
      volume.connect(audio.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + 0.08);
    },
    fala(texto) {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const frase = new SpeechSynthesisUtterance(texto);
      frase.lang = 'pt-BR';
      frase.rate = 1.02;
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
