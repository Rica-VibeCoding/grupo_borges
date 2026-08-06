'use client';

import { usaFrota } from './frota-provider';
import { Tropa } from './tropa';

export function TropaAoVivo({
  slugSelecionado,
  agora,
  compacta = false,
}: {
  slugSelecionado?: string;
  agora: number;
  compacta?: boolean;
}) {
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
