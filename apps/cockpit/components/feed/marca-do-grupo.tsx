'use client';

// A marca e o relógio da cápsula do grupo de ferramentas (§7). A marca é UM
// anel que muda de papel: aberto e girando em voo, ele fecha a volta quando o
// grupo termina e ganha o miolo do desfecho; pedindo ao Rica, um ponto âmbar.

import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { useEffect, useState } from 'react';

import { duracaoCurta, type FaseDoGrupo } from './resumo-do-grupo.ts';

const SECO = { duration: 0 } as const;

// A passagem do anel para o concluído cabe em ~300 ms: o arco completa a volta
// (160 ms) e o miolo nasce por cima (200 ms, a partir dos 100 ms).
export const FECHA_ANEL = { duration: 0.16, ease: [0.2, 0, 0.2, 1] } as const;
export const DESENHA = { duration: 0.2, delay: 0.1, ease: [0.2, 0, 0.2, 1] } as const;
const SAI = { duration: 0.14, ease: [0.4, 0, 1, 1] } as const;
const VOLTA_MS = 1.1;

const COR_DA_FASE: Record<FaseDoGrupo, string> = {
  gira: 'var(--ck-pulso-ouro)',
  chama: 'var(--ck-state-attention)',
  ok: 'var(--ck-tom-feito)',
  falha: 'var(--ck-state-fail)',
};

export const NOME_DA_FASE: Record<FaseDoGrupo, string> = {
  gira: 'em andamento',
  chama: 'aguardando você',
  ok: 'concluído',
  falha: 'falhou',
};

const TICK_MS = 1_000;

/** O giro do anel. É indicador de progresso, não enfeite: gira SEMPRE, com
 *  movimento reduzido também (o que a preferência corta são as transições).
 *  Por isso é `animate()` imperativo num valor de movimento, que nenhum
 *  `MotionConfig reducedMotion` alcança. Ao parar, o anel fica no ângulo em
 *  que estava — fechado, ele é um círculo e o ângulo não aparece. */
function useGiro(girando: boolean) {
  const giro = useMotionValue(0);
  useEffect(() => {
    if (!girando) return;
    const de = giro.get() % 360;
    const controle = animate(giro, [de, de + 360], { duration: VOLTA_MS, ease: 'linear', repeat: Infinity });
    return () => controle.stop();
  }, [girando, giro]);
  return giro;
}

/** O slot de 14px à esquerda — UM anel do começo ao fim. Em voo, arco aberto
 *  girando no dourado; ao terminar, o arco completa a volta e nasce o miolo:
 *  ponto (concluído, verde-sálvia) ou ✕ (falhou, vermelho — forma própria,
 *  para a cor não ser a única portadora). Pedindo ao Rica, só o ponto âmbar,
 *  parado, sem anel. A largura nunca muda — a frase não anda por causa dele. */
export function MarcaDaFase({ fase, semMovimento }: { fase: FaseDoGrupo; semMovimento: boolean }) {
  const giro = useGiro(fase === 'gira');
  const comAnel = fase !== 'chama';
  const fecha = semMovimento ? SECO : FECHA_ANEL;
  const nasce = semMovimento ? SECO : DESENHA;
  const some = semMovimento ? SECO : SAI;
  const miolo = fase === 'falha' ? 'xis' : fase === 'gira' ? null : 'ponto';
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0"
      style={{
        width: '14px',
        height: '14px',
        color: COR_DA_FASE[fase],
        transition: semMovimento ? undefined : 'color var(--ck-dur-enter) var(--ck-ease)',
      }}
    >
      <motion.span className="absolute inset-0 inline-flex" style={{ rotate: giro }}>
        <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none">
          <motion.circle
            cx="8"
            cy="8"
            r="5.75"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: fase === 'gira' ? 0.7 : 1, opacity: comAnel ? 1 : 0 }}
            transition={comAnel ? fecha : some}
          />
        </svg>
      </motion.span>
      <svg aria-hidden className="absolute inset-0" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <AnimatePresence initial={false}>
          {miolo === 'ponto' ? (
            <motion.circle
              key="ponto"
              cx="8"
              cy="8"
              r="2.5"
              fill="currentColor"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, transition: nasce }}
              exit={{ scale: 0, opacity: 0, transition: some }}
            />
          ) : null}
          {miolo === 'xis' ? (
            <motion.path
              key="xis"
              d="M6.3 6.3 9.7 9.7 M9.7 6.3 6.3 9.7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1, transition: nasce }}
              exit={{ opacity: 0, transition: some }}
            />
          ) : null}
        </AnimatePresence>
      </svg>
    </span>
  );
}

/** O relógio ao vivo mora num filho: o tick de 1 s redesenha só o número. */
/** `contado` guarda o último tique: é o número que fica quando o grupo fecha
 *  sem carimbo de fim (passo interrompido, sem resultado). */
export function DuracaoAoVivo({ desdeMs, contado }: { desdeMs: number; contado?: { current: number | null } }) {
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      const agora = Date.now();
      setAgoraMs(agora);
      if (contado && agora - desdeMs >= 1000) contado.current = agora - desdeMs;
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [contado, desdeMs]);
  const ms = agoraMs - desdeMs;
  return ms >= 1000 ? <>{duracaoCurta(ms)}</> : null;
}
