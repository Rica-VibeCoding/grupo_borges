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
 */
export type DestinoDoErro =
  | { tipo: 'enviada' }
  | { tipo: 'retentar'; atrasoMs: number }
  | { tipo: 'falhou'; motivo: MotivoDeErro };

export function destinoDoErroDeEnvio(erro: unknown, jaTentadas: number): DestinoDoErro {
  const bruto = (typeof erro === 'object' && erro !== null ? erro : {}) as {
    status?: unknown;
    deliveryOutcome?: unknown;
  };
  if (typeof bruto.status !== 'number') return { tipo: 'falhou', motivo: 'envioFalhou' };
  if (bruto.deliveryOutcome === 'uncertain') return { tipo: 'enviada' };
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
