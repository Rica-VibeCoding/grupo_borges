'use client';

import { AnimatePresence, MotionConfig, motion } from 'motion/react';

import { palavrasDe } from './frases-da-voz';
import { FalaQueCorre, JanelaQueCorre } from './janela-que-corre';
import type { TrechoDaLegenda } from './legenda-da-voz';
import styles from './texto-da-voz.module.css';

/**
 * O texto da tela de voz (fase 4): tudo o que ela escreve mora num lugar só, logo abaixo da
 * animação, na mesma família — pequeno, em meio-tom, rótulo em mono. Parada, uma linha que
 * convida; andando, a legenda (regras em `legenda-da-voz.ts`). O estado não é escrito aqui: é a
 * palavra da pílula, na cor da vez. Nada aqui recebe o dedo: a tela inteira é o botão.
 */

function Reticencias() {
  return (
    <span className={styles.reticencias} aria-label="transcrevendo">
      <span>•</span>
      <span>•</span>
      <span>•</span>
    </span>
  );
}

/** A linha da tela parada. `pulsa`: respira no ritmo do sinal do toque. */
export function ConviteDaVoz({ linha, pulsa }: { linha: string; pulsa: boolean }) {
  return (
    <p className={styles.convite} data-convite="" data-pulsa={pulsa ? 'sim' : undefined}>
      {linha}
    </p>
  );
}

/**
 * O pulso que chama o toque, preso à animação: nasce na borda da esfera (`esfera`) ou, sem
 * nada no centro (só a moldura), num aro pequeno que marca onde tocar (`solto`).
 */
export function SinalDoToque({ forma }: { forma: 'esfera' | 'solto' }) {
  return (
    <span className={styles.sinal} data-forma={forma} aria-hidden="true">
      <span className={styles.sonar} />
    </span>
  );
}

/** A troca da sua fala, cheia → recuada: a mesma peça sobe, uma desbota enquanto a outra acende. */
const SUBIDA_DA_FALA = { type: 'spring', visualDuration: 0.45, bounce: 0.15 } as const;

/**
 * A legenda: rótulo em mono na cor de quem fala, e só o agora com brilho.
 *
 * A sua fala cheia e a recuada são a mesma peça para a Motion (`layoutId`): quando a resposta
 * dele chega, ela sobe para o lugar de cima em vez de trocar seco. Só a posição anda
 * (`layout="position"`) — escalar o bloco esticaria a letra no meio do caminho; o tamanho troca
 * no esmaecer cruzado. `popLayout` tira a que sai do fluxo, então a resposta dele não espera.
 */
export function LegendaDaVoz({ trechos, nome }: { trechos: TrechoDaLegenda[]; nome: string }) {
  if (trechos.length === 0) return null;
  const aoVivo = trechos.find((t) => t.quem === 'voce' && t.forma === 'ao-vivo');
  const daVoce = trechos.find((t) => t.quem === 'voce' && t.forma !== 'ao-vivo');
  const doZe = trechos.find((t) => t.quem === 'ze');
  return (
    <div className={styles.legenda}>
      {aoVivo ? (
        // As palavras enquanto ele fala: só para os olhos (o leitor de tela ouve o estado).
        <JanelaQueCorre key="ao-vivo" palavras={palavrasDe(aoVivo.texto)} dataFala="ao-vivo" oculta />
      ) : null}
      <MotionConfig reducedMotion="user" transition={SUBIDA_DA_FALA}>
        <AnimatePresence mode="popLayout" initial={false}>
          {daVoce?.forma === 'recuada' ? (
            <motion.p
              key="recuada"
              layoutId="fala-voce"
              layout="position"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={styles.recuada}
              data-fala="voce"
              data-forma="recuada"
            >
              {daVoce.naFila ? 'na fila · ' : null}“{daVoce.texto}”
            </motion.p>
          ) : daVoce?.forma === 'disse' ? (
            <motion.div
              key="disse"
              layoutId="fala-voce"
              layout="position"
              exit={{ opacity: 0 }}
              className={styles.trecho}
              data-quem="voce"
              data-fala="voce"
              data-forma="cheia"
            >
              <span className={styles.quem}>{daVoce.naFila ? 'Na fila' : 'Você disse'}</span>
              <div className={styles.corre}>
                <p className={styles.texto}>
                  {daVoce.texto === null ? (
                    <Reticencias />
                  ) : daVoce.firme ? (
                    `“${daVoce.texto}”`
                  ) : (
                    <span className={styles.parcial} data-fala="parcial">{daVoce.texto}</span>
                  )}
                </p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </MotionConfig>
      {doZe?.quem === 'ze' ? (
        <div key="ze" className={styles.trecho} data-quem="ze" data-fala="ze" data-forma={doZe.forma === 'pausada' ? 'pausada' : 'cheia'}>
          <span className={styles.quem}>{nome}</span>
          <FalaQueCorre fala={doZe.fala} pausada={doZe.forma === 'pausada'} />
        </div>
      ) : null}
    </div>
  );
}
