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

import {
  faseDaEsperaCompact,
  progressoDoCompact,
  rotuloCronometroCompact,
} from '@grupo_borges/cockpit-core/compact-eta';

import type { EstadoCompact } from '../../lib/compact';
import { IconeDescartar } from './icones';

const TICK_SUAVE_MS = 1_000;
const TICK_REDUZIDO_MS = 5_000;

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
        className="mx-auto flex w-full items-start justify-between"
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

  const rotulo = concluindo
    ? 'Conversa compactada'
    : quaseLa
      ? `Compactando a conversa · quase lá · ${rotuloCronometroCompact(decorridoMs)}`
      : `Compactando a conversa · ${rotuloCronometroCompact(decorridoMs)}`;

  return (
    <div
      className="mx-auto w-full"
      style={{ maxWidth: 'var(--ck-w-composer)', padding: '0 var(--ck-space-2)' }}
    >
      <div
        role="progressbar"
        aria-label="Compactando a conversa"
        aria-valuemin={0}
        aria-valuemax={100}
        // Dentro do ETA a estimativa vale e o número vai junto; no "quase lá"
        // o valor é desconhecido e a APG manda OMITIR — não é esquecimento.
        {...(!quaseLa ? { 'aria-valuenow': Math.round(progresso * 100) } : {})}
        style={{
          height: '2px',
          overflow: 'hidden',
          background: 'var(--ck-edge-hairline)',
          borderRadius: '1px',
        }}
      >
        <div
          className={quaseLa ? 'ck-pulso' : ''}
          data-estado={quaseLa ? 'trabalhando' : undefined}
          style={{
            width: '100%',
            height: '100%',
            background: concluindo ? 'var(--ck-state-ok)' : 'var(--ck-state-running)',
            transform: `scaleX(${progresso})`,
            transformOrigin: 'left',
            // Enchendo: deslize contínuo (1s linear sobre o tick de 1s).
            // Concluindo: o salto pros 100% é o evento, então entra com a
            // curva de entrada — e com reduced-motion o kill global vira corte
            // seco nos dois casos, que é o pedido.
            transition: concluindo
              ? 'transform var(--ck-dur-enter) var(--ck-ease)'
              : 'transform 1s linear',
          }}
        />
      </div>
      <span
        style={{
          display: 'block',
          paddingTop: 'var(--ck-space-1)',
          fontSize: 'var(--ck-text-xs)',
          color: concluindo ? 'var(--ck-state-ok)' : 'var(--ck-text-secondary)',
        }}
      >
        {/* O cronômetro é mono: dígito que muda de largura a cada segundo faz
            o rótulo inteiro dançar, e a dança chama o olho pra um número que
            não pede atenção nenhuma. */}
        <span style={{ fontFamily: 'var(--ck-font-mono)' }}>{rotulo}</span>
      </span>
    </div>
  );
}
