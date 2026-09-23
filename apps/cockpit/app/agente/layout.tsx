import Link from 'next/link';

import { AppShell } from '@/components/shell/app-shell';
import { TropaAoVivo } from '@/components/shell/tropa-ao-vivo';

export default function AgenteLayout({ children }: { children: React.ReactNode }) {
  const agora = Math.floor(Date.now() / 1000);

  return (
    <AppShell
      nav={
        // O caminho de volta para a raiz mora no topo da faixa da tropa: no
        // desktop ela está sempre à vista, no celular abre no `≡`. Pedido do
        // Rica (23/09): de dentro do chat não havia como voltar. Os atalhos de
        // tela ficam só na raiz — também pedido dele.
        <div className="flex min-h-0 flex-1 flex-col">
          <Link
            href="/"
            className="inline-flex items-center self-start"
            style={{
              minHeight: 'var(--ck-touch-min)',
              margin: 'var(--ck-space-2) var(--ck-space-3) 0',
              padding: '0 var(--ck-space-3)',
              fontSize: 'var(--ck-text-sm)',
              color: 'var(--ck-text-secondary)',
            }}
          >
            ← Início
          </Link>
          <TropaAoVivo agora={agora} compacta />
        </div>
      }
      fecharNavHref="?"
    >
      {children}
    </AppShell>
  );
}
