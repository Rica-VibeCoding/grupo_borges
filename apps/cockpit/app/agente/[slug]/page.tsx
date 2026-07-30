import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import { AppShell } from '@/components/shell/app-shell';

export const dynamic = 'force-dynamic';

// Rota, não estado: é isto que faz deep-link do Telegram, refresh e botão voltar
// do Android funcionarem. Em Next 16 `params` é Promise.
export default async function AgentePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const fleet = await fetchFleet();
  const agente = fleet.agents.find((a) => a.slug === slug);

  if (!agente) notFound();

  return (
    <AppShell
      nav={
        <nav style={{ padding: 'var(--ck-space-3)' }}>
          <Link
            href="/"
            style={{
              color: 'var(--ck-text-secondary)',
              fontSize: 'var(--ck-text-sm)',
              minHeight: 'var(--ck-touch-min)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            ← Tropa
          </Link>
        </nav>
      }
      drawer={
        <div style={{ padding: 'var(--ck-space-4)' }}>
          {/* secondary, não tertiary: label de 12px precisa de 4.5:1 e tertiary
              dá 3.55:1 (contrato §2.2 e §3). */}
          <p style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
            GAVETA
          </p>
        </div>
      }
    >
      <div className="flex min-h-dvh flex-col">
        <header
          className="ck-lit flex shrink-0 items-center gap-2 border-b"
          style={{
            padding: 'var(--ck-space-3) var(--ck-space-4)',
            background: 'var(--ck-surface-nav)',
            borderColor: 'var(--ck-edge-hairline)',
            position: 'sticky',
            top: 0,
            zIndex: 'var(--ck-z-sticky)',
          }}
        >
          <span aria-hidden>{agente.emoji ?? '•'}</span>
          <span style={{ fontSize: 'var(--ck-text-lg)', color: 'var(--ck-text-primary)' }}>
            {agente.name}
          </span>
          <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
            {agente.role}
          </span>
        </header>

        {/* Coluna de leitura por container query: a coluna não sabe o tamanho da
            tela, só o do espaço que recebeu. As medidas do ChatGPT são de
            desktop — no celular a escada desce sozinha. */}
        <div className="flex-1 overflow-y-auto" style={{ containerType: 'inline-size' }}>
          <div
            className="mx-auto"
            style={{
              maxWidth: 'var(--ck-read-wide)',
              padding: 'var(--ck-space-5) var(--ck-space-4)',
            }}
          >
            <p style={{ color: 'var(--ck-text-secondary)' }}>
              Feed do chat entra aqui — decidido no spike do passo 5.
            </p>
          </div>
        </div>

        <div
          className="shrink-0"
          style={{
            padding: 'var(--ck-space-3) var(--ck-space-4)',
            paddingBottom: 'calc(var(--ck-space-3) + var(--ck-safe-bottom))',
          }}
        >
          <div
            className="ck-lit mx-auto flex items-center border"
            style={{
              maxWidth: 'var(--ck-w-composer)',
              minHeight: 'var(--ck-h-composer)',
              padding: '0 var(--ck-space-3)',
              background: 'var(--ck-surface-composer)',
              borderColor: 'var(--ck-edge-functional)',
              borderRadius: 'var(--ck-radius-frame)',
              // 16px é piso, não estética: abaixo disso o Safari dá zoom ao focar
              // o campo e o layout inteiro salta.
              fontSize: 'var(--ck-text-md)',
              // secondary e não tertiary, mesmo sendo stub: o contrato limita
              // tertiary a ícone/separador/texto ≥20px, e padrão copiado de stub
              // é como token errado se espalha.
              color: 'var(--ck-text-secondary)',
            }}
          >
            Composer — passo 5
          </div>
        </div>
      </div>
    </AppShell>
  );
}
