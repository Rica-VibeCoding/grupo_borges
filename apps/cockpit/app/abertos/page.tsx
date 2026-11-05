import type { Viewport } from 'next';
import Link from 'next/link';

import { PainelDaMaquina } from '@/components/maquinas/painel-da-maquina';
import { PainelLocal } from '@/components/maquinas/painel-local';
import { AppShell } from '@/components/shell/app-shell';
import { MIOLO_ACESO, MIOLO_DA_PASTILHA, TRILHO_DA_PASTILHA } from '@/components/shell/pastilha-do-chrome';
import { maquinasDaCasa, type MaquinaDaCasa } from '@/lib/linhas-das-maquinas';
import { fetchMaquinas, fetchNomeLocal } from '@/lib/maquinas';

// Abertos — o que está aberto em cada máquina da casa, quanto ela aguenta agora
// e o botão de fechar o que sobra. A tela se chama pelo que faz (Rica, 05/11). Mesma casca da Faxina (`palco="mesa"`,
// coluna de leitura). A aba mora na URL (`?m=`), pela regra 1 do `app-shell.tsx`;
// a lista de abas vem da API, que é quem sabe quais máquinas existem — as
// remotas (com Fechar) e a local, que o cockpit mede e que é só leitura.
export const dynamic = 'force-dynamic';

export const viewport: Viewport = { themeColor: '#222222' };

export default async function Abertos({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const pedida = (await searchParams).m;
  const [remotas, nomeLocal] = await Promise.all([
    fetchMaquinas().catch(() => null),
    fetchNomeLocal().catch(() => null),
  ]);
  const maquinas: MaquinaDaCasa[] | null =
    remotas === null && nomeLocal === null ? null : maquinasDaCasa(nomeLocal, remotas ?? []);
  const atual = maquinas?.find((m) => m.id === pedida) ?? maquinas?.[0] ?? null;

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
            {/* Alvo de 44px com o mesmo desenho do link da Faxina. */}
            <Link
              href="/"
              className="inline-flex items-center self-start"
              style={{
                minHeight: 'var(--ck-touch-min)',
                marginBlock: 'calc((var(--ck-touch-min) - 1lh) / -2)',
                fontSize: 'var(--ck-text-xs)',
                color: 'var(--ck-text-secondary)',
              }}
            >
              ← Cockpit
            </Link>
            <h1
              style={{
                fontSize: 'var(--ck-text-lg)',
                fontWeight: 400,
                letterSpacing: 'var(--ck-track-title)',
                color: 'var(--ck-text-primary)',
              }}
            >
              Abertos
            </h1>
            {/* Abas só com duas máquinas ou mais; com uma, o nome mora no cartão. */}
            {maquinas && maquinas.length > 1 ? (
              <nav aria-label="Escolher máquina" className="flex self-start" style={{ ...TRILHO_DA_PASTILHA, gap: '2px' }}>
                {maquinas.map((m) => (
                  <Link
                    key={m.id}
                    href={`/abertos?m=${encodeURIComponent(m.id)}`}
                    aria-current={m.id === atual?.id ? 'page' : undefined}
                    className="flex items-center"
                    style={{
                      ...MIOLO_DA_PASTILHA,
                      background: m.id === atual?.id ? MIOLO_ACESO : 'transparent',
                      color: m.id === atual?.id ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
                    }}
                  >
                    {m.nome}
                  </Link>
                ))}
              </nav>
            ) : maquinas && remotas !== null ? null : (
              <p style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
                {maquinas
                  ? 'Não consegui ler as outras máquinas agora. Recarregue a página para tentar de novo.'
                  : 'Não consegui ler a lista de máquinas agora. Recarregue a página para tentar de novo.'}
              </p>
            )}
          </header>

          {/* `key`: trocar de aba começa a leitura do zero, sem número da outra máquina. */}
          {atual?.local ? (
            <PainelLocal key={atual.id} nome={atual.nome} nomeNoCartao={maquinas?.length === 1} />
          ) : atual ? (
            <PainelDaMaquina key={atual.id} id={atual.id} nome={atual.nome} nomeNoCartao={maquinas?.length === 1} />
          ) : maquinas && maquinas.length === 0 ? (
            <p style={{ padding: '0 var(--ck-space-3)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
              Nenhuma máquina cadastrada.
            </p>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
