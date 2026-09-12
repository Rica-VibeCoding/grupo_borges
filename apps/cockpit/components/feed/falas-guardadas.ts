/**
 * O ÁUDIO JÁ PAGO DA ABA, guardado por texto. Sem React, sem DOM além do
 * `URL.revokeObjectURL`.
 *
 * POR QUE ISSO EXISTE. A `GOOGLE_TTS_API_KEY` é uma só pra frota inteira e o
 * Google cobra por caractere sintetizado — agosto fechou 1.239.745 caracteres.
 * A bolha do cockpit v2 não guardava nada: quando a fala terminava, a fase
 * voltava pra `parada` e o toque seguinte reabria o stream e pagava o MESMO
 * texto de novo. O app/web antigo já guardava (o `urlRef` do `BubbleAudio` em
 * chat-messages.tsx); o v2 perdeu isso ao trocar a síntese inteira pela
 * síntese por sentença.
 *
 * POR QUE EM ESCOPO DE MÓDULO E NÃO NUM `useRef` DA BOLHA. O feed é
 * virtualizado (`@tanstack/react-virtual`): o item que sai da janela é
 * DESMONTADO, e com ele iria o cache da bolha. Guardado aqui, o áudio sobrevive
 * a rolar o feed e voltar — que é exatamente como o Rica lê no celular.
 *
 * O QUE ENTRA. Só fala COMPLETA (o `done` do stream). Meia fala guardada
 * terminaria antes da resposta acabar no retoque, e isso lê como defeito. E
 * entra junto o `EstadoRevelacao` inteiro: sem os peaks, o retoque tocaria com
 * a onda vazia — a régua é que o passado não muda, então a segunda escuta
 * precisa mostrar a MESMA onda da primeira.
 *
 * QUEM REVOGA. Este módulo, e só ele, para o que está guardado: a bolha revoga
 * apenas as URLs da fala em curso, que nunca chegaram aqui. Revogar cedo é pior
 * que re-sintetizar — URL de objeto revogada não toca e não avisa.
 */

import type { EstadoRevelacao } from './bolha-voz.ts';

export type FalaGuardada = {
  /** MP3 por sentença, na ordem de reprodução, como URL de objeto. */
  urls: readonly string[];
  /** A onda como ela ficou no fim da síntese — peaks, durações e a real. */
  est: EstadoRevelacao;
  /** O aviso de "voz alternativa" acompanha o áudio que ele descreve. */
  degradada: boolean;
};

/**
 * Teto de falas guardadas. Cada MP3 mora na memória da aba até ser revogado, e
 * quem lê isso lê no iPhone: ~400 kB por resposta longa dá uns 4 MB no teto,
 * que é o preço de não pagar a mesma fala de novo. Estourou, sai a menos ouvida.
 */
export const TETO_FALAS = 10;

/** Ordem de inserção do `Map` = ordem de uso, porque ler reinsere no fim. */
const guardadas = new Map<string, FalaGuardada>();

function revoga(urls: readonly string[]): void {
  for (const url of urls) URL.revokeObjectURL(url);
}

/**
 * Guarda a fala inteira sob o texto que a gerou. Re-sintetizar o mesmo texto
 * (fala anterior interrompida, por exemplo) substitui a entrada e revoga o
 * áudio velho — senão cada tentativa deixaria um MP3 órfão na memória.
 */
export function guardaFala(texto: string, fala: FalaGuardada): void {
  const anterior = guardadas.get(texto);
  if (anterior !== undefined) {
    guardadas.delete(texto);
    revoga(anterior.urls);
  }
  guardadas.set(texto, fala);

  while (guardadas.size > TETO_FALAS) {
    const maisVelha = guardadas.keys().next();
    if (maisVelha.done === true) break;
    const expulsa = guardadas.get(maisVelha.value);
    guardadas.delete(maisVelha.value);
    if (expulsa !== undefined) revoga(expulsa.urls);
  }
}

/**
 * A fala pronta pra este texto, ou `null` se ela nunca foi sintetizada (ou já
 * saiu pelo teto). Ler renova a posição: a resposta que o Rica volta a ouvir
 * não é a que a próxima fala expulsa.
 */
export function falaGuardada(texto: string): FalaGuardada | null {
  const fala = guardadas.get(texto);
  if (fala === undefined) return null;
  guardadas.delete(texto);
  guardadas.set(texto, fala);
  return fala;
}

/** Só pra teste: a aba real nasce vazia e nunca precisa esvaziar. */
export function esqueceTudo(): void {
  for (const fala of guardadas.values()) revoga(fala.urls);
  guardadas.clear();
}
