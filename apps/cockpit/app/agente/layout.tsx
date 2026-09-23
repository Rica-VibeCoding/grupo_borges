import Link from 'next/link';

import { AppShell } from '@/components/shell/app-shell';
import { IconeVassoura } from '@/components/shell/icones';
import { TropaAoVivo } from '@/components/shell/tropa-ao-vivo';
import { AtalhosDeTelas } from '@/components/telas/atalhos-de-telas';
import { fetchFaxina } from '@/lib/faxina';

export default async function AgenteLayout({ children }: { children: React.ReactNode }) {
  const agora = Math.floor(Date.now() / 1000);
  const faxinaPendentes = await fetchFaxina('pendente')
    .then((lista) => lista.resumo.pendentes)
    .catch(() => null);

  return (
    <AppShell
      nav={
        // O caminho de volta para a raiz, e dali para as telas, mora no topo da
        // faixa da tropa: no desktop ela está sempre à vista, no celular abre no
        // `≡`. Pedido do Rica (23/09): de dentro do chat não havia como voltar.
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="flex flex-wrap items-center"
            style={{ gap: 'var(--ck-space-2)', padding: 'var(--ck-space-3) var(--ck-space-3) var(--ck-space-2)' }}
          >
            <Link
              href="/"
              className="inline-flex items-center"
              style={{
                minHeight: 'var(--ck-touch-min)',
                padding: '0 var(--ck-space-3)',
                fontSize: 'var(--ck-text-sm)',
                color: 'var(--ck-text-secondary)',
              }}
            >
              ← Início
            </Link>
            <AtalhosDeTelas
              atalhos={[
                { href: '/faxina', rotulo: 'Faxina', icone: <IconeVassoura tamanho={16} />, contagem: faxinaPendentes },
              ]}
            />
          </div>
          <TropaAoVivo agora={agora} compacta />
        </div>
      }
      fecharNavHref="?"
    >
      {children}
    </AppShell>
  );
}
