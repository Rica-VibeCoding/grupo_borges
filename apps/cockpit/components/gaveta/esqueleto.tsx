'use client';

/**
 * Linhas-esqueleto do Histórico: enquanto o dado não volta, a altura que ele
 * vai ocupar já está reservada (§8, "carga sem pulo"), e as barras respiram em
 * opacity. O conteúdo entra por cima num fade.
 */
import { motion } from 'motion/react';

import { RESPIRO_DO_ESQUELETO } from './ritmo-do-historico';

export function BarraEsqueleto({ largura, altura = '12px' }: { largura: string; altura?: string }) {
  return (
    <motion.span
      aria-hidden
      className="block"
      style={{ width: largura, height: altura, borderRadius: 'var(--ck-radius-pill)', background: 'var(--ck-gv-pilula)' }}
      initial={{ opacity: 0.45 }}
      animate={{ opacity: [0.45, 0.9, 0.45] }}
      transition={RESPIRO_DO_ESQUELETO}
    />
  );
}

/** Larguras variadas para o esqueleto não parecer grade. */
const TITULOS = ['72%', '58%', '80%', '64%', '50%', '76%', '60%', '68%'];

/** A lista carregando: oito linhas do tamanho das de verdade (52px). */
export function ListaEsqueleto() {
  return (
    <div role="status" aria-label="Lendo as conversas" className="flex flex-col">
      {TITULOS.map((largura, i) => (
        <div key={i} className="flex items-center" style={{ gap: 'var(--ck-space-3)', minHeight: '52px', padding: '0 var(--ck-space-4)' }}>
          <span className="flex-1">
            <BarraEsqueleto largura={largura} altura="14px" />
          </span>
          <BarraEsqueleto largura="28px" />
        </div>
      ))}
    </div>
  );
}

/** As mensagens da leitura carregando: um balão à direita, texto corrido à esquerda. */
export function MensagensEsqueleto() {
  return (
    <div role="status" aria-label="Lendo as mensagens" className="flex flex-col" style={{ gap: 'var(--ck-space-4)' }}>
      <span className="flex justify-end">
        <BarraEsqueleto largura="60%" altura="36px" />
      </span>
      <span className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
        <BarraEsqueleto largura="95%" />
        <BarraEsqueleto largura="88%" />
        <BarraEsqueleto largura="54%" />
      </span>
      <span className="flex justify-end">
        <BarraEsqueleto largura="44%" altura="36px" />
      </span>
      <span className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
        <BarraEsqueleto largura="90%" />
        <BarraEsqueleto largura="40%" />
      </span>
    </div>
  );
}
