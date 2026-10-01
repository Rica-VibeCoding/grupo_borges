import type { MotivoDeErro } from '@/lib/conversa/tipos';

import { atrasoDaRetentativa, ehRecusaTransitoria } from '../../lib/recusa-transitoria.ts';

/**
 * O que fazer quando o `/input` da fala falha. O servidor não recusa por ocupação
 * (o Claude Code enfileira); o 409 que existe é `agent_pane_unavailable`, e o recibo
 * diz de que tipo:
 * - `uncertain`: a entrega não foi provada, e quase sempre entrou (`usa-envio.ts`).
 *   Segue como enviada — reenviar duplicaria, avisar seria alarme falso.
 * - `refused` com `safe_to_resend`: nada foi escrito no pane. Insiste sozinho, com as
 *   esperas de `recusa-transitoria.ts`; esgotadas, a mensagem não saiu.
 * - `agent_tmux_busy`: a trava do pane está com outro — o freio segura até ~3 s depois do toque.
 *   Nada foi escrito (a recusa vem antes do paste). Insiste até ~4 s; só aqui, o chat não muda.
 */
const ESPERAS_DO_PANE_PRESO_MS = [500, 1_000, 1_000, 1_500] as const;

export type DestinoDoErro =
  | { tipo: 'enviada' }
  | { tipo: 'retentar'; atrasoMs: number }
  | { tipo: 'falhou'; motivo: MotivoDeErro };

export function destinoDoErroDeEnvio(erro: unknown, jaTentadas: number): DestinoDoErro {
  const bruto = (typeof erro === 'object' && erro !== null ? erro : {}) as {
    status?: unknown;
    deliveryOutcome?: unknown;
    detail?: unknown;
  };
  if (typeof bruto.status !== 'number') return { tipo: 'falhou', motivo: 'envioFalhou' };
  if (bruto.deliveryOutcome === 'uncertain') return { tipo: 'enviada' };
  if (bruto.status === 409 && bruto.detail === 'agent_tmux_busy') {
    const atraso = ESPERAS_DO_PANE_PRESO_MS[jaTentadas];
    return atraso === undefined ? { tipo: 'falhou', motivo: 'agenteOcupado' } : { tipo: 'retentar', atrasoMs: atraso };
  }
  if (ehRecusaTransitoria(erro)) {
    const atraso = atrasoDaRetentativa(jaTentadas);
    return atraso === null ? { tipo: 'falhou', motivo: 'envioFalhou' } : { tipo: 'retentar', atrasoMs: atraso };
  }
  return { tipo: 'falhou', motivo: bruto.status === 409 ? 'agenteOcupado' : 'envioFalhou' };
}

export type Envio = {
  posta: () => Promise<unknown>;
  /** O ciclo ainda é o mesmo: quem parou no meio não recebe resposta nem retentativa. */
  vivo: () => boolean;
  enviou: () => void;
  falhou: (motivo: MotivoDeErro) => void;
  agenda?: (acao: () => void, ms: number) => void;
};

/** Entrega a fala, insistindo só quando o servidor afirma que nada entrou. */
export function entregaFala(envio: Envio, jaTentadas = 0): void {
  void envio.posta().then(
    () => {
      if (envio.vivo()) envio.enviou();
    },
    (erro: unknown) => {
      if (!envio.vivo()) return;
      const destino = destinoDoErroDeEnvio(erro, jaTentadas);
      if (destino.tipo === 'enviada') envio.enviou();
      else if (destino.tipo === 'falhou') envio.falhou(destino.motivo);
      else {
        const agenda = envio.agenda ?? ((acao, ms) => void setTimeout(acao, ms));
        agenda(() => {
          if (envio.vivo()) entregaFala(envio, jaTentadas + 1);
        }, destino.atrasoMs);
      }
    },
  );
}
