import type { Cena } from './moldura-estado.ts';

/**
 * Como a foto do agente entra na tela de voz — escolha do Rica em 28/09, entre as
 * maquetes de `docs/modo-conversa/fase4-direcoes/`:
 *
 * - **Atividade ao vivo (B)**: a foto numa pílula no alto, com o nome e o estado;
 *   o visual escolhido (esfera, moldura) fica com o palco.
 * - **Eclipse (C)**: a foto é o núcleo, grande e quase apagada, cercada por um
 *   anel de traços que é o medidor da voz.
 *
 * Mora no `localStorage` do aparelho, como as outras escolhas da folha de
 * configurações. Valor desconhecido cai no padrão em vez de quebrar a tela.
 */

export type Direcao = 'atividade' | 'eclipse';
export type ItemDaDirecao = { id: Direcao; nome: string; descricao: string };

export const DIRECOES: readonly ItemDaDirecao[] = [
  { id: 'atividade', nome: 'Atividade ao vivo', descricao: 'A foto no alto, com o nome e o estado.' },
  { id: 'eclipse', nome: 'Eclipse', descricao: 'A foto no centro, cercada pelo medidor da voz.' },
];

export const DIRECAO_PADRAO: Direcao = 'atividade';
export const CHAVE_DIRECAO = 'ck-conversa-direcao';

export function gravaDirecao(direcao: Direcao): string {
  return direcao;
}

export function leDirecao(bruto: string | null | undefined): Direcao {
  return DIRECOES.find((d) => d.id === bruto)?.id ?? DIRECAO_PADRAO;
}

const ROTULO: Record<Exclude<Cena, 'parado'>, string> = {
  preparando: 'preparando',
  ouvindo: 'ouvindo',
  transcrevendo: 'entendendo',
  esperandoZe: 'pensando',
  trabalhando: 'trabalhando',
  falando: 'falando',
  interrompendo: 'pausado',
  erro: 'parou',
  ocupado: 'parou', // só a cor muda; o cartão do pé diz que ele está ocupado
  pronta: 'resposta pronta', // voltou da recarga: a resposta dele espera o toque
  desligado: 'desligado', // o painel diz que ele está fora do ar
};

/** A palavra ao lado do nome: em que pé a conversa está, de relance. */
export function rotuloDoEstado(direcao: Direcao, cena: Cena): string {
  if (cena === 'parado') return direcao === 'eclipse' ? 'em espera' : 'na linha';
  return ROTULO[cena];
}

/**
 * O que a tela parada escreve, com ou sem "Mostrar texto": uma linha pequena sob a animação,
 * a mesma nas duas direções — quem chama o toque é o pulso do aro, não a letra. Número técnico
 * (o tempo do detector) mora nas configurações. Com a conversa andando, quem fala é o estado.
 */
export function conviteDaTela(cena: Cena, preparacaoFalhou: boolean, retomando = false): string | null {
  if (preparacaoFalhou) return null;
  if (cena === 'preparando') return 'preparando a escuta';
  if (cena !== 'parado') return null;
  // Voltou da recarga com a conversa aberta: o toque não começa outra, continua esta.
  return retomando ? 'toque para continuar' : 'toque para ligar';
}
