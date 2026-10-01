'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';

import { deriveInitials } from '@grupo_borges/cockpit-core/cockpit-types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import type { TomDeEstado } from './estado-da-pilula';
import styles from './pilula-do-agente.module.css';

/** Lado da foto: a geometria é uma só na voz e na gaveta; o topo do chat usa a mesma
 *  pílula reduzida, para caber na faixa de 44px. */
const LADO = { voz: 52, gaveta: 52, topo: 36 } as const;

/** A mola do fundo da pílula: estica e encolhe com a palavra do estado, com um leve passar do ponto. */
const MOLA_DA_PILULA = { type: 'spring', visualDuration: 0.45, bounce: 0.22 } as const;

/** A mola da palavra que gira — a do RotatingText (React Bits). */
const MOLA_DA_PALAVRA = { type: 'spring', damping: 25, stiffness: 300 } as const;

/**
 * Na voz, a palavra do estado gira na troca: a velha sobe e sai pelo alto, a nova sobe de baixo
 * no lugar (o RotatingText do React Bits, guiado pelo estado em vez de um relógio). `popLayout`
 * tira a velha do fluxo na hora, então o fundo da pílula já estica para a nova.
 */
function PalavraQueGira({ rotulo }: { rotulo: string }) {
  return (
    <span className={styles.gira}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={rotulo}
          className={styles.estado}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-120%', opacity: 0 }}
          transition={MOLA_DA_PALAVRA}
        >
          {rotulo}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A foto redonda. Sem arquivo, a inicial em neutro — nunca imagem quebrada. */
function Foto({ slug, nome, lado }: { slug: string; nome: string; lado: number }) {
  return (
    <Avatar className={styles.foto} style={{ width: lado, height: lado }}>
      <AvatarImage src={`/avatars/${slug}.webp`} alt="" className={styles.imagem} />
      <AvatarFallback className={styles.inicial}>{deriveInitials(nome)}</AvatarFallback>
    </Avatar>
  );
}

/** Os segundos de espera pela resposta, junto do estado. */
function Tempo({ segundos }: { segundos?: number }) {
  return segundos ? <span className={styles.tempo}>{` · ${segundos} s`}</span> : null;
}

/**
 * A pílula do agente — peça única da UI: foto com aro na cor do estado, primeiro nome, a palavra
 * do estado e o fundo que estica com mola quando a palavra muda.
 *
 * `cena` só liga o movimento contínuo (ondas falando, barras ouvindo), que é da tela de voz; sem
 * ela a pílula fica parada e só a cor diz o estado. O fundo (vidro escuro) é o mesmo em todo lugar;
 * `lugar` escurece a foto na voz, para não brigar com a esfera, e no `topo` (cabeçalho do chat)
 * só reduz a escala. `selo` mora sobre a foto (o "!").
 */
export function PilulaDoAgente({
  slug,
  nome,
  tom,
  rotulo,
  cena,
  segundos,
  lugar = 'voz',
  selo,
}: {
  slug: string;
  nome: string;
  tom: TomDeEstado;
  rotulo: string;
  cena?: string;
  segundos?: number;
  lugar?: 'voz' | 'gaveta' | 'topo';
  selo?: ReactNode;
}) {
  const primeiroNome = nome.split(' ')[0] || nome;
  // A foto fica presa à esquerda. Só o fundo, camada própria atrás, muda de largura pela
  // Motion: foto e texto nunca levam transform, então não tremem.
  return (
    <div className={styles.pilula} data-tom={tom} data-cena={cena} data-lugar={lugar} data-retrato="pilula">
      <MotionConfig reducedMotion="user">
        <motion.span
          layout
          layoutDependency={`${rotulo}${segundos ?? ''}`}
          transition={{ layout: MOLA_DA_PILULA }}
          style={{ borderRadius: 40 }}
          className={styles.fundo}
          aria-hidden="true"
        />
      </MotionConfig>
      <span className={styles.moldaPilula}>
        <Foto slug={slug} nome={nome} lado={LADO[lugar]} />
        <span className={styles.onda} aria-hidden="true" />
        <span className={styles.onda} aria-hidden="true" />
        <span className={styles.aro} aria-hidden="true" />
        {selo}
      </span>
      <span className={styles.quem}>
        <b>{primeiroNome}</b>
        <small>
          <span className={styles.barras} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          {lugar === 'voz' ? (
            <MotionConfig reducedMotion="user">
              <PalavraQueGira rotulo={rotulo} />
            </MotionConfig>
          ) : (
            <span key={rotulo} className={styles.estado}>
              {rotulo}
            </span>
          )}
          <Tempo segundos={segundos} />
        </small>
      </span>
    </div>
  );
}
