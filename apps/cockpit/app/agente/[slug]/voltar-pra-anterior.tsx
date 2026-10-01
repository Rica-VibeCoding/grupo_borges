'use client';

/**
 * "Voltar pra anterior" (F16, decisão 4 da rodada 2): na conversa nova vazia,
 * um atalho único que retoma a que acabou de sair — o desfazer de quem tocou
 * errado. Mora logo acima do composer, onde o polegar alcança, com o título da
 * anterior embaixo. Sem foto: a pílula no alto já mostra o agente.
 *
 * A anterior vem da lista (`anterior`, F14). O atalho some no primeiro turno
 * (a bolha otimista já conta), na troca em curso e quando a API diz `null`.
 * Fica montado e alterna `data-aberto` no `.ck-surge`: entra pelo gesto da
 * casa e sai em fade, em vez de sumir de estalo.
 *
 * O toque segue a régua do Continuar esta (`usa-troca-direta.ts`); a espera e
 * o marco são os do chat (F13).
 */
import { useEffect, useState } from 'react';
import { MotionConfig, motion } from 'motion/react';

import { fetchConversas } from '@grupo_borges/cockpit-core/api';
import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';

import { linhaDeOcupado } from '@/components/gaveta/acoes-de-conversa';
import { CALMA, TOQUE } from '@/components/gaveta/ritmo-do-historico';
import { usaTrocaDireta } from '@/components/gaveta/usa-troca-direta';

type Anterior = { id: string; titulo: string | null; vazia: boolean };

/** A lista diz qual é a anterior e se a de agora está vazia. Relida a cada
 *  troca que o stream avisa (`chave`). Falhou a leitura, o atalho não aparece. */
function usaAnterior(agentSlug: string, chave: string | null): Anterior | null {
  const [anterior, setAnterior] = useState<Anterior | null>(null);
  useEffect(() => {
    const controlador = new AbortController();
    fetchConversas(agentSlug, controlador.signal)
      .then((r) => {
        const id = r.suportado ? (r.anterior ?? null) : null;
        const atual = r.conversas.find((c) => c.atual) ?? null;
        setAnterior(id ? { id, titulo: r.conversas.find((c) => c.id === id)?.titulo ?? null, vazia: !atual || atual.turnos === 0 } : null);
      })
      .catch(() => {
        if (!controlador.signal.aborted) setAnterior(null);
      });
    return () => controlador.abort();
  }, [agentSlug, chave]);
  return anterior;
}

const CAMADA = { position: 'absolute', inset: 0, borderRadius: 'inherit' } as const;

/** Claro e âmbar trocam por opacidade, nunca por cor animada (§9.4). */
function Rotulos({ principal, titulo, cor, corTitulo, ativo }: { principal: string; titulo: string | null; cor: string; corTitulo: string; ativo: boolean }) {
  return (
    <motion.span aria-hidden={!ativo} className="flex min-w-0 flex-col items-center" style={{ gridArea: '1 / 1', gap: '2px' }} initial={false} animate={{ opacity: ativo ? 1 : 0 }} transition={CALMA}>
      <span style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600, color: cor }}>{principal}</span>
      {titulo ? <span className="max-w-full truncate" style={{ fontSize: 'var(--ck-text-sm)', color: corTitulo }}>{titulo}</span> : null}
    </motion.span>
  );
}

export function VoltarPraAnterior({
  agentSlug,
  nome,
  statusDaFrota,
  chave,
  temTurno,
  emTroca,
}: {
  agentSlug: string;
  nome: string;
  statusDaFrota: AgentStatus | null;
  /** Muda a cada troca concluída: a lista é relida. */
  chave: string | null;
  /** A conversa de agora já tem turno (ou bolha otimista). */
  temTurno: boolean;
  emTroca: boolean;
}) {
  const anterior = usaAnterior(agentSlug, chave);
  const troca = usaTrocaDireta(agentSlug, nome);
  // O último desenho fica guardado: o fade de saída ainda mostra o título.
  const [exibida, setExibida] = useState<Anterior | null>(null);
  useEffect(() => {
    if (anterior) setExibida(anterior);
  }, [anterior]);

  const aberto = anterior !== null && anterior.vazia && !temTurno && !emTroca;
  const trabalhando = statusDaFrota === 'trabalhando';
  const interrompe = trabalhando || troca.recusou;
  const falha = troca.estado.fase === 'falhou' ? troca.estado.texto : null;
  const enviando = troca.estado.fase === 'enviando';

  return (
    <MotionConfig reducedMotion="user">
      <div
        data-aberto={String(aberto)}
        aria-hidden={!aberto}
        className="ck-surge absolute inset-x-0 flex flex-col items-center"
        style={{
          bottom: 'calc(var(--ck-composer-altura, 88px) + var(--ck-space-2))',
          gap: 'var(--ck-space-2)',
          padding: '0 var(--ck-space-4)',
          zIndex: 'var(--ck-z-sticky)',
          pointerEvents: aberto ? undefined : 'none',
        }}
      >
        {interrompe ? (
          <motion.p
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={CALMA}
            style={{ margin: 0, fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)', textAlign: 'center' }}
          >
            {`${linhaDeOcupado(nome)}. Voltar interrompe.`}
          </motion.p>
        ) : null}
        {exibida ? (
          <motion.button
            type="button"
            disabled={!aberto}
            aria-busy={enviando}
            onClick={() =>
              troca.pede({
                tipo: 'retomar',
                alvo: exibida.id,
                alvoTitulo: exibida.titulo,
                interrompe: trabalhando,
                desligado: statusDaFrota === 'offline',
              })
            }
            className="relative flex flex-col items-center"
            style={{
              minWidth: 'min(300px, 100%)',
              maxWidth: '100%',
              padding: 'var(--ck-space-3) var(--ck-space-5)',
              borderRadius: 'var(--ck-radius-pill)',
            }}
            whileTap={{ scale: 0.97 }}
            transition={TOQUE}
          >
            <span aria-hidden style={{ ...CAMADA, background: 'var(--ck-surface-raised)' }} />
            <motion.span aria-hidden style={{ ...CAMADA, background: 'var(--ck-state-attention)' }} initial={false} animate={{ opacity: interrompe ? 1 : 0 }} transition={CALMA} />
            <span className="relative grid max-w-full">
              <Rotulos titulo={exibida.titulo} principal={enviando ? 'Voltando…' : 'Voltar pra anterior'} cor="var(--ck-text-primary)" corTitulo="var(--ck-text-secondary)" ativo={!interrompe} />
              <Rotulos titulo={exibida.titulo} principal={enviando ? 'Voltando…' : 'Interromper e voltar'} cor="var(--ck-surface-canvas)" corTitulo="var(--ck-surface-canvas)" ativo={interrompe} />
            </span>
          </motion.button>
        ) : null}
        {falha ? (
          <p role="alert" style={{ margin: 0, fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)', textAlign: 'center' }}>
            {falha}{' '}
            <button type="button" onClick={troca.larga} className="ck-veil" style={{ minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-2)', borderRadius: 'var(--ck-radius-chip)', color: 'var(--ck-text-primary)' }}>
              Entendi
            </button>
          </p>
        ) : null}
      </div>
    </MotionConfig>
  );
}
