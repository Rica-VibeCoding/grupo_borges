'use client';

// A linha embaixo de cada bloco de texto do agente: o alto-falante (quando há
// agente pra falar) e, ao lado, a data-hora discreta do bloco (Rica, 27/09).
// O timestamp é o da linha do JSONL: fixo desde que o bloco existe.

import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { BolhaVoz } from './bolha-voz.tsx';
import { formataDataHora, instanteDoBloco } from './data-hora.ts';

type Props = {
  texto: string;
  payload: Pick<MessagePayload, 'timestamp' | 'created_at'>;
  agentSlug?: string;
};

export function RodapeDaFala({ texto, payload, agentSlug }: Props) {
  if (texto.length === 0) return null;
  const instante = instanteDoBloco(payload);
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
