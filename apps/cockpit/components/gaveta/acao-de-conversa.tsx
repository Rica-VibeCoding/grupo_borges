'use client';

/**
 * As peças de ação do Histórico (rodada 2): o botão de troca que enche por
 * dentro enquanto espera, a barra da espera fora dele, a confirmação de uma linha do 🗑 e o erro. Sem
 * parágrafo de aviso e sem passos: o Rica bate o olho e age.
 */
import { motion, useReducedMotion } from 'motion/react';

import { CALMA, VOLTA_DA_BARRA } from './ritmo-do-historico';
import { Pilula } from './pecas';

const CAMADA = { position: 'absolute', inset: 0, borderRadius: 'inherit' } as const;

/** Onde a troca está, do toque ao fim. Cada etapa da API tem um teto no
 *  botão e o tempo típico dela: o cheio anda dentro da etapa desacelerando
 *  até o teto e só passa dele quando a API avança (o Rica, 02/10: a barra
 *  corria a 85% e parava, sem relação com o que acontecia). Estacionar é a
 *  etapa longa — o agente escreve o recado da que sai. */
export type EtapaDoCheio = 'pedindo' | 'estacionando' | 'religando' | 'conferindo';
const MARCOS: Record<EtapaDoCheio, { ate: number; s: number }> = {
  pedindo: { ate: 0.12, s: 1.5 },
  estacionando: { ate: 0.6, s: 25 },
  religando: { ate: 0.88, s: 8 },
  conferindo: { ate: 0.97, s: 4 },
};
const DESACELERA = [0, 0, 0.2, 1] as const;

/** O que enche o botão tocado (pedido do Rica, 02/10, no gesto da barra do
 *  `/compact`): o cheio entra da esquerda inteiro (`translateX`), então a ponta
 *  segue redonda, e um brilho fraco atravessa enquanto espera. A `tinta` é a
 *  cor do texto do botão diluída, nunca cor de estado. Com movimento reduzido,
 *  só o cheio, sem o brilho. */
export function Enchendo({ etapa, tinta }: { etapa: EtapaDoCheio | null; tinta: string }) {
  const parada = useReducedMotion();
  const cor = `color-mix(in oklab, ${tinta} 14%, transparent)`;
  const marco = etapa ? MARCOS[etapa] : null;
  return (
    <motion.span
      aria-hidden
      style={{ ...CAMADA, overflow: 'hidden', background: cor }}
      initial={false}
      animate={marco ? { x: `${(marco.ate - 1) * 100}%`, opacity: 1 } : { x: '-100%', opacity: 0 }}
      transition={marco ? { duration: marco.s, ease: DESACELERA } : CALMA}
    >
      {marco && !parada ? (
        <motion.span
          style={{ ...CAMADA, background: `linear-gradient(100deg, transparent 30%, ${cor} 50%, transparent 70%)` }}
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity }}
        />
      ) : null}
    </motion.span>
  );
}

/** Continuar esta. Mantém a cor tocado ou ocupado (o Rica tirou o âmbar e a
 *  linha de cima em 02/10: empurravam a fileira); ocupado, só o nome vira o de
 *  interromper. Na espera, o nome é o que está acontecendo e o botão enche. */
export function BotaoDeTroca({ rotulo, rotuloInterrompe, interrompe, espera, etapa = null, aoTocar }: { rotulo: string; rotuloInterrompe: string; interrompe: boolean; espera: string | null; etapa?: EtapaDoCheio | null; aoTocar: () => void }) {
  const nome = espera ?? (interrompe ? rotuloInterrompe : rotulo);
  return (
    <button
      type="button"
      onClick={espera ? undefined : aoTocar}
      aria-busy={espera !== null}
      aria-label={nome}
      className="relative flex w-full shrink-0 items-center justify-center overflow-hidden"
      style={{ minHeight: '52px', borderRadius: 'var(--ck-radius-pill)', fontSize: 'var(--ck-text-base)', fontWeight: 600, color: 'var(--ck-gv-fundo)' }}
    >
      <span aria-hidden style={{ ...CAMADA, background: 'var(--ck-text-primary)' }} />
      <Enchendo etapa={espera !== null ? (etapa ?? 'pedindo') : null} tinta="var(--ck-gv-fundo)" />
      <span aria-hidden className="relative">
        {nome}
      </span>
    </button>
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
