'use client';

/**
 * As peças da gaveta do zero — a gramática da referência ACI (01/10):
 * cartão grafite, bloco preto dentro dele, pílula cinza, interruptor com
 * rótulo de estado, área tracejada com "+", bolinha vermelha de alerta.
 * Nenhuma cor aqui: tudo vem dos tokens `--ck-gv-*` (§G do `globals.css`).
 */
import type { CSSProperties, ReactNode } from 'react';

export function Cartao({
  titulo,
  direita,
  children,
  rotulo,
}: {
  titulo?: string;
  direita?: ReactNode;
  children: ReactNode;
  rotulo?: string;
}) {
  return (
    <section
      aria-label={rotulo ?? titulo}
      className="flex shrink-0 flex-col"
      style={{
        gap: 'var(--ck-space-3)',
        padding: 'var(--ck-space-4)',
        borderRadius: 'var(--ck-gv-raio-cartao)',
        background: 'var(--ck-gv-camada)',
      }}
    >
      {titulo || direita ? (
        <div className="flex items-center justify-between" style={{ gap: 'var(--ck-space-2)', minHeight: '28px' }}>
          {titulo ? (
            <h3 style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>
              {titulo}
            </h3>
          ) : <span />}
          {direita}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** O bloco preto DENTRO do cartão. `cru` tira o respiro para quem já traz o
 *  seu (os blocos herdados do `shell/`, que têm padding próprio). */
export function Bloco({ children, cru = false, style }: { children: ReactNode; cru?: boolean; style?: CSSProperties }) {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 'var(--ck-space-2)',
        padding: cru ? 0 : 'var(--ck-space-4)',
        borderRadius: 'var(--ck-gv-raio-bloco)',
        background: 'var(--ck-gv-bloco)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Interruptor com a PALAVRA do estado ao lado — cor nunca carrega o
 *  significado sozinha (§9.7): "Ativo"/"Desligado" muda junto com o azul. */
export function Interruptor({
  ligado,
  armado = false,
  rotulo,
  descricao,
  ocupado = false,
  desabilitado = false,
  aoAlternar,
}: {
  ligado: boolean;
  armado?: boolean;
  rotulo: string;
  descricao: string;
  ocupado?: boolean;
  desabilitado?: boolean;
  aoAlternar: () => void;
}) {
  const corDoRotulo = armado
    ? 'var(--ck-state-attention)'
    : ligado
      ? 'var(--ck-gv-ativo-texto)'
      : 'var(--ck-text-secondary)';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-busy={ocupado}
      aria-label={descricao}
      disabled={desabilitado}
      onClick={aoAlternar}
      className="flex items-center"
      style={{
        gap: 'var(--ck-space-2)',
        minHeight: 'var(--ck-touch-min)',
        marginRight: 'calc(var(--ck-space-1) * -1)',
        padding: '0 var(--ck-space-1)',
        opacity: desabilitado ? 0.5 : 1,
      }}
    >
      <span style={{ fontSize: 'var(--ck-text-sm)', fontWeight: 500, color: corDoRotulo, whiteSpace: 'nowrap' }}>
        {rotulo}
      </span>
      <span
        aria-hidden
        className="ck-gv-trilho relative inline-flex shrink-0 items-center"
        data-ligado={String(ligado)}
        data-armado={String(armado)}
        style={{ width: '42px', height: '24px', borderRadius: 'var(--ck-radius-pill)', padding: '3px' }}
      >
        <span className="ck-gv-botao-trilho block rounded-full" style={{ width: '18px', height: '18px' }} />
      </span>
    </button>
  );
}

/** Pílula cinza-escura — o botão de ação da referência (Delete/Skip/Edit). */
export function Pilula({
  children,
  aoTocar,
  descricao,
  cor,
  ocupado = false,
}: {
  children: ReactNode;
  aoTocar: () => void;
  descricao?: string;
  cor?: string;
  ocupado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={aoTocar}
      aria-label={descricao}
      aria-busy={ocupado}
      className="ck-gv-pilula ck-veil flex flex-1 items-center justify-center overflow-hidden"
      style={{
        gap: 'var(--ck-space-2)',
        minHeight: 'var(--ck-touch-min)',
        padding: '0 var(--ck-space-4)',
        borderRadius: 'var(--ck-radius-pill)',
        fontSize: 'var(--ck-text-sm)',
        whiteSpace: 'nowrap',
        color: cor ?? 'var(--ck-text-primary)',
        transition: 'color var(--ck-dur-fast) var(--ck-ease)',
      }}
    >
      {children}
    </button>
  );
}

/** A bolinha vermelha com "!" — alerta que pede olho, como o cartão vencido
 *  da referência. Sempre acompanhada de texto em algum lugar da gaveta. */
export function BolinhaDeAlerta({ style }: { style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className="absolute flex items-center justify-center rounded-full"
      style={{
        width: '20px',
        height: '20px',
        fontSize: 'var(--ck-text-xs)',
        fontWeight: 700,
        background: 'var(--ck-gv-alerta)',
        color: 'var(--ck-gv-alerta-texto)',
        boxShadow: '0 0 0 3px var(--ck-gv-fundo)',
        ...style,
      }}
    >
      !
    </span>
  );
}

/** O "+" redondo da área tracejada e dos rótulos de seção. */
export function Mais() {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: '28px',
        height: '28px',
        background: 'var(--ck-gv-fundo)',
        color: 'var(--ck-text-primary)',
        fontSize: 'var(--ck-text-lg)',
        lineHeight: 1,
      }}
    >
      +
    </span>
  );
}
