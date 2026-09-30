import type { Cena } from './moldura-estado.ts';

const ROTULO: Record<Cena, string> = {
  parado: 'na linha',
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
export function rotuloDoEstado(cena: Cena): string {
  return ROTULO[cena];
}

/**
 * O que a tela parada escreve, com ou sem "Mostrar texto": uma linha pequena sob a animação —
 * quem chama o toque é o pulso, não a letra. Número técnico
 * (o tempo do detector) mora nas configurações. Com a conversa andando, quem fala é o estado.
 */
export function conviteDaTela(cena: Cena, preparacaoFalhou: boolean, retomando = false): string | null {
  if (preparacaoFalhou) return null;
  if (cena === 'preparando') return 'preparando a escuta';
  if (cena !== 'parado') return null;
  // Voltou da recarga com a conversa aberta: o toque não começa outra, continua esta.
  return retomando ? 'toque para continuar' : 'toque para ligar';
}
