'use client';

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

/** A legenda: rótulo em mono na cor de quem fala, e só o agora com brilho. */
export function LegendaDaVoz({ trechos, nome }: { trechos: TrechoDaLegenda[]; nome: string }) {
  if (trechos.length === 0) return null;
  return (
    <div className={styles.legenda}>
      {trechos.map((t) => {
        if (t.forma === 'ao-vivo') {
          // As palavras enquanto ele fala: só para os olhos (o leitor de tela ouve o estado).
          return <JanelaQueCorre key="ao-vivo" palavras={palavrasDe(t.texto)} dataFala="ao-vivo" oculta />;
        }
        if (t.forma === 'recuada') {
          return (
            <p key="recuada" className={styles.recuada} data-fala="voce" data-forma="recuada">
              “{t.texto}”
            </p>
          );
        }
        if (t.quem === 'voce') {
          return (
            <div key="disse" className={styles.trecho} data-quem="voce" data-fala="voce" data-forma="cheia">
              <span className={styles.quem}>Você disse</span>
              <div className={styles.corre}>
                <p className={styles.texto}>
                  {t.texto === null ? (
                    <Reticencias />
                  ) : t.firme ? (
                    `“${t.texto}”`
                  ) : (
                    <span className={styles.parcial} data-fala="parcial">{t.texto}</span>
                  )}
                </p>
              </div>
            </div>
          );
        }
        return (
          <div key="ze" className={styles.trecho} data-quem="ze" data-fala="ze" data-forma={t.forma === 'pausada' ? 'pausada' : 'cheia'}>
            <span className={styles.quem}>{nome}</span>
            <FalaQueCorre fala={t.fala} pausada={t.forma === 'pausada'} />
          </div>
        );
      })}
    </div>
  );
}
