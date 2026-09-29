export function criaPrazoDePublicacao(
  publica: () => void,
  agenda: (callback: () => void, atraso: number) => number,
  cancelaTimer: (id: number) => void,
) {
  let timer: number | undefined;

  return {
    agenda() {
      if (timer !== undefined) return;
      timer = agenda(() => {
        timer = undefined;
        publica();
      }, 50);
    },
    cancela() {
      if (timer === undefined) return;
      cancelaTimer(timer);
      timer = undefined;
    },
  };
}
