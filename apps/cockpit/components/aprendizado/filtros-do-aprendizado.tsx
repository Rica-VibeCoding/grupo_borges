import Link from 'next/link';

import { TRILHO_DA_PASTILHA, MIOLO_ACESO } from '@/components/shell/pastilha-do-chrome';
import { AGENTE_COMPARTILHADO, nomeDoAgente, type Filtros, type TipoAprendizado } from '@/lib/aprendizado';

// Os dois filtros moram na URL, então cada escolha é um link. Sem prefetch: são
// até 17 links, e cada pré-carga varreria o inventário da frota inteira à toa.

const TIPOS: { tipo: TipoAprendizado | null; rotulo: string }[] = [
  { tipo: null, rotulo: 'Tudo' },
  { tipo: 'memoria', rotulo: 'Memórias' },
  { tipo: 'memoria_compartilhada', rotulo: 'Compartilhadas' },
  { tipo: 'skill', rotulo: 'Skills' },
];

type Agente = { slug: string; nome: string; total: number };

function href({ agente, tipo }: Filtros): string {
  const q = new URLSearchParams();
  if (agente) q.set('agente', agente);
  if (tipo) q.set('tipo', tipo);
  const s = q.toString();
  return s ? `/aprendizado?${s}` : '/aprendizado';
}

export function FiltrosDoAprendizado({
  filtros,
  agentes,
  totalGeral,
}: {
  filtros: Filtros;
  agentes: Agente[];
  /** Tudo do tipo escolhido, compartilhada inclusive. */
  totalGeral: number;
}) {
  // O agente escolhido pode não ter nada no tipo atual: continua na fileira,
  // com zero, para o Rica ver o que está marcado e poder desmarcar.
  // Entra antes da Frota, que fecha a fileira.
  const lista = [...agentes];
  if (filtros.agente && !agentes.some((a) => a.slug === filtros.agente)) {
    const frota = lista.findIndex((a) => a.slug === AGENTE_COMPARTILHADO);
    const marcado = { slug: filtros.agente, nome: nomeDoAgente(filtros.agente), total: 0 };
    lista.splice(frota === -1 ? lista.length : frota, 0, marcado);
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      {/* Rola de lado em vez de quebrar: a 320px as quatro não cabem. */}
      <nav
        aria-label="Tipo"
        className="flex self-start overflow-x-auto"
        style={{
          ...TRILHO_DA_PASTILHA,
          padding: 0,
          margin: '0 var(--ck-space-3)',
          maxWidth: 'calc(100% - 2 * var(--ck-space-3))',
          scrollbarWidth: 'none',
        }}
      >
        {TIPOS.map(({ tipo, rotulo }) => {
          const marcado = filtros.tipo === tipo;
          return (
            <Link
              key={rotulo}
              href={href({ ...filtros, tipo })}
              prefetch={false}
              aria-current={marcado ? 'page' : undefined}
              className="ck-foco-fio-miolo flex shrink-0 items-center"
              style={{ minHeight: 'var(--ck-touch-min)', padding: '0 3px' }}
            >
              <span
                className="flex items-center whitespace-nowrap"
                style={{
                  height: 'calc(var(--ck-touch-min) - 8px)',
                  padding: '0 var(--ck-space-3)',
                  borderRadius: 'var(--ck-radius-pill)',
                  fontSize: 'var(--ck-text-sm)',
                  backgroundColor: marcado ? MIOLO_ACESO : 'transparent',
                  color: marcado ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
                }}
              >
                {rotulo}
              </span>
            </Link>
          );
        })}
      </nav>

      <nav
        aria-label="Agente"
        className="flex overflow-x-auto md:flex-wrap"
        style={{ gap: 'var(--ck-space-2)', padding: '0 var(--ck-space-3)', scrollbarWidth: 'none' }}
      >
        <ChipDeAgente href={href({ ...filtros, agente: null })} nome="Todos" total={totalGeral} marcado={!filtros.agente} />
        {lista.map((a) => (
          <ChipDeAgente
            key={a.slug}
            href={href({ ...filtros, agente: a.slug })}
            nome={a.nome}
            total={a.total}
            marcado={filtros.agente === a.slug}
          />
        ))}
      </nav>
    </div>
  );
}

function ChipDeAgente({ href, nome, total, marcado }: { href: string; nome: string; total: number; marcado: boolean }) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={marcado ? 'page' : undefined}
      className="ck-foco-fio inline-flex shrink-0 items-center"
      style={{
        gap: 'var(--ck-space-2)',
        minHeight: 'var(--ck-touch-min)',
        padding: '0 var(--ck-space-4)',
        borderRadius: 'var(--ck-radius-pill)',
        fontSize: 'var(--ck-text-sm)',
        border: `1px solid ${marcado ? 'var(--ck-edge-functional)' : 'var(--ck-edge-hairline)'}`,
        backgroundColor: marcado ? 'var(--ck-surface-raised)' : 'transparent',
        color: marcado ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
      }}
    >
      <span>{nome}</span>
      <span className="ck-tabular" style={{ fontSize: 'var(--ck-text-xs)' }}>
        {total}
      </span>
    </Link>
  );
}
