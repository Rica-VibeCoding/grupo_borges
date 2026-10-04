/**
 * As peças dos formulários do portão (entrar, senha), na gramática da gaveta
 * (estética §8): cartão grafite sobre o palco, campos no preto do bloco com
 * 16px de texto — o piso do Safari contra o zoom no foco — e a ação principal
 * no azul do painel.
 */
import type { CSSProperties } from 'react';

export const CARTAO_DO_PORTAO: CSSProperties = {
  maxWidth: '380px',
  gap: 'var(--ck-space-4)',
  padding: 'var(--ck-space-5) var(--ck-space-4) var(--ck-space-4)',
  borderRadius: 'var(--ck-gv-raio-cartao)',
  background: 'var(--ck-gv-camada)',
};

export const TITULO_DO_PORTAO: CSSProperties = { fontSize: 'var(--ck-text-lg)', fontWeight: 600, color: 'var(--ck-text-primary)' };

export function botaoDoPortao(enviando: boolean): CSSProperties {
  return {
    minHeight: '48px',
    borderRadius: 'var(--ck-gv-raio-bloco)',
    fontSize: 'var(--ck-text-sm)',
    fontWeight: 600,
    background: 'var(--ck-gv-ativo)',
    color: 'var(--ck-text-primary)',
    opacity: enviando ? 0.7 : 1,
    transition: 'opacity var(--ck-dur-fast) var(--ck-ease)',
  };
}

export function ErroDoPortao({ erro }: { erro: string | null }) {
  return erro ? (
    <p role="alert" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)' }}>
      {erro}
    </p>
  ) : null;
}

const CAMPO = {
  minHeight: 'var(--ck-touch-min)',
  padding: '0 var(--ck-space-3)',
  borderRadius: 'var(--ck-gv-raio-bloco)',
  border: '1px solid var(--ck-edge-functional)',
  background: 'var(--ck-gv-bloco)',
  color: 'var(--ck-text-primary)',
  fontSize: 'var(--ck-text-md)', // 16px: piso do Safari contra o zoom no foco
} as const;

const ROTULO = { fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' } as const;

export function Campo({
  nome,
  rotulo,
  tipo,
  autoComplete,
  inicial = '',
  dica,
}: {
  nome: string;
  rotulo: string;
  tipo: string;
  autoComplete: string;
  inicial?: string;
  /** Regra do campo, dita antes de errar (lida pelo leitor de tela também). */
  dica?: string;
}) {
  return (
    <label className="flex flex-col" style={{ gap: 'var(--ck-space-1)' }}>
      <span style={ROTULO}>{rotulo}</span>
      <input
        name={nome}
        type={tipo}
        defaultValue={inicial}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        aria-describedby={dica ? `${nome}-dica` : undefined}
        // Foco sem anel colorido (estética §9.17): a própria borda clareia.
        className="ck-campo outline-none focus-visible:[border-color:var(--ck-edge-composer-foco)]"
        style={CAMPO}
      />
      {dica ? (
        <span id={`${nome}-dica`} style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
          {dica}
        </span>
      ) : null}
    </label>
  );
}
