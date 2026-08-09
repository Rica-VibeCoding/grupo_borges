'use client';

import { usePathname } from 'next/navigation';

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

/** Sem `<Suspense>`: `usePathname` não suspende (quem suspende é
 *  `useSearchParams`, e só quando há prerender estático para adiar). O boundary
 *  que estava aqui repetia a tropa inteira no fallback e o HTML do SSR saía com
 *  ela desenhada duas vezes — junto com os dois providers do
 *  `superficie-otimista`, dava oito cópias de cada agente num HTML de 251 KB. */
export function TropaAoVivo(props: TropaAoVivoProps) {
  const pathname = usePathname();
  const prefixo = '/agente/';
  const slugDaRota = pathname.startsWith(prefixo)
    ? pathname.slice(prefixo.length).split('/')[0]
    : undefined;

  return <TropaComSlug {...props} slugSelecionado={slugDaRota || props.slugSelecionado} />;
}
