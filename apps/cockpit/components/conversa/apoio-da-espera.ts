import { TEMPOS } from '../../lib/conversa/tipos.ts';

export const SILENCIO_DO_APOIO_MS = 60_000;

export function criaRelogioDoApoio() {
  let inicio: number | null = null;
  let ultimaFala = 0;
  let ultimoPedido = 0;
  let degrau = 0;
  const prazos = [TEMPOS.ponte, TEMPOS.avisoDemora, SILENCIO_DO_APOIO_MS];

  return {
    inicia(agora: number) {
      if (inicio !== null) return;
      inicio = agora;
      ultimaFala = agora;
      ultimoPedido = agora;
      degrau = 0;
    },
    falou(agora: number) {
      if (inicio !== null) ultimaFala = agora;
    },
    encerra() {
      inicio = null;
    },
    tique(agora: number, bloqueado: boolean): { decorridoMs: number } | null {
      if (inicio === null || bloqueado || agora - Math.max(ultimaFala, ultimoPedido) < prazos[degrau]) return null;
      ultimoPedido = agora;
      degrau = Math.min(degrau + 1, prazos.length - 1);
      return { decorridoMs: agora - inicio };
    },
  };
}
