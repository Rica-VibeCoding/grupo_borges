'use client';

// A LINHA DO AGORA — a esfera do agente e, ao lado dela, o que ele faz agora.
//
// Substitui duas peças (Rica, 02/10): o bonequinho em cima do composer e a
// linha viva "Pensando há 12 s". O modelo é o que o Claude, o Gemini e o
// ChatGPT fazem — um sinal em movimento à ESQUERDA da linha que está sendo
// escrita. A esfera NUNCA some: parada, ela fica sozinha, respirando.
//
// FORA DA LISTA VIRTUALIZADA DE PROPÓSITO. Item virtualizado desmonta e
// remonta ao rolar, e cada remontagem reiniciaria o giro da esfera. Aqui ela
// é rodapé do feed (`feed.tsx`): monta uma vez por agente.
//
// A esfera é A MESMA da tela de conversa (`conversa/esfera-conversa.tsx`, modo
// `mini`), não uma imitação: mesmo shader, mesmas cores, mesma matéria. O Rica
// recusou a versão em CSS em 02/10.

import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { EsferaConversa } from '../conversa/esfera-conversa';
import type { Cena } from '../conversa/moldura-estado';
import { CHAVE_VISUAL, leVisual, type VariacaoEsfera } from '../conversa/preferencia-visual';

import type { EstadoDoAgora } from './linha-do-agora.ts';
import { rotuloDoTempo } from './linha-viva.ts';

const TICK_MS = 1_000;

/** O estado do feed na língua da tela de conversa: pensar é esperar o Zé,
 *  executar é trabalhar, chamar o Rica é a cor de quando ela ouve você. */
const CENA: Record<EstadoDoAgora, Cena> = {
  offline: 'desligado',
  parado: 'parado',
  pensando: 'esperandoZe',
  executando: 'trabalhando',
  atencao: 'ouvindo',
};

const SEM_VOZ = () => 0;

/** A variação que o Rica escolheu na tela de voz; sem esfera escolhida, o vidro. */
function variacaoEscolhida(): VariacaoEsfera {
  if (typeof window === 'undefined') return 'vidro';
  const visual = leVisual(window.localStorage.getItem(CHAVE_VISUAL));
  return visual.opcao !== 'moldura' && (visual.variacao === 'materia' || visual.variacao === 'vidro')
    ? visual.variacao
    : 'vidro';
}

function EsferaMini({ estado }: { estado: EstadoDoAgora }) {
  const [variacao] = useState(variacaoEscolhida);
  return (
    <span aria-hidden className="ck-esfera-mini-caixa">
      <EsferaConversa mini cena={CENA[estado]} variacao={variacao} leNivel={SEM_VOZ} />
    </span>
  );
}

/** O relógio mora num filho: o tick de 1 s redesenha só o texto. */
function Decorrido({ desdeMs }: { desdeMs: number }) {
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setAgoraMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return <>{` ${rotuloDoTempo(agoraMs - desdeMs)}`}</>;
}

function fraseDoEstado(estado: EstadoDoAgora, emVoo: string | null): string | null {
  switch (estado) {
    case 'pensando':
      return 'Pensando';
    case 'executando':
      return emVoo ?? 'Respondendo';
    case 'atencao':
      return 'Esperando você';
    default:
      return null;
  }
}

export function LinhaDoAgora({
  estado,
  emVoo,
  desdeMs,
}: {
  estado: EstadoDoAgora;
  /** A frase do passo rodando no fim do feed (`fraseEmVoo`). */
  emVoo: string | null;
  /** Âncora do "há N s" — a última mensagem do stream. */
  desdeMs: number | null;
}) {
  const frase = fraseDoEstado(estado, emVoo);
  const brilha = estado === 'pensando' || estado === 'executando';

  // Fora da árvore do composer, então fora do `MotionConfig` dele (§5).
  return (
    <MotionConfig reducedMotion="user">
    <div
      className="flex items-center"
      style={{
        gap: 'var(--ck-space-2)',
        minHeight: '32px',
        padding: 'var(--ck-space-1) var(--ck-space-4) var(--ck-space-2)',
        fontSize: 'var(--ck-text-sm)',
        lineHeight: 'var(--ck-leading-body)',
      }}
    >
      <EsferaMini estado={estado} />
      <span className="relative min-w-0 flex-1" style={{ minHeight: '1lh' }}>
        <AnimatePresence initial={false} mode="popLayout">
          {frase ? (
            <motion.span
              key={frase}
              className={`ck-linha-do-agora-texto block truncate${brilha ? ' ck-brilho-texto' : ''}`}
              data-estado={estado}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            >
              {frase}
              {estado === 'pensando' && desdeMs !== null ? <Decorrido desdeMs={desdeMs} /> : null}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </div>
    </MotionConfig>
  );
}
