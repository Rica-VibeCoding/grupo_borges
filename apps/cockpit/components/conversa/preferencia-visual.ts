/**
 * Qual visual a tela de conversa desenha. A escolha é do Rica, feita dentro da
 * própria tela, e mora no `localStorage` do aparelho — não passa pelo backend.
 *
 * Cada opção tem duas variações. Opção ainda não entregue aparece na chave,
 * desabilitada, e nunca é devolvida por `leVisual`: um valor gravado por uma
 * versão futura cai no padrão em vez de quebrar a tela.
 */

export type Opcao = 'moldura' | 'esfera' | 'esferaMoldura';
export type Visual = { opcao: Opcao; variacao: string };

export type Variacao = { id: string; nome: string; descricao: string };
export type ItemDoCatalogo = {
  opcao: Opcao;
  nome: string;
  disponivel: boolean;
  variacoes: readonly Variacao[];
};

export const CATALOGO: readonly ItemDoCatalogo[] = [
  {
    opcao: 'moldura',
    nome: 'Moldura',
    disponivel: true,
    variacoes: [
      { id: 'fio', nome: 'Fio', descricao: 'Uma linha de luz rente à borda.' },
      { id: 'aurora', nome: 'Aurora', descricao: 'Uma névoa larga que entra pela borda.' },
    ],
  },
  { opcao: 'esfera', nome: 'Esfera', disponivel: false, variacoes: [] },
  { opcao: 'esferaMoldura', nome: 'Esfera e moldura', disponivel: false, variacoes: [] },
];

export const VISUAL_PADRAO: Visual = { opcao: 'moldura', variacao: 'fio' };
export const CHAVE_VISUAL = 'ck-conversa-visual';

export function gravaVisual(visual: Visual): string {
  return `${visual.opcao}/${visual.variacao}`;
}

export function leVisual(bruto: string | null | undefined): Visual {
  if (!bruto) return VISUAL_PADRAO;
  const [opcao, variacao] = bruto.split('/');
  const item = CATALOGO.find((i) => i.opcao === opcao);
  if (!item?.disponivel) return VISUAL_PADRAO;
  if (!item.variacoes.some((v) => v.id === variacao)) {
    return { opcao: item.opcao, variacao: item.variacoes[0].id };
  }
  return { opcao: item.opcao, variacao: variacao as string };
}

export function nomeDoVisual(visual: Visual): string {
  const item = CATALOGO.find((i) => i.opcao === visual.opcao);
  const variacao = item?.variacoes.find((v) => v.id === visual.variacao);
  return item && variacao ? `${item.nome}, ${variacao.nome.toLowerCase()}` : 'Moldura';
}
