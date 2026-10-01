'use client';

/**
 * As peças de ação do Histórico (rodada 2): o botão de troca que passa de claro
 * a âmbar, a barra indeterminada da espera, a confirmação de uma linha do 🗑 e
 * o erro. Sem parágrafo de aviso e sem passos: o Rica bate o olho e age.
 */
import { motion, useReducedMotion } from 'motion/react';

import { CALMA, VOLTA_DA_BARRA } from './ritmo-do-historico';
import { Pilula } from './pecas';

const CAMADA = { position: 'absolute', inset: 0, borderRadius: 'inherit' } as const;

/** Continuar esta (ou Nova conversa). Claro parado; âmbar quando interrompe —
 *  as duas cores são camadas que trocam de opacidade, e os dois nomes também:
 *  o botão não muda de tamanho nem pinta cor animada (§9.4). */
export function BotaoDeTroca({ rotulo, rotuloInterrompe, interrompe, aoTocar }: { rotulo: string; rotuloInterrompe: string; interrompe: boolean; aoTocar: () => void }) {
  const nomes = [
    { texto: rotulo, ativo: !interrompe },
    { texto: rotuloInterrompe, ativo: interrompe },
  ];
  return (
    <button
      type="button"
      onClick={aoTocar}
      aria-label={interrompe ? rotuloInterrompe : rotulo}
      className="relative flex w-full shrink-0 items-center justify-center"
      style={{ minHeight: '52px', borderRadius: 'var(--ck-radius-pill)', fontSize: 'var(--ck-text-base)', fontWeight: 600, color: 'var(--ck-gv-fundo)' }}
    >
      <motion.span aria-hidden style={{ ...CAMADA, background: 'var(--ck-text-primary)' }} initial={false} animate={{ opacity: interrompe ? 0 : 1 }} transition={CALMA} />
      <motion.span aria-hidden style={{ ...CAMADA, background: 'var(--ck-state-attention)' }} initial={false} animate={{ opacity: interrompe ? 1 : 0 }} transition={CALMA} />
      <span aria-hidden className="relative grid">
        {nomes.map((n) => (
          <motion.span key={n.texto} style={{ gridArea: '1 / 1', textAlign: 'center' }} initial={false} animate={{ opacity: n.ativo ? 1 : 0 }} transition={CALMA}>
            {n.texto}
          </motion.span>
        ))}
      </span>
    </button>
  );
}

/** A linha de cima do botão âmbar: quem está trabalhando. Entra em fade, junto
 *  da cor do botão. */
export function LinhaDeOcupado({ texto }: { texto: string }) {
  return (
    <motion.p
      role="status"
      className="text-center"
      style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)', padding: 'var(--ck-space-1) 0' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={CALMA}
    >
      {texto}
    </motion.p>
  );
}

/** A espera da troca: a frase e uma barra indeterminada (a API não dá
 *  porcentagem). Com movimento reduzido, a barra fica parada no meio. */
export function BarraDeEspera({ texto }: { texto: string }) {
  const parado = useReducedMotion();
  return (
    <div role="status" aria-live="polite" className="flex flex-col" style={{ gap: 'var(--ck-space-3)', padding: 'var(--ck-space-3) var(--ck-space-1) var(--ck-space-4)' }}>
      <span style={{ fontSize: 'var(--ck-text-base)', fontWeight: 500, color: 'var(--ck-text-primary)' }}>{texto}</span>
      <div aria-hidden style={{ height: '6px', borderRadius: 'var(--ck-radius-pill)', background: 'var(--ck-gv-pilula)', overflow: 'hidden' }}>
        <motion.div
          style={{ width: '40%', height: '100%', borderRadius: 'inherit', background: 'var(--ck-text-primary)', marginLeft: parado ? '30%' : 0 }}
          initial={{ x: '-100%' }}
          animate={parado ? { x: 0 } : { x: ['-100%', '250%'] }}
          transition={parado ? { duration: 0 } : VOLTA_DA_BARRA}
        />
      </div>
    </div>
  );
}

/** O 🗑 confirma numa linha: o que acontece e os dois botões. */
export function ConfirmaExclusao({ indo, aoExcluir, aoCancelar }: { indo: boolean; aoExcluir: () => void; aoCancelar: () => void }) {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <p role="status" className="text-center" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>
        Vai para a lixeira do servidor e some da lista.
      </p>
      <div className="flex" style={{ gap: 'var(--ck-space-2)' }}>
        <Pilula aoTocar={aoCancelar}>Cancelar</Pilula>
        <Pilula aoTocar={indo ? () => {} : aoExcluir} ocupado={indo} cor="var(--ck-state-attention)">
          {indo ? 'Excluindo…' : 'Excluir'}
        </Pilula>
      </div>
    </div>
  );
}

/** Erro da troca ou da exclusão, com o caminho de volta. */
export function AvisoDeFalha({ texto, aoFechar }: { texto: string; aoFechar: () => void }) {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <p role="alert" style={{ fontSize: 'var(--ck-text-sm)', lineHeight: 'var(--ck-leading-body)', color: 'var(--ck-state-attention)' }}>
        {texto}
      </p>
      <div className="flex">
        <Pilula aoTocar={aoFechar}>Entendi</Pilula>
      </div>
    </div>
  );
}
