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
import { useEffect, useRef, useState, type RefObject } from 'react';
import { MotionConfig, motion } from 'motion/react';

import { fetchConversaLeitura, fetchConversas } from '@grupo_borges/cockpit-core/api';
import type { AgentStatus } from '@grupo_borges/cockpit-core/cockpit-types';
import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

import { linhaDeOcupado } from '@/components/gaveta/acoes-de-conversa';
import { CALMA, TOQUE } from '@/components/gaveta/ritmo-do-historico';
import { usaTrocaDireta } from '@/components/gaveta/usa-troca-direta';
import { temPrimeiroTurno, type ConversaTrocada } from '@/lib/conversa-trocada';

type Anterior = { id: string; titulo: string | null; vazia: boolean; lidaEm: number };

/** A lista diz qual é a anterior e se a de agora está vazia. Relida a cada
 *  troca que o stream avisa e a cada passo da espera (`chave`): a troca que
 *  falha no meio não avisa o stream, mas a conversa nova pode ter nascido.
 *  Falhou a leitura, o atalho não aparece. */
function usaAnterior(agentSlug: string, chave: string): Anterior | null {
  const [anterior, setAnterior] = useState<Anterior | null>(null);
  useEffect(() => {
    const controlador = new AbortController();
    const lidaEm = Date.now();
    fetchConversas(agentSlug, controlador.signal)
      .then((r) => {
        const id = r.suportado ? (r.anterior ?? null) : null;
        const atual = r.conversas.find((c) => c.atual) ?? null;
        const titulo = id ? (r.conversas.find((c) => c.id === id)?.titulo ?? null) : null;
        const vazia = !atual || atual.turnos === 0;
        // Relida ainda vazia, vale a primeira hora: o turno que o banco não contou
        // ainda não pode virar "antes" e trazer o atalho de volta.
        setAnterior((a) => (id ? { id, titulo: titulo ?? (a?.id === id ? a.titulo : null), vazia, lidaEm: a?.id === id && a.vazia && vazia ? a.lidaEm : lidaEm } : null));
        // A anterior fora de *Todas* (curta ou concluída): o título vem da leitura dela.
        if (!id || titulo !== null) return;
        fetchConversaLeitura(agentSlug, id, controlador.signal)
          .then((l) => setAnterior((a) => (a?.id === id ? { ...a, titulo: l.titulo } : a)))
          .catch(() => {});
      })
      .catch(() => {
        if (!controlador.signal.aborted) setAnterior(null);
      });
    return () => controlador.abort();
  }, [agentSlug, chave]);
  return anterior;
}

/** Aberto, o atalho reserva o lugar dele no fim do feed (F18): sem isso ele
 *  flutuava por cima da última mensagem e as letras se sobrepunham. Publica a
 *  própria altura no palco (`--ck-atalho-reserva`, somada ao respiro do
 *  composer) e, se o feed estava colado no fim, o mantém colado — a reserva
 *  cresce o fim da rolagem sem render do feed, que não veria a mudança. */
function usaReserva(alvo: RefObject<HTMLDivElement | null>, aberto: boolean) {
  useEffect(() => {
    const el = alvo.current;
    const palco = el?.closest<HTMLElement>('.ck-palco');
    if (!el || !palco) return;
    const publica = (altura: number) => {
      const rola = palco.querySelector<HTMLElement>('[data-gate-messages]');
      const colado = rola ? rola.scrollHeight - rola.scrollTop - rola.clientHeight < 4 : false;
      palco.style.setProperty('--ck-atalho-reserva', aberto ? `calc(${Math.ceil(altura)}px + var(--ck-space-2))` : '0px');
      if (rola && colado) rola.scrollTop = rola.scrollHeight;
    };
    publica(el.getBoundingClientRect().height);
    if (!aberto) return;
    const observador = new ResizeObserver(([entrada]) => {
      if (entrada) publica(entrada.borderBoxSize?.[0]?.blockSize ?? entrada.contentRect.height);
    });
    observador.observe(el);
    return () => {
      observador.disconnect();
      palco.style.setProperty('--ck-atalho-reserva', '0px');
    };
  }, [alvo, aberto]);
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
  mensagens,
  marco,
  pendente,
  emTroca,
}: {
  agentSlug: string;
  nome: string;
  statusDaFrota: AgentStatus | null;
  /** Muda a cada troca e a cada passo da espera: a lista é relida. */
  chave: string;
  mensagens: readonly MessagePayload[];
  marco: ConversaTrocada | null;
  /** Há bolha otimista (texto ou anexo) saindo. */
  pendente: boolean;
  /** Troca andando ou esperando o stream. A que falhou não conta: com erro,
   *  o atalho aparece do mesmo jeito se a nova nasceu vazia. */
  emTroca: boolean;
}) {
  const anterior = usaAnterior(agentSlug, chave);
  const troca = usaTrocaDireta(agentSlug, nome);
  // O último desenho fica guardado: o fade de saída ainda mostra o título.
  const [exibida, setExibida] = useState<Anterior | null>(null);
  useEffect(() => {
    if (anterior) setExibida(anterior);
  }, [anterior]);

  // Primeiro turno: depois do marco, ou — sem ele — depois de a lista ver a conversa vazia.
  const temTurno = pendente || (anterior !== null && temPrimeiroTurno(mensagens, marco ?? { emMs: anterior.lidaEm }));
  const aberto = anterior !== null && anterior.vazia && !temTurno && !emTroca;
  const trabalhando = statusDaFrota === 'trabalhando';
  const interrompe = trabalhando || troca.recusou;
  const falha = troca.estado.fase === 'falhou' ? troca.estado.texto : null;
  const enviando = troca.estado.fase === 'enviando';
  const caixaRef = useRef<HTMLDivElement | null>(null);
  usaReserva(caixaRef, aberto);

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={caixaRef}
        data-aberto={String(aberto)}
        aria-hidden={!aberto}
        className="ck-surge absolute inset-x-0 flex flex-col items-center"
        style={{
          bottom: 'calc(var(--ck-composer-caixa, 88px) + var(--ck-space-2))',
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
            className="ck-sobre-material"
            style={{ margin: 0, paddingInline: 'var(--ck-space-3)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)', textAlign: 'center' }}
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
          <p role="alert" className="ck-sobre-material" style={{ margin: 0, paddingInline: 'var(--ck-space-3)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)', textAlign: 'center' }}>
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
