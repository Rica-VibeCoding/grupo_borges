import type { Viewport } from 'next';
import Link from 'next/link';

import { CartaoFaxina } from '@/components/faxina/cartao-faxina';
import { AppShell } from '@/components/shell/app-shell';
import { MIOLO_ACESO, MIOLO_DA_PASTILHA, TRILHO_DA_PASTILHA } from '@/components/shell/pastilha-do-chrome';
import { fetchFaxina, type FaxinaAba, type FaxinaLista } from '@/lib/faxina';

// Faxina — os docs e skills parados que o Rica decide manter ou arquivar. Mesma
// casca da raiz (`palco="mesa"`, coluna de leitura), porque é uma lista, não uma
// folha. A aba mora na URL (`?aba=`), pela regra 1 do `app-shell.tsx`.
export const dynamic = 'force-dynamic';

export const viewport: Viewport = { themeColor: '#222222' };

const ABAS: { aba: FaxinaAba; rotulo: string }[] = [
  { aba: 'pendente', rotulo: 'Pendentes' },
  { aba: 'arquivado', rotulo: 'Arquivados' },
];

export default async function Faxina({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const aba: FaxinaAba = (await searchParams).aba === 'arquivado' ? 'arquivado' : 'pendente';
  const agora = Math.floor(Date.now() / 1000);
  let lista: FaxinaLista | null = null;
  try {
    lista = await fetchFaxina(aba);
  } catch {
    lista = null;
  }

  return (
    <AppShell palco="mesa">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="mx-auto flex w-full flex-col"
          style={{
            maxWidth: 'var(--ck-read-narrow)',
            gap: 'var(--ck-space-3)',
            paddingTop: 'calc(var(--ck-space-4) + var(--ck-safe-top))',
            paddingRight: 'calc(var(--ck-space-2) + var(--ck-safe-right))',
            paddingBottom: 'calc(var(--ck-space-6) + var(--ck-safe-bottom))',
            paddingLeft: 'calc(var(--ck-space-2) + var(--ck-safe-left))',
          }}
        >
          <header className="flex flex-col" style={{ gap: 'var(--ck-space-2)', padding: '0 var(--ck-space-3)' }}>
            <Link href="/" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>
              ← Cockpit
            </Link>
            <p
              style={{
                fontSize: 'var(--ck-text-lg)',
                letterSpacing: 'var(--ck-track-title)',
                color: 'var(--ck-text-primary)',
              }}
            >
              Faxina
            </p>
            <p className="ck-tabular" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
              {lista ? resumoDaTela(lista, agora) : 'não consegui ler a faxina agora'}
            </p>
            <nav className="flex self-start" style={{ ...TRILHO_DA_PASTILHA, gap: '2px' }}>
              {ABAS.map(({ aba: destino, rotulo }) => (
                <Link
                  key={destino}
                  href={`/faxina?aba=${destino}`}
                  className="flex items-center"
                  style={{
                    ...MIOLO_DA_PASTILHA,
                    background: destino === aba ? MIOLO_ACESO : 'transparent',
                    color: destino === aba ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
                  }}
                >
                  {rotulo}
                </Link>
              ))}
            </nav>
          </header>

          {lista && lista.itens.length === 0 ? (
            <p style={{ padding: 'var(--ck-space-3)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-tertiary)' }}>
              {aba === 'pendente' ? 'nada parado — a frota está em dia' : 'nada arquivado ainda'}
            </p>
          ) : null}

          {lista && lista.itens.length > 0 ? (
            <ul className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
              {lista.itens.map((item) => (
                <CartaoFaxina key={`${item.id}-${item.status}`} inicial={item} agora={agora} />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

function resumoDaTela({ resumo }: FaxinaLista, agora: number): string {
  const partes = [`${resumo.pendentes} pendentes`, `${resumo.arquivados} arquivados`];
  if (resumo.ultima_varredura != null) {
    const dias = Math.floor((agora - resumo.ultima_varredura) / 86400);
    partes.push(dias === 0 ? 'varrido hoje' : `varrido há ${dias} ${dias === 1 ? 'dia' : 'dias'}`);
  }
  return partes.join(' · ');
}
