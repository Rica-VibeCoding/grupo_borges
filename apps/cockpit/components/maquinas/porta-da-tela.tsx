/**
 * A porta da tela do agente na linha do Chrome em Abertos: uma segunda linha com
 * as abas abertas à esquerda e a pílula "Ver tela" à direita, alinhada ao Fechar.
 * Só existe para Chrome que o catálogo da tela conhece pelo nome exato
 * (`mapaDeTelas`): rótulo desconhecido não ganha botão.
 *
 * Dono: Daniel (pele).
 */
import Link from 'next/link';

export function PortaDaTela({ href, rotulo, abas }: { href: string; rotulo: string; abas: string | null }) {
  return (
    <div className="flex items-center" style={{ gap: 'var(--ck-space-3)', paddingBottom: 'var(--ck-space-1)' }}>
      {/* No celular, só a contagem (como a linha fazia); de 640px para cima os títulos quebram, nunca cortam. */}
      <span className="min-w-0 flex-1 text-pretty" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
        <span className="sm:hidden">{abas?.split(':')[0]}</span>
        <span className="hidden sm:inline">{abas}</span>
      </span>
      <Link
        href={href}
        aria-label={`Ver tela: ${rotulo}`}
        className="ck-vps-botao flex shrink-0 items-center"
        style={{ minHeight: 'var(--ck-touch-min)', paddingInline: 'var(--ck-space-1)', marginInline: 'calc(var(--ck-space-1) * -1)' }}
      >
        <span
          className="ck-vps-pilula flex items-center"
          style={{
            minHeight: '32px',
            padding: '0 var(--ck-space-3)',
            borderRadius: 'var(--ck-radius-pill)',
            fontSize: 'var(--ck-text-sm)',
            fontWeight: 500,
            color: 'var(--ck-text-primary)',
          }}
        >
          Ver tela
        </span>
      </Link>
    </div>
  );
}
