'use client';

import { usePathname } from 'next/navigation';
import { Suspense } from 'react';

import { usaFrota } from './frota-provider';
import { Tropa } from './tropa';

type TropaAoVivoProps = {
  /** Fallback para usos fora de uma rota `/agente/[slug]`, como a `/`. */
  slugSelecionado?: string;
  agora: number;
  compacta?: boolean;
};

function TropaComSlug({
  slugSelecionado,
  agora,
  compacta = false,
}: TropaAoVivoProps) {
  const { agents } = usaFrota();
  return (
    <Tropa
      agents={agents}
      slugSelecionado={slugSelecionado}
      agora={agora}
      compacta={compacta}
    />
  );
}

function TropaComPathname(props: TropaAoVivoProps) {
  const pathname = usePathname();
  const prefixo = '/agente/';
  const slugDaRota = pathname.startsWith(prefixo)
    ? pathname.slice(prefixo.length).split('/')[0]
    : undefined;

  return <TropaComSlug {...props} slugSelecionado={slugDaRota || props.slugSelecionado} />;
}

export function TropaAoVivo(props: TropaAoVivoProps) {
  return (
    <Suspense fallback={<TropaComSlug {...props} />}>
      <TropaComPathname {...props} />
    </Suspense>
  );
}
