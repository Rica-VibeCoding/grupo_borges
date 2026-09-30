'use client';

import type { CSSProperties } from 'react';
import { MotionConfig, motion } from 'motion/react';

import { deriveInitials } from '@grupo_borges/cockpit-core/cockpit-types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { AnelDaVoz } from './anel-da-voz';
import { rotuloDoEstado } from './direcao-da-voz';
import { fotoDoAgente } from './foto-do-agente';
import { tomDaCena, type Cena } from './moldura-estado';
import styles from './retrato-da-voz.module.css';

/** Lado da foto: na pílula da B, e o núcleo da C (que encolhe sem original em alta). */
const LADO_PILULA = 52;
const LADO_NUCLEO = 220;

/** A foto redonda, escurecida pelo CSS. Sem arquivo, a inicial em neutro — nunca imagem quebrada. */
function Foto({ slug, nome, lado }: { slug: string; nome: string; lado: number }) {
  const foto = fotoDoAgente(slug, lado);
  return (
    <Avatar className={styles.foto} style={{ width: foto.lado, height: foto.lado }}>
      <AvatarImage src={foto.src} alt="" className={styles.imagem} />
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
  const rotulo = rotuloDoEstado('atividade', cena);
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

/** C — Eclipse, a linha do alto: NOME • estado, em mono; o estado na cor da vez. */
export function CabecaDoEclipse({ nome, cena, segundos }: { nome: string; cena: Cena; segundos?: number }) {
  const primeiroNome = nome.split(' ')[0] || nome;
  return (
    <p className={`${styles.cabeca} ${styles.tom}`} data-tom={tomDaCena(cena)} data-cena={cena}>
      <b>{primeiroNome}</b>
      <i aria-hidden="true" />
      <span key={rotuloDoEstado('eclipse', cena)} className={styles.estado}>
        {rotuloDoEstado('eclipse', cena)}
      </span>
      <Tempo segundos={segundos} />
    </p>
  );
}

/**
 * C — Eclipse, o núcleo: a foto grande e quase apagada, cercada pelo anel que mede a voz. Fica
 * no lugar da esfera; com a esfera escolhida, ela passa por trás e a luz dela vira a coroa.
 * Parado e sem a esfera, um pulso lento sai de fora do anel e chama o toque.
 */
export function NucleoDoAgente({
  slug,
  nome,
  cena,
  leNivel,
  pulsa = false,
}: {
  slug: string;
  nome: string;
  cena: Cena;
  leNivel: () => number;
  /** O pulso que chama o toque sai do aro (sem a esfera; com ela, o pulso é o da esfera). */
  pulsa?: boolean;
}) {
  const lado = fotoDoAgente(slug, LADO_NUCLEO).lado;
  return (
    <div
      className={`${styles.nucleo} ${styles.tom}`}
      data-tom={tomDaCena(cena)}
      data-cena={cena}
      data-retrato="nucleo"
      style={{ '--lado': `${lado}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className={styles.coroa} />
      <AnelDaVoz cena={cena} raio={lado / 2 + 14} leNivel={leNivel} />
      <span className={styles.janela}>
        <Foto slug={slug} nome={nome} lado={LADO_NUCLEO} />
      </span>
      <span className={styles.aroNucleo} />
      {pulsa ? <span className={styles.sonar} /> : null}
    </div>
  );
}
