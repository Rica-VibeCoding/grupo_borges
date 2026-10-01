'use client';

// A BARRA DO `/compact` — a faixa fina que nasce logo acima do composer
// quando um compact sai e morre quando o resumo chega.
//
// O que ela NÃO é: uma barra de progresso de verdade. O compact não emite
// evento intermediário nenhum — existe o envio e existe o resumo, e nada
// entre os dois. O que se desenha aqui é uma ESTIMATIVA honesta: a barra
// enche até 90% no ritmo do ETA (140s no primeiro uso, mediana das últimas
// 5 durações reais do agente depois) e PARA ali. Passou do ETA, ela não
// finge que sabe mais: respira em opacidade e o rótulo vira "quase lá".
// Os 100% só acontecem quando o resumo existe — é o único número medido.
//
// ARIA: `aria-valuenow` existe SÓ enquanto a estimativa vale (fase enchendo).
// No "quase lá" o valor real é desconhecido, e a APG manda OMITIR o atributo
// nesse caso — progressbar sem valuenow é o indeterminado acessível.
//
// Movimento: só `transform` (scaleX) e `opacity`. O deslize contínuo é uma
// transição linear de 1s sobre ticks de 1s; quem pediu reduced-motion recebe
// a mesma informação em saltos de ~5s (o kill global de transição faz o
// salto, o tick mais espaçado faz o "~5s").

import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';

import {
  faseDaEsperaCompact,
  progressoDoCompact,
  rotuloCronometroCompact,
} from '@grupo_borges/cockpit-core/compact-eta';

import type { EstadoCompact } from '../../lib/compact';
import styles from './barra-compact.module.css';
import { IconeDescartar } from './icones';

const TICK_SUAVE_MS = 1_000;
const TICK_REDUZIDO_MS = 5_000;

/** A mola da palavra que gira — a mesma da pílula do agente (RotatingText do React Bits). */
const MOLA_DA_PALAVRA = { type: 'spring', damping: 25, stiffness: 300 } as const;

/** As três linhas da conversa: a de cima e a de baixo dobram sobre a do meio, e voltam. */
const DOBRAS = [
  { largura: 14, y: 5 },
  { largura: 18, y: 0 },
  { largura: 11, y: -5 },
] as const;

/**
 * O desenho da compactação: três linhas — a conversa — que se dobram sobre a do meio no
 * ritmo de quem espera. Quando o resumo chega, as de fora somem dentro dela e sobra uma só,
 * acesa em `state-ok`: a conversa virou uma linha.
 */
function Dobra({ feita }: { feita: boolean }) {
  return (
    <span className={styles.dobra} aria-hidden="true">
      {DOBRAS.map(({ largura, y }, i) => (
        <motion.i
          key={largura}
          style={{ width: largura }}
          animate={
            feita
              ? { y: y, opacity: y === 0 ? 1 : 0, scaleX: y === 0 ? 1 : 0.4 }
              : { y: [0, y, y, 0], opacity: y === 0 ? 1 : [1, 0.35, 0.35, 1] }
          }
          transition={
            feita
              ? MOLA_DA_PALAVRA
              : { duration: 1.8, times: [0, 0.4, 0.6, 1], ease: 'easeInOut', repeat: Infinity, delay: i * 0.04 }
          }
        />
      ))}
    </span>
  );
}

/**
 * A estimativa numa cápsula de borda fina. O preenchimento é uma pílula inteira que entra da
 * esquerda (`translateX`), então a ponta segue redonda em qualquer ponto. A tinta por dentro
 * anda o contrário, presa ao trilho: o degradê é do caminho, e a cor da ponta diz onde ele está.
 */
function Capsula({ progresso, concluindo }: { progresso: number; concluindo: boolean }) {
  const desloca = (progresso - 1) * 100;
  // Enchendo: deslize contínuo (1s linear sobre o tick de 1s). Concluindo: o salto pros 100%
  // é o evento, então entra com a curva de entrada — e com reduced-motion o kill global vira
  // corte seco nos dois casos, que é o pedido.
  const transition = concluindo ? 'transform var(--ck-dur-enter) var(--ck-ease)' : 'transform 1s linear';
  return (
    <span className={styles.capsula}>
      <span className={styles.cheio} style={{ transform: `translateX(${desloca}%)`, transition }}>
        <span className={styles.tinta} style={{ transform: `translateX(${-desloca}%)`, transition }} />
      </span>
    </span>
  );
}

