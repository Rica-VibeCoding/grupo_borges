import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { FormDaSenha } from '@/components/entrar/form-da-senha';
import { SairDoPainel } from '@/components/gaveta/sair-do-painel';
import { PECAS } from '@/lib/modo';
import { leSessao } from '@/lib/sessao-do-portao';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Senha' };

/**
 * A senha do painel do cliente. Só existe nesse modo (na frota quem autentica
 * é o Tailscale). Com a senha provisória (`trocar_senha` no `/auth/me`) é a
 * única tela que o cliente alcança: `exigeSessao` e `destinoDa` mandam tudo
 * para cá. Sem ela, é a troca que a gaveta abre.
 */
export default async function Senha() {
  if (!PECAS.sessaoDoPortao) notFound();
  const sessao = await leSessao();
  if (!sessao) redirect('/entrar');
  const destino = sessao.slug ? `/agente/${encodeURIComponent(sessao.slug)}` : '/entrar';

  return (
    <main
      className="flex flex-col items-center justify-center"
      style={{
        minHeight: '100dvh',
        gap: 'var(--ck-space-3)',
        padding: 'var(--ck-space-4)',
        paddingTop: 'calc(var(--ck-space-4) + var(--ck-safe-top))',
        paddingBottom: 'calc(var(--ck-space-4) + var(--ck-safe-bottom))',
        background: 'var(--ck-surface-canvas)',
      }}
    >
      <FormDaSenha primeiroAcesso={sessao.trocarSenha} usuario={sessao.usuario} destino={destino} />
      {/* No primeiro acesso não há gaveta: o Sair mora aqui, para quem entrou na conta errada. */}
      {sessao.trocarSenha ? (
        <div className="w-full" style={{ maxWidth: '380px' }}>
          <SairDoPainel usuario={sessao.usuario} />
        </div>
      ) : null}
    </main>
  );
}
