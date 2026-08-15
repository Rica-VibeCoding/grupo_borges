import type { EstadoEnvio } from '../../lib/envio.ts';

const COMPACT_RE = /^\s*\/compact(?:\s|$)/;

export function deveIniciarCompact(corpo: string, ehCodex: boolean): boolean {
  return !ehCodex && COMPACT_RE.test(corpo);
}

export function textoDepoisDaEntregaDoAnexo(atual: string, enviado: string): string {
  return atual === enviado ? '' : atual;
}

export function envioVeioDaFila(estado: EstadoEnvio): boolean {
  return estado.fase === 'confirmado' && estado.fila === true;
}

export function deveEnviarPorEnter(entrada: {
  key: string;
  shiftKey: boolean;
  tecladoTouch: boolean;
  temAnexo: boolean;
  isComposing: boolean;
}): boolean {
  return (
    entrada.key === 'Enter' &&
    !entrada.shiftKey &&
    !entrada.isComposing &&
    (!entrada.tecladoTouch || entrada.temAnexo)
  );
}
