'use client';

/**
 * A LEITURA de uma conversa do Histórico — rodada 2 (Rica, 01/10): olhar não é
 * trocar. Título, "3h atrás, 24 turnos", a nota de onde parou e as últimas
 * mensagens no desenho do chat (Rica em balão, agente em markdown leve), lidas
 * do JSONL pela API (`/leitura`) sem tocar no agente. O rodapé, com as ações e
 * o Continuar esta, chega pronto do painel.
 *
 * O título e o resumo saem da lista e aparecem no ato; só as mensagens esperam
 * a rede, em esqueleto. O título é o da linha tocada (`layoutId`): enquanto a
 * leitura está aberta ele é o "líder"; ao fechar vira texto comum e o da linha
 * volta a ser o dono, e é a Motion que leva um ao outro.
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { fetchConversaLeitura, type Conversa, type LeituraDaConversa } from '@grupo_borges/cockpit-core/api';

import { AssistantMarkdown } from '@/components/renderers/markdown';

import { descreveTrava, resumoDaLeitura } from './conversas';
import { MensagensEsqueleto } from './esqueleto';
import { idDoTitulo } from './linha-de-conversa';
import { Bloco } from './pecas';
import { CALMA, ENTRADA } from './ritmo-do-historico';

type Carga = { fase: 'carregando' } | { fase: 'falhou'; motivo: string } | { fase: 'pronto'; dados: LeituraDaConversa };

const ESTILO_DO_TITULO = { fontSize: 'var(--ck-text-lg)', fontWeight: 600, lineHeight: 1.25, color: 'var(--ck-text-primary)' } as const;
const TEXTO = { fontSize: 'var(--ck-text-base)', lineHeight: 'var(--ck-leading-body)', color: 'var(--ck-text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;

function Mensagens({ dados }: { dados: LeituraDaConversa }) {
  if (dados.mensagens.length === 0) {
    return <p style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>Nenhuma mensagem de texto nesta conversa.</p>;
  }
  return (
    <>
      {dados.mais_antigas ? (
        <p style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>As mensagens mais antigas ficam de fora.</p>
      ) : null}
      {dados.mensagens.map((m, i) =>
        m.papel === 'rica' ? (
          <p key={i} className="self-end" style={{ ...TEXTO, maxWidth: '85%', padding: 'var(--ck-space-2) var(--ck-space-3)', borderRadius: '14px', background: 'var(--ck-gv-pilula)' }}>
            {m.texto}
          </p>
        ) : (
          <AssistantMarkdown key={i} leve>
            {m.texto}
          </AssistantMarkdown>
        ),
      )}
    </>
  );
}

export function LeituraDoHistorico({
  agentSlug,
  conversa,
  agora,
  lider,
  nomeDoAgente,
  rodape,
}: {
  agentSlug: string;
  conversa: Conversa;
  agora: number;
  /** A leitura está aberta: o título dela é o dono do `layoutId`. */
  lider: boolean;
  nomeDoAgente: (slug: string) => string;
  rodape: ReactNode;
}) {
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const controlador = new AbortController();
    setCarga({ fase: 'carregando' });
    fetchConversaLeitura(agentSlug, conversa.id, controlador.signal)
      .then((dados) => setCarga({ fase: 'pronto', dados }))
      .catch((e: unknown) => {
        if (!controlador.signal.aborted) setCarga({ fase: 'falhou', motivo: e instanceof Error ? e.message : String(e) });
      });
    return () => controlador.abort();
  }, [agentSlug, conversa.id, tentativa]);

  return (
    <div className="flex min-h-0 flex-auto flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <motion.div layoutScroll className="flex min-h-0 flex-auto flex-col overflow-y-auto" style={{ gap: 'var(--ck-space-4)' }}>
        <div className="flex flex-col" style={{ gap: 'var(--ck-space-1)', padding: '0 var(--ck-space-1)' }}>
          {lider ? (
            <motion.h3 key="lider" layoutId={idDoTitulo(conversa.id)} layoutDependency={lider} transition={CALMA} style={ESTILO_DO_TITULO}>
              {conversa.titulo}
            </motion.h3>
          ) : (
            <h3 key="sombra" style={ESTILO_DO_TITULO}>
              {conversa.titulo}
            </h3>
          )}
          <span className="ck-tabular" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
            {resumoDaLeitura(conversa, agora)}
          </span>
        </div>

        {conversa.nota ? (
          <Bloco>
            <span style={{ fontSize: 'var(--ck-text-sm)', fontWeight: 600, color: 'var(--ck-text-secondary)' }}>Onde parou</span>
            <p style={TEXTO}>{conversa.nota}</p>
          </Bloco>
        ) : null}

        {conversa.bloqueada ? (
          <p style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)', padding: '0 var(--ck-space-1)' }}>
            {descreveTrava(conversa, nomeDoAgente)}: sem continuar nem excluir até ela fechar lá.
          </p>
        ) : null}

        <div className="grid" style={{ padding: '0 var(--ck-space-1)' }}>
          <AnimatePresence initial={false}>
            <motion.div
              key={carga.fase}
              className="flex flex-col"
              style={{ gridArea: '1 / 1', gap: 'var(--ck-space-3)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={ENTRADA}
            >
              {carga.fase === 'carregando' ? <MensagensEsqueleto /> : null}
              {carga.fase === 'pronto' ? <Mensagens dados={carga.dados} /> : null}
              {carga.fase === 'falhou' ? (
                <div className="flex flex-col items-start" style={{ gap: 'var(--ck-space-2)' }}>
                  <p role="alert" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)' }}>
                    Não consegui ler as mensagens: {carga.motivo}
                  </p>
                  <button type="button" onClick={() => setTentativa((t) => t + 1)} className="ck-gv-pilula ck-veil" style={{ minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-4)', borderRadius: 'var(--ck-radius-pill)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>
                    Tentar de novo
                  </button>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>

      <div className="flex shrink-0 flex-col" style={{ gap: 'var(--ck-space-2)', paddingTop: 'var(--ck-space-1)' }}>
        {rodape}
      </div>
    </div>
  );
}
