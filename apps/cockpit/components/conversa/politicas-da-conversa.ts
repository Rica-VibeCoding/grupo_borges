export type EventoDeAviso =
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'vozFalhou'; mensagem: string }
  | { tipo: 'detectorLigou' }
  | { tipo: 'novoGesto' };

export function reduzAviso(
  atual: string | null,
  evento: EventoDeAviso,
): string | null {
  switch (evento.tipo) {
    case 'erro':
    case 'vozFalhou':
      return evento.mensagem;
    case 'detectorLigou':
      return atual;
    case 'novoGesto':
      return null;
    default:
      return atual;
  }
}

type AcoesDoGesto = {
  cancelaFalaLocal(): void;
  destravaReprodutor(): void;
  destravaSons(): void;
  pedeWakeLock(): void;
  comeca(): void;
};

export function executaGestoDeInicio(acoes: AcoesDoGesto): void {
  acoes.cancelaFalaLocal();
  acoes.destravaReprodutor();
  acoes.destravaSons();
  acoes.pedeWakeLock();
  acoes.comeca();
}
