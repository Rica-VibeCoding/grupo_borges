'use client';

/**
 * A fileira de conversas da gaveta (F16, protótipo aprovado pelo Rica em
 * 01/10): a porta do Histórico e a Nova conversa, lado a lado, um toque cada.
 *
 * A Nova segue a régua do Continuar esta: parado, um toque abre e a gaveta
 * fecha no chat, onde a troca aparece (marco e "Voltar pra anterior"). No meio
 * de um turno, a linha de cima diz quem está trabalhando e a pílula já nasce
 * âmbar. A frota dizia parado e a API respondeu 409: a pílula fica âmbar e
 * espera o segundo toque. Desligado, a Nova não aparece (a API recusa) e a
 * porta ocupa a fileira.
 */
import { AnimatePresence, MotionConfig, motion } from 'motion/react';

import { usaFrota } from '../shell/frota-provider';
import { IconeHistorico, IconeMais } from '../shell/icones';
import { usaFechaPainel } from '../shell/superficie-otimista';
import { LinkDaGaveta } from '../shell/vista-da-gaveta';
import { AvisoDeFalha, LinhaDeOcupado } from './acao-de-conversa';
import { linhaDeOcupado } from './acoes-de-conversa';
import { CALMA, TOQUE } from './ritmo-do-historico';
import { usaTrocaDireta } from './usa-troca-direta';

const PILULA = {
  gap: 'var(--ck-space-2)',
  minHeight: '52px',
  padding: '0 var(--ck-space-3)',
  borderRadius: 'var(--ck-radius-pill)',
  fontSize: 'var(--ck-text-sm)',
  whiteSpace: 'nowrap',
} as const;
const CAMADA = { position: 'absolute', inset: 0, borderRadius: 'inherit' } as const;
const RETICENCIAS = 'Abrindo…';

/** Claro e âmbar são camadas que trocam de opacidade, e os dois desenhos do
 *  texto também: a pílula não muda de tamanho nem anima cor (§9.4). */
function PilulaDaNova({ interrompe, enviando, aoTocar }: { interrompe: boolean; enviando: boolean; aoTocar: () => void }) {
  const rotulo = enviando ? RETICENCIAS : 'Nova conversa';
  const texto = (cor: string, ativo: boolean) => (
    <motion.span
      aria-hidden
      className="flex items-center justify-center"
      style={{ gridArea: '1 / 1', gap: 'var(--ck-space-2)', color: cor }}
      initial={false}
      animate={{ opacity: ativo ? 1 : 0 }}
      transition={CALMA}
    >
      <IconeMais tamanho={16} />
      {rotulo}
    </motion.span>
  );
  return (
    <motion.button
      type="button"
      onClick={aoTocar}
      aria-busy={enviando}
      aria-label={interrompe ? 'Interromper e abrir uma conversa nova' : 'Nova conversa'}
      className="relative flex flex-1 items-center justify-center"
      style={{ ...PILULA, fontWeight: 500 }}
      whileTap={{ scale: 0.97 }}
      transition={TOQUE}
    >
      <span aria-hidden style={{ ...CAMADA, background: 'var(--ck-gv-pilula)' }} />
      <motion.span aria-hidden style={{ ...CAMADA, background: 'var(--ck-state-attention)' }} initial={false} animate={{ opacity: interrompe ? 1 : 0 }} transition={CALMA} />
      <span className="relative grid">
        {texto('var(--ck-text-primary)', !interrompe)}
        {texto('var(--ck-gv-fundo)', interrompe)}
      </span>
    </motion.button>
  );
}

export function PortaENova({ agentSlug, fecharHref, comNova }: { agentSlug: string; fecharHref: string; comNova: boolean }) {
  const { agents } = usaFrota();
  const agente = agents.find((a) => a.slug === agentSlug);
  const nome = agente?.name ?? agentSlug;
  const trabalhando = agente?.status === 'trabalhando';
  const fecha = usaFechaPainel(fecharHref);
  const troca = usaTrocaDireta(agentSlug, nome);
  const interrompe = comNova && (trabalhando || troca.recusou);
  const falha = troca.estado.fase === 'falhou' ? troca.estado.texto : null;

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence initial={false}>
        {interrompe ? (
          <motion.div key="ocupado" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={CALMA}>
            <LinhaDeOcupado texto={`${linhaDeOcupado(nome)}. A nova interrompe.`} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="flex" style={{ gap: 'var(--ck-space-2)' }}>
        <LinkDaGaveta
          href={`${fecharHref}?painel=conversas`}
          className="ck-gv-pilula ck-veil flex flex-1 items-center justify-center"
          style={{ ...PILULA, color: 'var(--ck-text-primary)' }}
        >
          <IconeHistorico tamanho={16} />
          Histórico
        </LinkDaGaveta>
        {comNova ? (
          <PilulaDaNova
            interrompe={interrompe}
            enviando={troca.estado.fase === 'enviando'}
            aoTocar={() => troca.pede({ tipo: 'nova', alvo: null, interrompe: trabalhando, aoAceitar: fecha })}
          />
        ) : null}
      </div>
      {falha ? <AvisoDeFalha texto={falha} aoFechar={troca.larga} /> : null}
    </MotionConfig>
  );
}
