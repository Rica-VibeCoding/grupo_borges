import Link from 'next/link';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

// A fileira de telas da raiz. Nasceu com a Faxina (23/09) e é lista de
// propósito: tela nova entra como mais um item, lado a lado, sem redesenho.
// Verde claro a pedido do Rica; a cor mora nos tokens `--ck-atalho-*`.

export type AtalhoDeTela = {
  href: string;
  rotulo: string;
  icone: ReactNode;
  /** Quanto espera por ele. Zero ou ausente não mostra selo. */
  contagem?: number | null;
};

export function AtalhosDeTelas({ atalhos }: { atalhos: AtalhoDeTela[] }) {
  if (atalhos.length === 0) return null;
  return (
    <nav aria-label="Telas" className="flex flex-wrap" style={{ gap: 'var(--ck-space-2)' }}>
      {atalhos.map((atalho) => (
        <Link
          key={atalho.href}
          href={atalho.href}
          className="ck-atalho inline-flex items-center"
          style={{
            gap: 'var(--ck-space-2)',
            minHeight: 'var(--ck-touch-min)',
            padding: '0 var(--ck-space-4) 0 var(--ck-space-3)',
            borderRadius: 'var(--ck-radius-pill)',
            border: '1px solid var(--ck-atalho-borda)',
            color: 'var(--ck-atalho-fg)',
            fontSize: 'var(--ck-text-sm)',
          }}
        >
          {atalho.icone}
          <span>{atalho.rotulo}</span>
          {atalho.contagem ? (
            <Badge
              className="ck-tabular"
              style={{ background: 'var(--ck-atalho-fg)', color: 'var(--ck-surface-nav)' }}
            >
              {atalho.contagem}
            </Badge>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
