'use client';

/**
 * O BOTÃO DE VOZ DO PAINEL DO CLIENTE — tamanho de dedo de criança (Rica,
 * 18/11, pelo Daniel, 9 anos). Vale para os três clientes; a frota segue com o
 * disco de 32px de `slots-da-base.tsx`.
 *
 * Mesmo gesto, mesma fiação: os `handlers` do gravador entram inteiros (segurar
 * fala, tocar grava sem segurar, arrastar cancela). O que muda é o corpo:
 *
 * - UM CONVITE, NÃO UM ÍCONE (Rica, 18/11, depois das fotos): em repouso é uma
 *   pílula amarelo-sol para rosa com o microfone e "Fala comigo!" — uma
 *   criança de 9 anos entende sem instrução. Com texto no campo (ou o ■ em
 *   cena) ela encolhe para um disco de contorno rosa: o enviar é que manda.
 *   Ouvindo, vira o disco colorido com ondas; a frase "Ouvindo…" está no campo.
 * - 44px de altura e 56px de alvo (o padding devolve a folga, como em
 *   `alvo-de-toque.ts`), microfone de 26px.
 * - O MOVIMENTO SÓ RESPONDE AO DEDO. Afunda no toque e volta numa mola curta
 *   (bounce 0,22, o teto da estética §5); a pílula encolhe e cresce na mesma
 *   mola quando o campo enche ou esvazia; gravando, ondas se abrem devagar.
 *   Nada se mexe parado: criança autista, nada de sobrecarga.
 * - `prefers-reduced-motion`: o `MotionConfig reducedMotion="user"` do composer
 *   corta escala e layout; as ondas (opacidade em laço, que ele não corta)
 *   saem à mão.
 */
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { MARGEM_INFERIOR_DA_BASE } from '../../lib/alvo-de-toque';
import { InputGroupButton } from '../ui/input-group';
import { IconeMicrofone, IconeParar } from './icones';
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
  // Áudio longo e prestes-a-cancelar AVISAM (âmbar, vermelho): aí a cor é a
  // do aviso. O resto do tempo, o convite.
  const aviso = ouvindo && (vozAparencia.longa || faseVoz === 'cancelando');
  const cheio = ouvindo || travada || !recua;
  // Transcrevendo o botão está desligado: convidar a falar ali seria mentir.
  const convida = !ouvindo && !travada && !recua && faseVoz !== 'transcrevendo';
  const onda = aviso ? (vozAparencia.tinta ?? 'var(--ck-convite-rosa)') : 'var(--ck-convite-rosa)';

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
            : // O nome acessível começa pelo que está escrito (WCAG 2.5.3): quem
              // usa voz para comandar o iPhone diz o que vê.
              `${convida ? 'Fala comigo! ' : ''}Segure para falar com ${agentName}, ou toque para gravar sem segurar`
      }
      className="relative disabled:opacity-40"
      style={{
        boxSizing: 'content-box',
        width: 'auto',
        minWidth: DISCO,
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
              style={{ inset: FOLGA, background: onda }}
              initial={{ scale: 1, opacity: 0.32 }}
              animate={{ scale: 1.45, opacity: 0 }}
              transition={{ duration: 1.6, ease: 'easeOut', repeat: Infinity, delay: atraso }}
            />
          ))}
        </>
      ) : null}
      <motion.span
        aria-hidden
        layout
        layoutDependency={convida}
        className="relative flex items-center overflow-hidden"
        style={{
          height: DISCO,
          minWidth: DISCO,
          borderRadius: 'var(--ck-radius-pill)',
          backgroundImage: cheio && !aviso ? 'var(--ck-convite-fundo)' : 'none',
          backgroundColor: aviso ? onda : 'transparent',
          boxShadow: cheio ? 'none' : 'inset 0 0 0 2px var(--ck-convite-rosa)',
          color: cheio ? 'var(--ck-convite-tinta)' : 'var(--ck-convite-rosa)',
          paddingRight: convida ? 'var(--ck-space-4)' : 0,
        }}
        animate={{ scale: apertado ? 0.92 : ouvindo ? 1.08 : 1 }}
        transition={apertado ? { duration: 0.1 } : { default: MOLA, layout: MOLA }}
      >
        <motion.span layout="position" layoutDependency={convida} className="grid shrink-0 place-items-center" style={{ width: DISCO, height: DISCO }}>
          {travada ? (
            <IconeParar tamanho={18} className="size-[18px]" />
          ) : (
            <IconeMicrofone tamanho={26} strokeWidth={2} className="size-[26px]" />
          )}
        </motion.span>
        <AnimatePresence initial={false}>
          {convida ? (
            <motion.span
              key="convite"
              className="whitespace-nowrap font-semibold"
              style={{ fontSize: 'var(--ck-text-md)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.15, delay: 0.1 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              Fala comigo!
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.span>
    </InputGroupButton>
  );
}
