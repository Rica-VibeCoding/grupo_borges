'use client';

/**
 * "Em uso agora" — a conversa da linha, no topo do Histórico (direção A com o
 * cartão da C, F8). Carrega a Nova conversa (F10) e é onde aparece a espera ou
 * o erro de uma troca cuja conversa não está aberta na leitura.
 *
 * Rodada 2: só título e turnos (a nota mora na leitura), e o cartão some com a
 * conversa de agora vazia (`mostraEmUso`). Nova no meio de um turno não
 * confirma: a linha de ocupado e o botão já dizem que interrompe.
 *
 * Desligado, o cartão vira "Última em uso" e a Nova sai: a API recusa com 409
 * `desligado`, e o caminho é ligar pelo interruptor da gaveta.
 */
import type { ReactNode } from 'react';

import type { Conversa } from '@grupo_borges/cockpit-core/api';

import { LinhaDeOcupado } from './acao-de-conversa';
import { linhaDeOcupado, textoDaTroca } from './acoes-de-conversa';
import { contaTurnos } from './conversas';
import { Bloco, Cartao, Mais } from './pecas';

export function CartaoEmUso({
  atual,
  dePe,
  podeTrocar,
  interrompe,
  nome,
  acao,
  aoNova,
  trocouAgora = null,
  voltar = null,
}: {
  atual: Conversa | null;
  dePe: boolean;
  podeTrocar: boolean;
  /** A Nova vai interromper um turno. */
  interrompe: boolean;
  nome: string;
  acao: ReactNode;
  aoNova: () => void;
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
      {!acao && !recemTrocada && dePe && podeTrocar ? (
        <>
          {interrompe ? <LinhaDeOcupado texto={linhaDeOcupado(nome)} /> : null}
          <button
            type="button"
            onClick={aoNova}
            className="ck-gv-tracejado ck-veil flex items-center justify-center"
            style={{
              gap: 'var(--ck-space-3)',
              minHeight: '48px',
              borderRadius: 'var(--ck-gv-raio-bloco)',
              fontSize: 'var(--ck-text-sm)',
              fontWeight: 500,
              color: interrompe ? 'var(--ck-state-attention)' : 'var(--ck-text-primary)',
              transition: 'color var(--ck-dur-calm) var(--ck-ease)',
            }}
          >
            <Mais /> {textoDaTroca('nova', interrompe)}
          </button>
        </>
      ) : null}
    </Cartao>
  );
}
