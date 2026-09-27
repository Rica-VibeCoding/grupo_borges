import type { Cena } from './moldura-estado.ts';

/**
 * Qual visual a tela de conversa desenha. A escolha é do Rica, feita dentro da
 * própria tela, e mora no `localStorage` do aparelho — não passa pelo backend.
 *
 * Cada opção tem duas variações. Valor desconhecido (lixo, ou gravado por uma
 * versão futura) cai no padrão em vez de quebrar a tela.
 */

export type Opcao = 'moldura' | 'esfera' | 'esferaMoldura';
export type Visual = { opcao: Opcao; variacao: string };
export type VariacaoMoldura = 'fio' | 'aurora';
export type VariacaoEsfera = 'materia' | 'vidro';

export type Variacao = { id: string; nome: string; descricao: string };
export type ItemDoCatalogo = { opcao: Opcao; nome: string; variacoes: readonly Variacao[] };

export const CATALOGO: readonly ItemDoCatalogo[] = [
  {
    opcao: 'moldura',
    nome: 'Moldura',
    variacoes: [
      { id: 'fio', nome: 'Fio', descricao: 'Uma linha de luz rente à borda.' },
      { id: 'aurora', nome: 'Aurora', descricao: 'Uma névoa larga que entra pela borda.' },
    ],
  },
  {
    opcao: 'esfera',
    nome: 'Esfera',
    variacoes: [
      { id: 'materia', nome: 'Matéria', descricao: 'Uma esfera sólida que ondula com a voz.' },
      { id: 'vidro', nome: 'Vidro', descricao: 'Uma bolha de vidro com a luz por dentro.' },
    ],
  },
  {
    opcao: 'esferaMoldura',
    nome: 'Esfera e moldura',
    variacoes: [
      { id: 'juntas', nome: 'Juntas', descricao: 'A esfera e a borda mostram o mesmo momento.' },
      { id: 'divididas', nome: 'Divididas', descricao: 'A borda é a sua vez; a esfera é a vez dele.' },
    ],
  },
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
  if (!item) return VISUAL_PADRAO;
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

/** O que cada peça desenha; `null` = a peça não entra nesta opção. */
export type Pecas = {
  moldura: { cena: Cena; variacao: VariacaoMoldura } | null;
  esfera: { cena: Cena; variacao: VariacaoEsfera } | null;
};

/**
 * Da escolha às peças na tela. Na combinação, "Juntas" mostra o mesmo momento
 * nas duas; em "Divididas" a borda é a sua vez e a esfera é a vez dele, e cada
 * uma descansa (cena `parado`) enquanto a outra fala. Na interrupção as duas
 * aparecem: você sobe pela borda, ele congela na esfera.
 */
export function pecasDoVisual(visual: Visual, cena: Cena): Pecas {
  if (visual.opcao === 'moldura') {
    return { moldura: { cena, variacao: visual.variacao === 'aurora' ? 'aurora' : 'fio' }, esfera: null };
  }
  if (visual.opcao === 'esfera') {
    return { moldura: null, esfera: { cena, variacao: visual.variacao === 'vidro' ? 'vidro' : 'materia' } };
  }
  if (visual.variacao !== 'divididas') {
    return { moldura: { cena, variacao: 'fio' }, esfera: { cena, variacao: 'materia' } };
  }
  const vezDele = cena === 'transcrevendo' || cena === 'esperandoZe' || cena === 'falando';
  const suaVez = cena === 'ouvindo' || cena === 'preparando';
  return {
    moldura: { cena: vezDele ? 'parado' : cena === 'interrompendo' ? 'ouvindo' : cena, variacao: 'fio' },
    esfera: { cena: suaVez ? 'parado' : cena, variacao: 'materia' },
  };
}
