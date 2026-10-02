import type { Conversa } from '../../lib/conversa/tipos.ts';
import { falaNaEspera } from '../../lib/conversa/maquina.ts';
import { umaFalaAberta } from '../../lib/conversa/uma-fala.ts';

/**
 * O que o botão do microfone (canto de baixo, à esquerda) mostra e faz. Sem fone, na vez dele, a
 * entrada fica fechada (`maquina.ts`) e o botão diz isso; o toque abre só para uma fala, sem frear
 * (`uma-fala.ts`). Fora disso ele é o mudo, como sempre. Com fone, a espera já ouve: nada muda.
 * - `aberta`: ouve quando é a vez dele — toque silencia;
 * - `mudo`: silenciado por ele — toque liga;
 * - `fechada`: o Zé pensando ou trabalhando — toque abre para uma fala;
 * - `fechadaSemToque`: a voz do Zé tocando (abrir pegaria o eco dela; para falar por cima, o toque
 *   na tela interrompe) ou a uma fala transcrevendo — fechada, e o toque não faz nada;
 * - `umaFala`: aberta só para esta fala — toque, antes de falar, fecha de novo.
 */
export type EntradaDoMicrofone = 'aberta' | 'mudo' | 'fechada' | 'fechadaSemToque' | 'umaFala';
export type ToqueDoMicrofone = 'mudar' | 'abrirUmaFala' | 'fecharUmaFala' | 'nada';

export function entradaDoMicrofone(conversa: Conversa, fone: boolean, mudo: boolean): EntradaDoMicrofone {
  if (mudo) return 'mudo';
  if (fone) return 'aberta';
  if (umaFalaAberta(conversa)) return 'umaFala';
  if (conversa.estado === 'esperandoZe') return 'fechada';
  if (conversa.estado === 'falando' || (conversa.estado === 'transcrevendo' && falaNaEspera(conversa))) return 'fechadaSemToque';
  return 'aberta';
}

export function toqueDoMicrofone(entrada: EntradaDoMicrofone): ToqueDoMicrofone {
  switch (entrada) {
    case 'fechada': return 'abrirUmaFala';
    case 'umaFala': return 'fecharUmaFala';
    case 'fechadaSemToque': return 'nada';
    default: return 'mudar';
  }
}

export const ROTULO_DA_ENTRADA: Record<EntradaDoMicrofone, string> = {
  aberta: 'Silenciar microfone',
  mudo: 'Ligar microfone',
  fechada: 'Microfone fechado enquanto ele trabalha — tocar para falar sem interromper',
  fechadaSemToque: 'Microfone fechado',
  umaFala: 'Microfone aberto para uma fala — tocar para fechar',
};
