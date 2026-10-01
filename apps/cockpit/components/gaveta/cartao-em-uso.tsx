'use client';

/**
 * "Em uso agora" — a conversa da linha, no topo do Histórico (direção A com o
 * cartão da C, F8). É onde aparece a espera ou o erro de uma troca cuja
 * conversa não está aberta na leitura.
 *
 * Rodada 2: só título e turnos (a nota mora na leitura), e o cartão some com a
 * conversa de agora vazia (`mostraEmUso`). A Nova conversa saiu daqui para a
 * gaveta, ao lado da porta do Histórico (F16): um lugar só.
 *
 * Desligado, o cartão vira "Última em uso".
 */
import type { ReactNode } from 'react';

import type { Conversa } from '@grupo_borges/cockpit-core/api';

import { contaTurnos } from './conversas';
import { Bloco, Cartao } from './pecas';

export function CartaoEmUso({
  atual,
  dePe,
  acao,
  trocouAgora = null,
  voltar = null,
}: {
  atual: Conversa | null;
  dePe: boolean;
  acao: ReactNode;
  /** A troca que acabou de dar certo (F13): o cartão diz isso e mostra o
   *  caminho de volta ao chat — no celular, a gaveta cobre a conversa. */
  trocouAgora?: 'retomar' | 'nova' | null;
  voltar?: ReactNode;
}) {
  const recemTrocada = trocouAgora !== null && !acao;
  return (
    <Cartao
      titulo={dePe ? 'Em uso agora' : 'Última em uso'}
      direita={
        recemTrocada ? (
          <span role="status" style={{ fontSize: 'var(--ck-text-xs)', fontWeight: 500, color: 'var(--ck-state-ok)' }}>
            {trocouAgora === 'nova' ? '✓ Aberta agora' : '✓ Retomada agora'}
          </span>
        ) : undefined
      }
    >
      {atual && atual.turnos > 0 ? (
        <Bloco>
          <span style={{ fontSize: 'var(--ck-text-base)', fontWeight: 500, color: 'var(--ck-text-primary)' }}>{atual.titulo}</span>
          <span className="ck-tabular" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
            {contaTurnos(atual.turnos)}
          </span>
        </Bloco>
      ) : null}
      {acao ? <Bloco>{acao}</Bloco> : null}
      {recemTrocada ? voltar : null}
    </Cartao>
  );
}
