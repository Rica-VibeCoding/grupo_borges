/**
 * A aritmética do arrasto — separada do componente de propósito.
 *
 * O cockpit não tem jsdom nem Testing Library (`package.json`: o `test` roda
 * `node --test` sobre módulos `.ts`), então tudo que puder errar sozinho mora
 * aqui, onde o teste alcança. No `tropa.tsx` sobra o fio: refs, efeito e
 * pintura.
 *
 * As três funções cobrem os três momentos de um arrasto:
 * soltar (`novaOrdem`), mostrar antes do servidor responder
 * (`aplicaOrdem`) e saber quando parar de mostrar (`ordemJaChegou`).
 */
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

/** Metade da linha em que o ponteiro soltou — vem do `attachClosestEdge`. */
export type BordaAlvo = 'top' | 'bottom' | null;

/**
 * Onde a linha arrastada vai parar.
 *
 * Tira o arrastado da lista ANTES de procurar o alvo. É o passo que evita o
 * erro clássico de deslocamento: com o item ainda dentro, o índice do alvo vale
 * uma coisa quando se arrasta pra cima e outra quando se arrasta pra baixo, e a
 * correção vira um `+1` condicional que ninguém consegue ler depois.
 */
export function novaOrdem(
  slugs: string[],
  arrastado: string,
  alvo: string,
  borda: BordaAlvo,
): string[] {
  if (arrastado === alvo) return slugs;
  if (!slugs.includes(arrastado) || !slugs.includes(alvo)) return slugs;

  const semArrastado = slugs.filter((slug) => slug !== arrastado);
  const posicaoDoAlvo = semArrastado.indexOf(alvo);
  const destino = borda === 'bottom' ? posicaoDoAlvo + 1 : posicaoDoAlvo;

  return [...semArrastado.slice(0, destino), arrastado, ...semArrastado.slice(destino)];
}

/**
 * Pinta a ordem nova sem esperar o servidor.
 *
 * O `/api/fleet` só é relido no próximo poll (5s), e sem isto a linha voltaria
 * pro lugar antigo no instante seguinte ao dedo sair da tela — o "pular de
 * volta" que a pesquisa do Canário mapeou como o defeito mais relatado.
 *
 * Agente que a ordem otimista não conhece (entrou na frota entre o arrasto e o
 * poll) vai pro fim em vez de sumir: a lista mostrada nunca tem menos gente do
 * que a lista recebida.
 */
export function aplicaOrdem(agentes: Agent[], ordem: string[] | null): Agent[] {
  if (!ordem) return agentes;

  const porSlug = new Map(agentes.map((agente) => [agente.slug, agente]));
  const naOrdem = ordem
    .map((slug) => porSlug.get(slug))
    .filter((agente): agente is Agent => agente !== undefined);
  const forasteiros = agentes.filter((agente) => !ordem.includes(agente.slug));

  return [...naOrdem, ...forasteiros];
}

/**
 * O servidor já devolveu a ordem que estamos fingindo?
 *
 * Enquanto for `false` a ordem otimista continua mandando. Comparar as duas
 * listas é o que dispensa cronômetro: sem isto, ou se descarta a ordem otimista
 * cedo demais (a linha pula) ou se segura ela pra sempre (o painel para de
 * refletir o banco).
 */
export function ordemJaChegou(agentes: Agent[], ordem: string[] | null): boolean {
  if (!ordem) return true;
  // Compara só quem existe dos dois lados, na sequência RELATIVA. Comparar o
  // tamanho travava a camada pra sempre quando a frota mudava no meio: um
  // agente que entra ou sai entre o arrasto e o poll fazia a contagem nunca
  // mais bater, a ordem otimista nunca era descartada e o painel parava de
  // refletir o banco até desmontar.
  const vindos = agentes.map((agente) => agente.slug);
  const emAmbos = new Set(vindos.filter((slug) => ordem.includes(slug)));
  const doServidor = vindos.filter((slug) => emAmbos.has(slug));
  const daOtimista = ordem.filter((slug) => emAmbos.has(slug));
  return (
    doServidor.length === daOtimista.length &&
    doServidor.every((slug, i) => slug === daOtimista[i])
  );
}

/** As duas listas têm o mesmo conteúdo, na mesma sequência. */
export function mesmaOrdem(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((slug, i) => slug === b[i]);
}

/**
 * Move um slug uma casa pra cima (`-1`) ou pra baixo (`1`). É a entrada do
 * teclado, e vive aqui pelo mesmo motivo que o resto: são dois deslocamentos
 * que se cancelam — o vizinho de destino e a borda em que se encosta — e
 * errar o sinal de um deles só apareceria no aparelho.
 *
 * Devolve a MESMA lista quando não há pra onde ir (primeiro subindo, último
 * descendo): quem chama usa isso pra não gastar requisição.
 */
export function moveUmaCasa(slugs: string[], slug: string, direcao: -1 | 1): string[] {
  const destino = slugs.indexOf(slug) + direcao;
  if (slugs.indexOf(slug) === -1 || destino < 0 || destino >= slugs.length) return slugs;
  return novaOrdem(slugs, slug, slugs[destino], direcao === 1 ? 'bottom' : 'top');
}
