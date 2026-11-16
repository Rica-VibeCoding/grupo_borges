'use client';

// Podas cujo aprendizado já não está na lista (a página recarregou, ou o
// filtro é outro). O Desfazer continua aqui por 7 dias, guardado no aparelho.

import { useRouter } from 'next/navigation';

import { AvisoDaPoda } from '@/components/aprendizado/aviso-da-poda';
import { type Poda } from '@/lib/aprendizado';

export function PodasRecentes({
  podas,
  aoMudar,
  aoEsquecer,
}: {
  podas: Poda[];
  aoMudar: (poda: Poda) => void;
  aoEsquecer: (noId: string) => void;
}) {
  const router = useRouter();
  return (
    <section aria-label="Podas recentes" className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <h2 style={{ padding: '0 var(--ck-space-3)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>
        Podados por você
      </h2>
      <ul className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
        {podas.map((poda) => (
          <li
            key={poda.no_id}
            style={{
              padding: 'var(--ck-space-3)',
              borderRadius: 'var(--ck-radius-caixa)',
              background: 'var(--ck-surface-composer)',
              borderTop: '1px solid var(--ck-edge-light)',
            }}
          >
            <AvisoDaPoda
              poda={poda}
              aoMudar={aoMudar}
              aoEsquecer={(id) => {
                aoEsquecer(id);
                // A memória voltou ao inventário: a lista do servidor a traz de volta.
                if (poda.tipo === 'memoria') router.refresh();
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
