'use client';

import { MotionConfig, motion } from 'motion/react';

import { deriveInitials } from '@grupo_borges/cockpit-core/cockpit-types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { rotuloDoEstado } from './direcao-da-voz';
import { tomDaCena, type Cena } from './moldura-estado';
import styles from './retrato-da-voz.module.css';

/** Lado da foto na pílula. */
const LADO_PILULA = 52;

/** A foto redonda, escurecida pelo CSS. Sem arquivo, a inicial em neutro — nunca imagem quebrada. */
function Foto({ slug, nome, lado }: { slug: string; nome: string; lado: number }) {
  return (
    <Avatar className={styles.foto} style={{ width: lado, height: lado }}>
      <AvatarImage src={`/avatars/${slug}.webp`} alt="" className={styles.imagem} />
      <AvatarFallback className={styles.inicial}>{deriveInitials(nome)}</AvatarFallback>
    </Avatar>
  );
}

/** A mola do fundo da pílula: estica e encolhe com a palavra do estado, com um leve passar do ponto. */
const MOLA_DA_PILULA = { type: 'spring', visualDuration: 0.45, bounce: 0.22 } as const;

/** Os segundos de espera pela resposta, junto do estado (só com "Mostrar texto"). */
function Tempo({ segundos }: { segundos?: number }) {
  return segundos ? <span className={styles.tempo}>{` · ${segundos} s`}</span> : null;
}

/**
 * B — Atividade ao vivo: foto, nome e estado numa pílula no alto, logo abaixo da ilha do
 * iPhone. O aro e a palavra do estado acendem na cor da vez; falando, o aro respira e solta ondas.
 */
export function PilulaDoAgente({ slug, nome, cena, segundos }: { slug: string; nome: string; cena: Cena; segundos?: number }) {
  const primeiroNome = nome.split(' ')[0] || nome;
  const rotulo = rotuloDoEstado(cena);
  // A foto fica presa à esquerda (o CSS ancora a pílula). Só o fundo, camada própria atrás,
  // muda de largura pela Motion: foto e texto nunca levam transform, então não tremem.
  return (
    <div className={`${styles.pilula} ${styles.tom}`} data-tom={tomDaCena(cena)} data-cena={cena} data-retrato="pilula">
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
        <Foto slug={slug} nome={nome} lado={LADO_PILULA} />
        <span className={styles.onda} aria-hidden="true" />
        <span className={styles.onda} aria-hidden="true" />
        <span className={styles.aro} aria-hidden="true" />
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
          <span key={rotulo} className={styles.estado}>
            {rotulo}
          </span>
          <Tempo segundos={segundos} />
        </small>
      </span>
    </div>
  );
}
