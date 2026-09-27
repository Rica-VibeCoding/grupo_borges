'use client';

// A linha embaixo de cada bloco de texto do agente: o alto-falante (quando há
// agente pra falar) e, ao lado, a data-hora discreta do bloco (Rica, 27/09).
//
// Enquanto o bloco ainda está sendo escrito o carimbo fica de fora: o cursor já
// diz "agora", e a hora entra quando o bloco assenta.

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { BolhaVoz } from './bolha-voz.tsx';
import { formataDataHora, instanteDoBloco } from './data-hora.ts';

type Props = {
  texto: string;
  payload: Pick<MessagePayload, 'timestamp' | 'created_at'>;
  agentSlug?: string;
  escrevendo?: boolean;
};

export function RodapeDaFala({ texto, payload, agentSlug, escrevendo = false }: Props) {
  if (texto.length === 0) return null;
  const instante = escrevendo ? null : instanteDoBloco(payload);
  const quando = instante === null ? null : formataDataHora(instante);
  if (!agentSlug && !quando) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {agentSlug ? <BolhaVoz texto={texto} agentSlug={agentSlug} /> : null}
      {quando && instante !== null ? (
        <time
          dateTime={new Date(instante).toISOString()}
          className="tabular-nums"
          style={{ color: 'var(--ck-text-tertiary)', fontSize: 'var(--ck-text-xs)' }}
        >
          {quando}
        </time>
      ) : null}
    </div>
  );
}
