'use client';

// A marca e o relógio da cápsula do grupo de ferramentas (§7). A marca é UM
// traço que muda de papel: o anel aberto que gira em voo se fecha e vira ✓ (ou
// ✕) quando o grupo termina; pedindo ao Rica, um ponto âmbar parado.

import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useEffect, useState } from 'react';

import { duracaoCurta, type FaseDoGrupo } from './resumo-do-grupo.ts';

const SECO = { duration: 0 } as const;

// A passagem do anel para o ✓ cabe em ~300 ms: o anel fecha (160 ms) e sai
// enquanto o traço da marca desenha por cima (200 ms, a partir dos 100 ms).
export const FECHA_ANEL = { duration: 0.16, ease: [0.2, 0, 0.2, 1] } as const;
const SAI_ANEL = { duration: 0.14, delay: 0.14, ease: [0.4, 0, 1, 1] } as const;
export const DESENHA = { duration: 0.2, delay: 0.1, ease: [0.2, 0, 0.2, 1] } as const;
const GIRO = { duration: 1.1, ease: 'linear', repeat: Infinity } as const;

const COR_DA_FASE: Record<FaseDoGrupo, string> = {
  gira: 'var(--ck-pulso-ouro)',
  chama: 'var(--ck-state-attention)',
  ok: 'var(--ck-state-ok)',
  falha: 'var(--ck-state-fail)',
};

export const NOME_DA_FASE: Record<FaseDoGrupo, string> = {
  gira: 'em andamento',
  chama: 'aguardando você',
  ok: 'concluído',
  falha: 'falhou',
};

const TICK_MS = 1_000;

/** O anel aberto. Ao sair, ele se FECHA (o arco completa a volta) antes de
 *  sumir — é o mesmo traço que vira a marca, não uma troca de ícone. */
function Anel({ semMovimento }: { semMovimento: boolean }) {
  const presente = useIsPresent();
  return (
    <motion.span
      className="absolute inset-0 inline-flex"
      animate={semMovimento ? undefined : { rotate: 360 }}
      transition={GIRO}
    >
      <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none">
        <motion.circle
          cx="8"
          cy="8"
          r="5.75"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: presente ? 0.7 : 1 }}
          transition={semMovimento ? SECO : FECHA_ANEL}
        />
      </svg>
    </motion.span>
  );
}

/** O ✓ ou o ✕, desenhado pelo traço — chega ao vivo; remontado ao rolar,
 *  aparece pronto (`initial={false}` do `AnimatePresence`). */
function Marca({ falhou, semMovimento }: { falhou: boolean; semMovimento: boolean }) {
  const traco = semMovimento ? SECO : DESENHA;
  return (
    <svg
      aria-hidden
      className="absolute inset-0"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {falhou ? (
        <>
          <motion.path d="M5.5 5.5 10.5 10.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={traco} />
          <motion.path d="M10.5 5.5 5.5 10.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={traco} />
        </>
      ) : (
        <motion.path d="M4.5 8.4 7 10.8 11.5 5.6" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={traco} />
      )}
    </svg>
  );
}

/** O slot de 14px à esquerda: as marcas se sobrepõem no mesmo lugar, a cor
 *  acompanha a fase. A largura nunca muda — a frase não anda por causa dele. */
export function MarcaDaFase({ fase, semMovimento }: { fase: FaseDoGrupo; semMovimento: boolean }) {
  const some = semMovimento ? SECO : SAI_ANEL;
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0"
      style={{
        width: '14px',
        height: '14px',
        color: COR_DA_FASE[fase],
        transition: 'color var(--ck-dur-enter) var(--ck-ease)',
      }}
    >
      <AnimatePresence initial={false}>
        {fase === 'gira' ? (
          <motion.span key="anel" className="absolute inset-0" exit={{ opacity: 0, transition: some }}>
            <Anel semMovimento={semMovimento} />
          </motion.span>
        ) : null}
        {fase === 'chama' ? (
          <motion.span
            key="ponto"
            className="absolute inset-0 inline-flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: some }}
            transition={semMovimento ? SECO : FECHA_ANEL}
          >
            <svg aria-hidden width="14" height="14" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="3" fill="currentColor" />
            </svg>
          </motion.span>
        ) : null}
        {fase === 'ok' || fase === 'falha' ? (
          <motion.span key={fase} className="absolute inset-0" exit={{ opacity: 0, transition: some }}>
            <Marca falhou={fase === 'falha'} semMovimento={semMovimento} />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

/** O relógio ao vivo mora num filho: o tick de 1 s redesenha só o número. */
export function DuracaoAoVivo({ desdeMs }: { desdeMs: number }) {
  const [agoraMs, setAgoraMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setAgoraMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const ms = agoraMs - desdeMs;
  return ms >= 1000 ? <>{duracaoCurta(ms)}</> : null;
}
