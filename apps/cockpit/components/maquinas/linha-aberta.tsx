/**
 * Uma coisa aberta na máquina, com o botão de fechar. Anatomia da tropa, duas
 * linhas: nome e memória; há quanto está parado e as abas, com a pílula curta
 * "Fechar" à direita — o rótulo exato do painel ("Fechar Chrome do Fluyt Com")
 * vai no nome acessível.
 *
 * O que pode ter trabalho sem salvar (`pede_confirmacao`, VS Code) confirma EM
 * LINHA, sem modal. Fechou: "Liberou 410 MB" no lugar do botão, o único
 * movimento da tela; a linha sai no próximo ciclo, quando o painel relista.
 * Falhou: o motivo do painel em `state-fail` e o botão volta.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { IconeVisto } from '@/components/shell/icones';
import { formataTamanho } from '@/components/shell/recursos-da-vps';
import { postFechar, textoDasAbas, textoDoParado, type ItemAberto } from '@/lib/maquinas';

type Fase = 'parado' | 'confirmando' | 'fechando';

/** A pílula do cartão da VPS ("processos"): alvo de 44px, desenho de 32. */
export function PilulaDaMaquina({
  children,
  aoTocar,
  perigo = false,
  ...resto
}: {
  children: ReactNode;
  aoTocar: () => void;
  /** A ação que derruba algo (o "Desligar Arsenal" confirmado): texto em `state-fail`. */
  perigo?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'>) {
  return (
    <button
      type="button"
      onClick={aoTocar}
      className="ck-vps-botao flex shrink-0 items-center"
      style={{
        minHeight: 'var(--ck-touch-min)',
        paddingInline: 'var(--ck-space-1)',
        marginInline: 'calc(var(--ck-space-1) * -1)',
        cursor: resto.disabled && !resto['aria-busy'] ? 'not-allowed' : undefined,
      }}
      {...resto}
    >
      <span
        className="ck-vps-pilula flex items-center"
        style={{
          minHeight: '32px',
          padding: '0 var(--ck-space-3)',
          borderRadius: 'var(--ck-radius-pill)',
          fontSize: 'var(--ck-text-sm)',
          fontWeight: 500,
          // Bloqueado (sem caminho, não ocupado) tem de parecer apagado: sem fundo, sem borda,
          // opacidade baixa — no print de 05/11 o contorno ainda parecia clicável (Pavan).
          background: resto.disabled ? 'transparent' : undefined,
          border: resto.disabled ? '1px solid transparent' : undefined,
          opacity: resto.disabled && !resto['aria-busy'] ? 0.4 : undefined,
          color: resto.disabled
            ? 'var(--ck-text-secondary)'
            : perigo
              ? 'var(--ck-state-fail)'
              : 'var(--ck-text-primary)',
        }}
      >
        {children}
      </span>
    </button>
  );
}

export function LinhaAberta({
  maquina,
  item,
  observadoDesde,
  agora,
  primeira,
  liberouMb,
  aoFechar,
}: {
  maquina: string;
  item: ItemAberto;
  observadoDesde: number;
  agora: number;
  primeira: boolean;
  /** Fechou há pouco: quanto liberou. Quem guarda é o painel (`liberados`). */
  liberouMb: number | null;
  aoFechar: (item: ItemAberto, mb: number) => void;
}) {
  const [fase, setFase] = useState<Fase>('parado');
  const [falha, setFalha] = useState<string | null>(null);

  async function fecha() {
    setFase('fechando');
    setFalha(null);
    try {
      const { liberou_mb } = await postFechar(maquina, item.id);
      aoFechar(item, liberou_mb);
    } catch (erro) {
      setFalha((erro as Error).message);
    } finally {
      setFase('parado');
    }
  }

  const parado = textoDoParado(item.parado_s, observadoDesde, agora);
  const abas = textoDasAbas(item.abas);
  const ocupado = fase === 'fechando';

  return (
    <li
      className="flex flex-col"
      style={{
        padding: 'var(--ck-space-2) 0 0',
        borderTop: primeira ? undefined : '1px solid var(--ck-edge-hairline)',
      }}
    >
      <div className="flex items-baseline" style={{ gap: 'var(--ck-space-3)' }}>
        <span className="min-w-0 truncate" style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-primary)' }}>
          {item.rotulo}
        </span>
        <span
          className="ck-tabular ml-auto shrink-0"
          style={{ fontSize: 'var(--ck-text-sm)', fontWeight: 500, color: 'var(--ck-text-primary)' }}
        >
          {formataTamanho(item.memoria_mb)}
        </span>
      </div>

      {/* 2ª linha: o detalhe à esquerda, a ação à direita. A confirmação e o
          "Liberou" entram no lugar da pílula, sem empurrar a lista. */}
      <div className="flex items-center" style={{ gap: 'var(--ck-space-3)', minHeight: 'var(--ck-touch-min)' }}>
        {fase === 'confirmando' ? (
          <span className="min-w-0 flex-1" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>
            Pode ter algo sem salvar.
          </span>
        ) : (
          <span
            className="ck-tabular flex min-w-0 flex-1"
            style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)', whiteSpace: 'nowrap' }}
          >
            {parado ? <span className="shrink-0">{parado}</span> : null}
            {parado && abas ? <span className="shrink-0">&nbsp;·&nbsp;</span> : null}
            {abas ? <span className="min-w-0 truncate">{abas}</span> : null}
          </span>
        )}

        <span className="flex shrink-0 items-center" style={{ gap: 'var(--ck-space-1)' }}>
          {/* A região viva recebe só o resultado; os botões ficam fora dela. */}
          <span
            role="status"
            className={liberouMb !== null ? 'ck-maquina-liberou ck-tabular flex items-center' : 'ck-tabular'}
            style={{
              gap: 'var(--ck-space-1)',
              fontSize: liberouMb !== null ? 'var(--ck-text-sm)' : 'var(--ck-text-xs)',
              fontWeight: liberouMb !== null ? 500 : undefined,
              color: liberouMb !== null ? 'var(--ck-state-ok)' : 'var(--ck-state-fail)',
            }}
          >
            {liberouMb !== null ? (
              <>
                <IconeVisto tamanho={16} className="shrink-0" />
                Liberou {formataTamanho(liberouMb)}
              </>
            ) : falha ? (
              `Não fechou: ${falha}`
            ) : null}
          </span>

          {liberouMb !== null || !item.acao_rotulo ? null : fase === 'confirmando' ? (
            <>
              <PilulaDaMaquina aria-label={item.acao_rotulo} aoTocar={() => void fecha()}>
                Fechar
              </PilulaDaMaquina>
              <button
                type="button"
                onClick={() => setFase('parado')}
                className="ck-veil"
                style={{
                  minHeight: 'var(--ck-touch-min)',
                  padding: '0 var(--ck-space-3)',
                  marginRight: 'calc(var(--ck-space-3) * -1)',
                  borderRadius: 'var(--ck-radius-pill)',
                  fontSize: 'var(--ck-text-sm)',
                  color: 'var(--ck-text-secondary)',
                }}
              >
                Cancelar
              </button>
            </>
          ) : (
            <PilulaDaMaquina
              aria-label={item.acao_rotulo}
              disabled={ocupado}
              aria-busy={ocupado}
              aoTocar={() => (item.pede_confirmacao ? setFase('confirmando') : void fecha())}
            >
              {ocupado ? 'Fechando…' : 'Fechar'}
            </PilulaDaMaquina>
          )}
        </span>
      </div>
    </li>
  );
}
