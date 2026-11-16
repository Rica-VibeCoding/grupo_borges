import type { Viewport } from 'next';
import Link from 'next/link';

import { FiltrosDoAprendizado } from '@/components/aprendizado/filtros-do-aprendizado';
import { LinhaDoTempo } from '@/components/aprendizado/linha-do-tempo';
import { AppShell } from '@/components/shell/app-shell';
import {
  AGENTE_COMPARTILHADO,
  fetchAprendizado,
  lerTipo,
  nomeDoAgente,
  type Filtros,
  type ListaAprendizado,
} from '@/lib/aprendizado';

// Aprendizado — o que cada agente aprendeu, no tempo, e a poda do que estiver
// errado. Irmã da Faxina: mesma casca (`palco="mesa"`, coluna de leitura) e os
// filtros na URL (`?agente=&tipo=`), pela regra 1 do `app-shell.tsx`.
//
// Tela pouco consultada: nada daqui é importado fora desta rota, e os dados só
// são pedidos quando ela abre (ordem do Rica, 16/11).
export const dynamic = 'force-dynamic';

export const viewport: Viewport = { themeColor: '#222222' };

type Busca = { agente?: string; tipo?: string };

export default async function Aprendizado({ searchParams }: { searchParams: Promise<Busca> }) {
  const busca = await searchParams;
  const filtros: Filtros = { agente: busca.agente || null, tipo: lerTipo(busca.tipo) };
  const agora = Math.floor(Date.now() / 1000);

  let lista: ListaAprendizado | null = null;
  try {
    lista = await fetchAprendizado(filtros);
  } catch {
    lista = null;
  }

  // A contagem vem na própria página (`por_agente`, só com o filtro de tipo).
  // O que é da frota inteira (`ze-shared`: memória compartilhada e skills de
  // `ze-shared/.claude/skills`) vira o chip "Frota", no fim da fileira.
  const agentes = Object.entries(lista?.por_agente ?? {})
    .sort(
      (a, b) =>
        Number(a[0] === AGENTE_COMPARTILHADO) - Number(b[0] === AGENTE_COMPARTILHADO) ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0]),
    )
    .map(([slug, total]) => ({ slug, nome: nomeDoAgente(slug), total }));

  return (
    <AppShell palco="mesa">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="mx-auto flex w-full flex-col"
          style={{
            maxWidth: 'var(--ck-read-mid)',
            gap: 'var(--ck-space-4)',
            paddingTop: 'calc(var(--ck-space-4) + var(--ck-safe-top))',
            paddingRight: 'calc(var(--ck-space-2) + var(--ck-safe-right))',
            paddingBottom: 'calc(var(--ck-space-6) + var(--ck-safe-bottom))',
            paddingLeft: 'calc(var(--ck-space-2) + var(--ck-safe-left))',
          }}
        >
          <header className="flex flex-col" style={{ gap: 'var(--ck-space-2)', padding: '0 var(--ck-space-3)' }}>
            <Link
              href="/"
              className="ck-foco-fio inline-flex items-center self-start"
              style={{ minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-1)', margin: '0 calc(-1 * var(--ck-space-1))', borderRadius: 'var(--ck-radius-frame)', fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
            >
              ← Cockpit
            </Link>
            <h1
              className="text-balance"
              style={{ fontSize: 'var(--ck-text-lg)', letterSpacing: 'var(--ck-track-title)', color: 'var(--ck-text-primary)' }}
            >
              O que a frota aprendeu
            </h1>
            <p className="ck-tabular" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
              {lista ? resumo(lista.total, filtros) : 'Não consegui ler o aprendizado agora. Recarregue em instantes.'}
            </p>
          </header>

          {lista ? <FiltrosDoAprendizado
              filtros={filtros}
              agentes={agentes}
              totalGeral={lista.total_geral}
            /> : null}

          {lista ? (
            <LinhaDoTempo
              key={`${filtros.agente ?? ''}|${filtros.tipo ?? ''}`}
              inicial={lista}
              filtros={filtros}
              agora={agora}
            />
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

function resumo(total: number, { agente }: Filtros): string {
  const quantos = `${total} ${total === 1 ? 'aprendizado' : 'aprendizados'}`;
  if (!agente) return `${quantos}, do mais novo ao mais antigo`;
  return `${quantos} de ${nomeDoAgente(agente)}, do mais novo ao mais antigo`;
}
