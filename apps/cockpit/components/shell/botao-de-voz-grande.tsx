'use client';

/**
 * O BOTÃO DE VOZ DO PAINEL DO CLIENTE — tamanho de dedo de criança (Rica,
 * 18/11, pelo Daniel, 9 anos). Vale para os três clientes; a frota segue com o
 * disco de 32px de `slots-da-base.tsx`.
 *
 * Mesmo gesto, mesma fiação: os `handlers` do gravador entram inteiros (segurar
 * fala, tocar grava sem segurar, arrastar cancela). O que muda é o corpo:
 *
 * - 44px de disco e 56px de alvo (o padding devolve a folga, como em
 *   `alvo-de-toque.ts`), ícone de 26px.
 * - O MOVIMENTO SÓ RESPONDE AO DEDO. O disco afunda no toque e volta numa mola
 *   curta (bounce 0,22, o teto da estética §5); gravando, ele fica um pouco
 *   maior e solta ondas que se abrem e somem devagar — "estou ouvindo" sem
 *   piscar. Nada se mexe parado: criança autista, nada de sobrecarga.
 * - `prefers-reduced-motion`: o `MotionConfig reducedMotion="user"` do composer
 *   corta escala; as ondas (opacidade em laço, que ele não corta) saem à mão.
 */
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import { MARGEM_INFERIOR_DA_BASE } from '../../lib/alvo-de-toque';
import { InputGroupButton } from '../ui/input-group';
import { IconeOnda, IconeParar } from './icones';
import { emCaptura, type ModoDaFala } from './modo-da-fala';
import type { Gravador } from './usa-gravador';
import type { AparenciaVoz, FaseVoz } from './voz';

const DISCO = 44;
const FOLGA = 6;
const MOLA = { type: 'spring', bounce: 0.22, visualDuration: 0.28 } as const;

export function BotaoDeVozGrande({
  modo,
  gravador,
  faseVoz,
  vozAparencia,
  agentName,
  aoTocar,
  recua = false,
}: {
  modo: ModoDaFala;
  gravador: Gravador;
  faseVoz: FaseVoz;
  vozAparencia: AparenciaVoz;
  agentName: string;
  /** Chamado SÍNCRONO no toque, antes do gravador — é gesto do usuário. */
  aoTocar?: () => void;
  /** Há vizinho de massa (enviar ou ■): o disco vira contorno, como o pequeno —
   *  dois discos cheios lado a lado e o dedo que mira um acha o outro. */
  recua?: boolean;
}) {
  const [apertado, setApertado] = useState(false);
  const reduzido = useReducedMotion();
  const travada = modo === 'travada';
  const ouvindo = emCaptura(modo);
  const tinta = vozAparencia.tinta ?? 'var(--ck-state-running)';

  const { onPointerDown, onPointerUp, onPointerCancel, onPointerMove } = gravador.handlers;
  const maos = travada
    ? {
        onClick: () => {
          aoTocar?.();
          gravador.enviarTravada();
        },
        onPointerDown: () => setApertado(true),
        onPointerUp: () => setApertado(false),
        onPointerCancel: () => setApertado(false),
        onPointerLeave: () => setApertado(false),
      }
    : {
        onPointerDown: (e: React.PointerEvent) => {
          setApertado(true);
          aoTocar?.();
          onPointerDown(e);
        },
        onPointerMove,
        onPointerUp: (e: React.PointerEvent) => {
          setApertado(false);
          onPointerUp(e);
        },
        onPointerCancel: (e: React.PointerEvent) => {
          setApertado(false);
          onPointerCancel(e);
        },
      };

  return (
    <InputGroupButton
      key={travada ? 'enviar-audio' : 'voz'}
      variant="ghost"
      disabled={!travada && faseVoz === 'transcrevendo'}
      {...maos}
      aria-label={
        travada
          ? `Enviar áudio para ${agentName}`
          : ouvindo
            ? vozAparencia.anuncio
            : `Segure para falar com ${agentName}, ou toque para gravar sem segurar`
      }
      className="relative disabled:opacity-40"
      style={{
        boxSizing: 'content-box',
        width: DISCO,
        height: DISCO,
        padding: FOLGA,
        margin: -FOLGA,
        // A folga daqui é a mesma do `ALVO_DE_TOQUE` (6px): a margem da base serve igual.
        marginBottom: MARGEM_INFERIOR_DA_BASE,
        borderRadius: 'var(--ck-radius-pill)',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      {ouvindo && !reduzido ? (
        <>
          {[0, 0.8].map((atraso) => (
            <motion.span
              key={atraso}
              aria-hidden
              className="pointer-events-none absolute rounded-full"
              style={{ inset: FOLGA, background: tinta }}
              initial={{ scale: 1, opacity: 0.32 }}
              animate={{ scale: 1.45, opacity: 0 }}
              transition={{ duration: 1.6, ease: 'easeOut', repeat: Infinity, delay: atraso }}
            />
          ))}
        </>
      ) : null}
      <motion.span
        aria-hidden
        className="relative grid place-items-center rounded-full"
        style={{
          width: DISCO,
          height: DISCO,
          backgroundColor: ouvindo || travada ? tinta : recua ? 'transparent' : 'var(--ck-text-primary)',
          color: !ouvindo && !travada && recua ? 'var(--ck-text-secondary)' : 'var(--ck-surface-canvas)',
          transition: 'background-color var(--ck-dur-enter) var(--ck-ease), color var(--ck-dur-enter) var(--ck-ease)',
        }}
        animate={{ scale: apertado ? 0.92 : ouvindo ? 1.08 : 1 }}
        transition={apertado ? { duration: 0.1 } : MOLA}
      >
        {travada ? <IconeParar tamanho={18} /> : <IconeOnda tamanho={26} />}
      </motion.span>
    </InputGroupButton>
  );
}
