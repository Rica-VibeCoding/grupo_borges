import Link from 'next/link';

/**
 * 404 — chega aqui quem digitou um slug que não existe em `/agente/[slug]`.
 *
 * Sem isto o Next serve a própria tela: fundo branco, em inglês, com a fonte do
 * sistema. Num tema escuro é um flash de tela branca no escuro do celular.
 *
 * A copy diz o que houve e oferece a saída, sem pedir desculpa e sem enfeite —
 * ilustração genérica de erro é a assinatura do mequetrefe.
 */
export default function NaoEncontrado() {
  return (
    <main
      className="flex flex-col items-center justify-center text-center"
      style={{
        minHeight: '100dvh',
        gap: 'var(--ck-space-3)',
        padding: 'var(--ck-space-6)',
        paddingTop: 'calc(var(--ck-space-6) + var(--ck-safe-top))',
        paddingBottom: 'calc(var(--ck-space-6) + var(--ck-safe-bottom))',
        background: 'var(--ck-surface-canvas)',
      }}
    >
      <p
        style={{
          fontSize: 'var(--ck-text-hero)',
          lineHeight: 'var(--ck-leading-hero)',
          letterSpacing: 'var(--ck-track-hero)',
          color: 'var(--ck-text-primary)',
        }}
      >
        Esse agente não está na frota
      </p>
      <p style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-secondary)' }}>
        O endereço aponta pra alguém que não existe, ou que saiu da frota.
      </p>
      <Link
        href="/"
        className="ck-veil flex items-center justify-center border"
        style={{
          marginTop: 'var(--ck-space-2)',
          minHeight: 'var(--ck-touch-min)',
          padding: '0 var(--ck-space-4)',
          background: 'var(--ck-surface-raised)',
          borderColor: 'var(--ck-edge-functional)',
          borderRadius: 'var(--ck-radius-chip)',
          fontSize: 'var(--ck-text-base)',
          color: 'var(--ck-text-primary)',
        }}
      >
        Ver a tropa
      </Link>
    </main>
  );
}
