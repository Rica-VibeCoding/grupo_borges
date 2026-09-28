'use client';

/**
 * O estado VIVO no topo do chat (redesenho de 28/09, aprovado pelo Rica):
 * a linha embaixo do nome — ponto na cor do estado + a palavra
 * ("trabalhando"). Mesmo vocabulário da tropa (`estado.ts`). Sem duração: o
 * front não tem o instante em que o estado atual começou.
 *
 * Bebe da frota VIVA (`usaFrota`), não de prop do servidor — a barra não
 * remonta a cada turno, e o estado congelaria no de quando a página abriu.
 */
import { estadoDe } from './estado';
import { usaFrota } from './frota-provider';

function useAgente(slug: string) {
  const { agents } = usaFrota();
  return agents.find((a) => a.slug === slug);
}

export function EstadoNoTopo({ slug }: { slug: string }) {
  const agente = useAgente(slug);
  const estado = estadoDe(agente?.status);

  return (
    <span
      className="flex min-w-0 items-center"
      style={{ gap: 'var(--ck-space-1)', color: estado.cor, fontSize: 'var(--ck-text-xs)' }}
    >
      <span
        aria-hidden
        className="shrink-0"
        style={{ width: 7, height: 7, borderRadius: 'var(--ck-radius-pill)', background: estado.cor }}
      />
      <span className="truncate">{estado.rotulo}</span>
    </span>
  );
}