/** O rótulo gira na troca de fase: o velho sobe e sai, o novo sobe de baixo no lugar. */
function Gira({ chave, className, children }: { chave: string; className?: string; children: string }) {
  return (
    <span className={styles.gira}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={chave}
          className={className}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-120%', opacity: 0 }}
          transition={MOLA_DA_PALAVRA}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** O cronômetro rola dígito por dígito (o Counter do React Bits): só o que mudou anda. */
function Cronometro({ rotulo }: { rotulo: string }) {
  return (
    <span className={styles.cronometro}>
      {[...rotulo].map((c, i) => (
        <Gira key={rotulo.length - i} chave={c}>
          {c}
        </Gira>
      ))}
    </span>
  );
}

function usaMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aoMudar = () => setReduzido(consulta.matches);
    consulta.addEventListener('change', aoMudar);
    return () => consulta.removeEventListener('change', aoMudar);
  }, []);

  return reduzido;
}

export function BarraCompact({
  estado,
  onDispensar,
}: {
  estado: EstadoCompact;
  /** Fecha o aviso de "sem retorno" — a máquina volta ao ocioso. */
  onDispensar: () => void;
}) {
  const reduzido = usaMovimentoReduzido();
  const [agoraMs, setAgoraMs] = useState(() => Date.now());

  const esperando = estado.fase === 'compactando';
  useEffect(() => {
    if (!esperando) return;
    const tick = reduzido ? TICK_REDUZIDO_MS : TICK_SUAVE_MS;
    const timer = setInterval(() => setAgoraMs(Date.now()), tick);
    return () => clearInterval(timer);
  }, [esperando, reduzido]);

  if (estado.fase === 'ocioso') return null;

  if (estado.fase === 'sem-retorno') {
    // 6min sem resumo: o composer JÁ destravou (a fase é da máquina), e o
    // aviso diz a verdade — o compact não deu retorno, manda mensagem. A
    // receita é a dos avisos da voz: o que aconteceu + o que fazer + dismiss.
    return (
      <div
        className="ck-sobre-material ck-barra-entra mx-auto flex w-full items-start justify-between"
        style={{
          maxWidth: 'var(--ck-w-composer)',
          padding: '0 var(--ck-space-2)',
          gap: 'var(--ck-space-3)',
        }}
      >
        <span
          role="status"
          aria-live="assertive"
          style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}
        >
          o compact não deu retorno — pode mandar mensagem
        </span>
        <button
          type="button"
          onClick={onDispensar}
          aria-label="Dispensar aviso do compact"
          className="ck-veil flex shrink-0 items-center"
          style={{
            padding: '4px',
            borderRadius: 'var(--ck-radius-chip)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          <IconeDescartar tamanho={13} />
        </button>
      </div>
    );
  }

  const decorridoMs = estado.desdeMs === null ? 0 : Math.max(0, agoraMs - estado.desdeMs);
  const concluindo = estado.fase === 'concluindo';
  const espera = faseDaEsperaCompact(decorridoMs, estado.etaMs);
  const progresso = concluindo ? 1 : progressoDoCompact(decorridoMs, estado.etaMs);
  const quaseLa = !concluindo && espera !== 'enchendo';

  const frase = concluindo ? 'Compactada' : 'Compactando';

  return (
    // `.ck-barra-entra`: a entrada, com o gesto do menu do composer. Só roda na
    // montagem — as fases seguintes reaproveitam o nó e não repetem.
    <MotionConfig reducedMotion="user">
      <div
        className={`ck-sobre-material ck-barra-entra mx-auto w-full ${styles.barra}`}
        data-fase={concluindo ? 'feita' : quaseLa ? 'quase' : 'enchendo'}
        style={{ maxWidth: 'var(--ck-w-composer)' }}
      >
        <div className={styles.linha}>
          <Dobra feita={concluindo} />
          {/* Gira só na troca de fase; o brilho atravessa a frase enquanto ele trabalha. */}
          <Gira chave={frase} className={styles.frase}>
            {frase}
          </Gira>
          {/* O cronômetro é mono e tabular: dígito que muda de largura a cada segundo faria
              o rótulo inteiro dançar por um número que não pede atenção nenhuma. */}
          <Cronometro rotulo={rotuloCronometroCompact(decorridoMs)} />
        </div>
        <div
          role="progressbar"
          aria-label="Compactando a conversa"
          aria-valuemin={0}
          aria-valuemax={100}
          // Dentro do ETA a estimativa vale e o número vai junto; no "quase lá"
          // o valor é desconhecido e a APG manda OMITIR — não é esquecimento.
          {...(!quaseLa ? { 'aria-valuenow': Math.round(progresso * 100) } : {})}
          className={styles.trilho}
        >
          <Capsula progresso={progresso} concluindo={concluindo} />
        </div>
      </div>
    </MotionConfig>
  );
}
