'use client';

/**
 * "Em uso agora" — a conversa da linha, no topo do Histórico (direção A com o
 * cartão da C, F8). Carrega a Nova conversa (F10) e é onde aparece a espera
 * que voltou de um recarregar sem saber qual era a conversa pedida.
 *
 * Desligado, o cartão vira "Última em uso" e a Nova sai: a API recusa com 409
 * `desligado`, e o caminho é ligar pelo interruptor da gaveta.
 */
import type { ReactNode } from 'react';

import type { Conversa } from '@grupo_borges/cockpit-core/api';

import { contaTurnos } from './conversas';
import { Bloco, Cartao, Mais } from './pecas';

export function CartaoEmUso({
  atual,
  dePe,
  podeTrocar,
  acao,
  aoNova,
}: {
  atual: Conversa | null;
  dePe: boolean;
  podeTrocar: boolean;
  acao: ReactNode;
  aoNova: () => void;
}) {
  if (!atual && !acao && !dePe) return null;
  return (
    <Cartao titulo={dePe ? 'Em uso agora' : 'Última em uso'}>
      {atual ? (
        <Bloco>
          <span style={{ fontSize: 'var(--ck-text-base)', fontWeight: 500, color: 'var(--ck-text-primary)' }}>{atual.titulo}</span>
          {atual.nota ? (
            <span style={{ fontSize: 'var(--ck-text-sm)', lineHeight: 'var(--ck-leading-body)', color: 'var(--ck-text-secondary)' }}>{atual.nota}</span>
          ) : null}
          <span className="ck-tabular" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
            {contaTurnos(atual.turnos)}
          </span>
        </Bloco>
      ) : null}
      {acao ? <Bloco>{acao}</Bloco> : null}
      {!acao && dePe && podeTrocar ? (
        <button
          type="button"
          onClick={aoNova}
          className="ck-gv-tracejado ck-veil flex items-center justify-center"
          style={{ gap: 'var(--ck-space-3)', minHeight: '48px', borderRadius: 'var(--ck-gv-raio-bloco)', fontSize: 'var(--ck-text-sm)', fontWeight: 500, color: 'var(--ck-text-primary)' }}
        >
          <Mais /> Nova conversa
        </button>
      ) : null}
    </Cartao>
  );
}
