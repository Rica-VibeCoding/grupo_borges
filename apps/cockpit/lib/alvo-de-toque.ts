import type { CSSProperties } from 'react';

/**
 * Área de toque de 44px sem mexer no desenho.
 *
 * Os três controles da base do composer (parar, voz, seletor de motor) têm 32px
 * de altura por decisão de desenho — eles dividem a mesma linha e o rótulo do
 * motor é metadado, não controle de massa. Mas 32px é alvo de toque, e medindo
 * no celular em 15/08 os três davam 32px de alvo, abaixo do `--ck-touch-min`
 * que o resto da casa respeita.
 *
 * A saída é a de sempre para este caso: o pixel continua com 32, a diferença
 * entra como `padding` (com `content-box`, para não inflar a caixa visual) e sai
 * de novo como margem negativa igual — o layout não anda um pixel e o dedo ganha
 * os 44. Mesma técnica já aplicada no botão de ouvir da bolha de voz.
 *
 * Só serve onde não há outro controle a menos de 12px na vertical: alvo ampliado
 * que encosta no vizinho rouba o toque dele. Na base do composer não há (medido:
 * acima é `div`, abaixo é o `form`).
 */
const FOLGA = 'calc((var(--ck-touch-min) - 32px) / 2)';

export const ALVO_DE_TOQUE: CSSProperties = {
  boxSizing: 'content-box',
  padding: FOLGA,
  margin: `calc(${FOLGA} * -1)`,
};

/**
 * A base do composer já subia os controles com `--ck-space-1` negativo para
 * casar com a linha do texto. A folga de toque entra somada, senão o botão
 * desce os 6px que o padding acrescentou.
 */
export const MARGEM_INFERIOR_DA_BASE = `calc(var(--ck-space-1) * -1 - ${FOLGA})`;

/**
 * NÃO usar nas linhas do feed ("Executou 3 comandos", "exec: …"). Cheguei a
 * escrever a variante para elas e voltei atrás: a nota 5 do `linha-execucao.tsx`
 * já decidiu 32px ali, e pelo motivo certo — linhas adjacentes cobrem cada
 * pixel, então alvo ampliado abre a vizinha em vez de acertar a que o dedo
 * mirou. Minha medição de 126–180px de folga tinha pegado um feed onde as
 * linhas estavam separadas por bolhas; em corrida densa elas se encostam.
 */
