import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { FormDeEntrada } from '@/components/entrar/form-de-entrada';
import { PECAS } from '@/lib/modo';
import { destinoDa, leSessao } from '@/lib/sessao-do-portao';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Entrar' };

/**
 * A porta do painel do cliente. Só existe nesse modo: na frota quem autentica
 * é o Tailscale, e `/entrar` é 404. Quem já tem sessão não vê a porta — vai
 * direto ao agente dele.
 */
export default async function Entrar() {
  if (!PECAS.sessaoDoPortao) notFound();
  const sessao = await leSessao();
  if (sessao?.slug) redirect(destinoDa(sessao));

  return (
    <main
      className="flex flex-col items-center justify-center"
      style={{
        minHeight: '100dvh',
        padding: 'var(--ck-space-4)',
        paddingTop: 'calc(var(--ck-space-4) + var(--ck-safe-top))',
        paddingBottom: 'calc(var(--ck-space-4) + var(--ck-safe-bottom))',
        background: 'var(--ck-surface-canvas)',
      }}
    >
      <FormDeEntrada />
    </main>
  );
}
