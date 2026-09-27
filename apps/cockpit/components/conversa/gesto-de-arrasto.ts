/**
 * Os gestos no lugar dos botões (fase 3): na conversa, arrastar para a esquerda leva ao
 * chat e arrastar para cima abre as configurações; no chat, arrastar para a direita volta
 * para a conversa. Arrasto não é toque: o dedo que andou mais que um toque nunca começa
 * nem para a conversa, mesmo quando não chega a ser gesto nenhum.
 */

export type Ponto = { x: number; y: number };
export type Leitura = 'toque' | 'esquerda' | 'direita' | 'cima' | 'baixo' | 'indeciso';

export const LIMIAR = {
  /** Até aqui (px) o dedo não andou: é toque. */
  toque: 10,
  /** Quanto (px) o dedo anda no eixo do gesto para contar. */
  arrasto: 56,
  /** "Claramente" numa direção: o eixo do gesto vale pelo menos o dobro do outro. */
  dominancia: 2,
  /** Nas bordas laterais (px) mora o voltar e o avançar do Safari: dali não começa gesto. */
  borda: 24,
} as const;

export function leArrasto(inicio: Ponto, fim: Ponto): Leitura {
  const dx = fim.x - inicio.x;
  const dy = fim.y - inicio.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.hypot(dx, dy) <= LIMIAR.toque) return 'toque';
  if (ax >= LIMIAR.arrasto && ax >= ay * LIMIAR.dominancia) return dx < 0 ? 'esquerda' : 'direita';
  if (ay >= LIMIAR.arrasto && ay >= ax * LIMIAR.dominancia) return dy < 0 ? 'cima' : 'baixo';
  return 'indeciso';
}

const longeDasBordas = (x: number, largura: number) => x >= LIMIAR.borda && x <= largura - LIMIAR.borda;

export type GestoDaConversa = 'toque' | 'chat' | 'configuracoes' | 'nada';

/**
 * `faixaDeBaixo` é o y (px) onde começa a faixa de baixo — a área segura mais ~40 px. A
 * borda de baixo é do iPhone (manda o app para o fundo): arrasto para cima começado
 * nela não abre nada.
 */
export function gestoDaConversa(
  inicio: Ponto,
  fim: Ponto,
  tela: { largura: number; faixaDeBaixo: number },
): GestoDaConversa {
  const leitura = leArrasto(inicio, fim);
  if (leitura === 'toque') return 'toque';
  if (leitura === 'esquerda' && longeDasBordas(inicio.x, tela.largura)) return 'chat';
  if (leitura === 'cima' && inicio.y < tela.faixaDeBaixo) return 'configuracoes';
  return 'nada';
}

export function gestoDoChat(inicio: Ponto, fim: Ponto, largura: number): 'conversa' | 'nada' {
  return leArrasto(inicio, fim) === 'direita' && longeDasBordas(inicio.x, largura) ? 'conversa' : 'nada';
}

/** O pedaço do `Element` que a origem lê — o teste monta a árvore sem DOM. */
export type NoDaOrigem = {
  tagName: string;
  isContentEditable?: boolean;
  scrollWidth: number;
  clientWidth: number;
  getAttribute(nome: string): string | null;
  parentElement: NoDaOrigem | null;
};

/* O composer é um `form`; as gavetas (tropa e painel) são `aside`. */
const CAMPOS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'FORM', 'ASIDE']);

/**
 * No chat, o arrasto não vale se começou dentro de algo editável (o composer), de gaveta
 * ou folha aberta, ou de algo que rola de lado (bloco de código, tabela): lá o dedo é
 * dele. `rolagemDeLado` devolve o `overflow-x` calculado do nó.
 */
export function origemImpedeArrasto(no: NoDaOrigem | null, rolagemDeLado: (no: NoDaOrigem) => string): boolean {
  for (let atual = no; atual !== null; atual = atual.parentElement) {
    if (CAMPOS.has(atual.tagName.toUpperCase()) || atual.isContentEditable === true) return true;
    if (atual.getAttribute('role') === 'dialog') return true;
    const rola = rolagemDeLado(atual);
    if ((rola === 'auto' || rola === 'scroll') && atual.scrollWidth > atual.clientWidth + 1) return true;
  }
  return false;
}

/**
 * O clique que o navegador ainda solta depois de um arrasto não é toque. Clique de teclado
 * (`detail` 0: Enter ou espaço no botão) sempre vale.
 */
export function cliqueVale(detail: number, dedoAndou: boolean): boolean {
  return detail === 0 || !dedoAndou;
}
