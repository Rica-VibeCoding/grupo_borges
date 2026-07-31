'use client';

// Corpo de linha de status (G4 da matriz, 14 result — P2, a mais rara das
// famílias com forma própria). Núcleo: tom de sucesso/falha + texto curto.
// Recebe o `tool_use_result` CRU por props; se não for da família, renderiza
// nada e o chamador cai pro corpo genérico.
//
// Sem seção/borda: "texto curto" não pede o card do G5/G6/G7 — mesma régua
// leve do `LinhaSeca` (corpo-do-item.tsx), uma linha só, sem caixa.
//
// Sem cor fora de token: var(--ck-*) ou nada.

import { Badge } from '@/components/ui/badge';

// Extensão `.ts` explícita: sem ela, a resolução do bare specifier ficava
// ambígua com este próprio arquivo (mesmo nome, .tsx) e o build quebrava —
// mesma cautela que o corpo-do-item.tsx já usa pra importar daqui de fora.
import { normalizarLinhaDeStatus } from './status-line.ts';

export function StatusLine({ valor }: { valor: unknown }) {
  const dados = normalizarLinhaDeStatus(valor);
  if (!dados) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-[var(--ck-space-2)] font-sans text-[13px]">
      <Badge
        style={{ color: dados.sucesso ? 'var(--ck-state-ok)' : 'var(--ck-state-fail)' }}
      >
        {dados.sucesso ? 'ok' : 'falhou'}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-[var(--ck-text-secondary)]">
        {dados.texto}
      </span>
      {dados.pin ? (
        <Badge style={{ color: 'var(--ck-text-secondary)' }}>→ {dados.pin.name}</Badge>
      ) : null}
      {dados.resumedAgentId ? (
        <Badge style={{ color: 'var(--ck-text-secondary)' }}>retomado</Badge>
      ) : null}
    </div>
  );
}
