/** O TTS entrega picos normalizados entre 0 e 31, por sentença. */
export type EnvelopeVoz = { inicio: number; duracao: number; peaks: readonly number[] };

export function nivelDaVoz(envelopes: readonly EnvelopeVoz[], segundos: number): number {
  const trecho = envelopes.find((e) => segundos >= e.inicio && segundos < e.inicio + e.duracao);
  if (!trecho) return 0;
  const indice = Math.floor((segundos - trecho.inicio) / trecho.duracao * trecho.peaks.length);
  return Math.min(1, Math.max(0, (trecho.peaks[indice] ?? 0) / 31));
}
