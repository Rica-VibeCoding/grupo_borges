'use client';

/**
 * A fileira de conversas da gaveta (F16, protótipo aprovado pelo Rica em
 * 01/10): a porta do Histórico (rotulada "Conversas", pedido do Rica em 02/10)
 * e a Nova conversa, lado a lado, um toque cada.
 *
 * A Nova segue a régua do Continuar esta: parado, um toque abre e a gaveta
 * fecha no chat, onde a troca aparece. Nada nasce em volta da fileira nem muda
 * de cor (pedido do Rica, 02/10: a frase de cima empurrava os botões e o âmbar
 * enfeava): no meio de um turno, ou com o 409 esperando o segundo toque, só o
 * rótulo vira "Interromper e abrir". Tocada, a pílula enche por dentro num tom
 * sóbrio, no gesto da barra do `/compact`. Desligado, a Nova não aparece (a API
 * recusa) e a porta ocupa a fileira.
 */
import { MotionConfig, motion } from 'motion/react';

import { usaFrota } from '../shell/frota-provider';
import { IconeHistorico, IconeMais } from '../shell/icones';
import { usaFechaPainel } from '../shell/superficie-otimista';
import { LinkDaGaveta } from '../shell/vista-da-gaveta';
import { AvisoDeFalha, Enchendo, type EtapaDoCheio } from './acao-de-conversa';
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
function PilulaDaNova({ interrompe, enviando, etapa, aoTocar }: { interrompe: boolean; enviando: boolean; etapa: EtapaDoCheio; aoTocar: () => void }) {
  const rotulo = enviando ? RETICENCIAS : interrompe ? 'Interromper e abrir' : 'Nova conversa';
  return (
    <motion.button
      type="button"
      onClick={aoTocar}
      aria-busy={enviando}
      aria-label={interrompe ? 'Interromper e abrir uma conversa nova' : 'Nova conversa'}
      className="relative flex flex-1 items-center justify-center overflow-hidden"
      style={{ ...PILULA, fontWeight: 500 }}
      whileTap={{ scale: 0.97 }}
      transition={TOQUE}
    >
      <span aria-hidden style={{ ...CAMADA, background: 'var(--ck-gv-pilula)' }} />
      <Enchendo etapa={enviando ? etapa : null} tinta="var(--ck-text-primary)" />
      <span className="relative flex items-center justify-center" style={{ gap: 'var(--ck-space-2)', color: 'var(--ck-text-primary)' }}>
        <IconeMais tamanho={16} />
        {rotulo}
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
      <div className="flex" style={{ gap: 'var(--ck-space-2)' }}>
        <LinkDaGaveta
          href={`${fecharHref}?painel=conversas`}
          className="ck-gv-pilula ck-veil flex flex-1 items-center justify-center"
          style={{ ...PILULA, color: 'var(--ck-text-primary)' }}
        >
          <IconeHistorico tamanho={16} />
          Conversas
        </LinkDaGaveta>
        {comNova ? (
          <PilulaDaNova
            interrompe={interrompe}
            enviando={troca.estado.fase === 'enviando'}
            etapa={troca.etapa}
            aoTocar={() => troca.pede({ tipo: 'nova', alvo: null, interrompe: trabalhando, aoAceitar: fecha })}
          />
        ) : null}
      </div>
      {falha ? <AvisoDeFalha texto={falha} aoFechar={troca.larga} /> : null}
    </MotionConfig>
  );
}
