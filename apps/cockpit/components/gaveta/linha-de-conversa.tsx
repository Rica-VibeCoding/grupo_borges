'use client';

/**
 * Uma conversa da lista do Histórico — rodada 2 (Rica, 01/10): só título e
 * tempo. O toque abre a leitura; nota, ações e selos moram lá.
 *
 * O título é o mesmo elemento que vira o título da leitura (`layoutId`): ao
 * abrir ele sobe para o alto, ao voltar ele desce para a linha. A linha que
 * sai da lista (Concluída, 🗑, ⭐ tirada no filtro ⭐) some em opacity, e as de
 * baixo sobem por `layout`.
 */
import { forwardRef } from 'react';
import { motion } from 'motion/react';

import type { Conversa } from '@grupo_borges/cockpit-core/api';

import { tempoRelativo } from './conversas';
import { CALMA, ENTRADA, SAIDA } from './ritmo-do-historico';

export const idDoTitulo = (id: string) => `historico-titulo-${id}`;

export const LinhaDeConversa = forwardRef<
  HTMLButtonElement,
  { conversa: Conversa; agora: number; ordem: string; aoAbrir: () => void }
>(function LinhaDeConversa({ conversa, agora, ordem, aoAbrir }, ref) {
  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={aoAbrir}
      layout="position"
      layoutDependency={ordem}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: ENTRADA }}
      exit={{ opacity: 0, transition: SAIDA }}
      transition={CALMA}
      className="ck-veil flex w-full items-center text-left"
      style={{ gap: 'var(--ck-space-3)', minHeight: '52px', padding: '0 var(--ck-space-4)', borderRadius: 'var(--ck-gv-raio-bloco)' }}
    >
      <motion.span
        layoutId={idDoTitulo(conversa.id)}
        layoutDependency={ordem}
        transition={CALMA}
        className="min-w-0 flex-1 truncate"
        style={{ fontSize: 'var(--ck-text-base)', fontWeight: 500, color: 'var(--ck-text-primary)' }}
      >
        {conversa.titulo}
      </motion.span>
      <span className="ck-tabular shrink-0" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
        {tempoRelativo(conversa.atualizada_em, agora)}
      </span>
    </motion.button>
  );
});
