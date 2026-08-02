// O grupo de ferramentas — §7 do contrato, na largura da conversa real.
//
// O `coalesceToolGroups` do core foi o modelo algorítmico (run consecutiva,
// 1 fica como está, 2+ viram grupo, membros preservados inteiros — o grupo é
// hospedeiro, não resumo). Mas ele só enxerga `chip` de ferramenta, e o
// classificador só EMITE chip quando o tool_result casado tem mais de 300
// caracteres. Na conversa real medida (400 mensagens, 02/08): 148 execuções,
// só 18 viraram chip — as outras 130 ficam como item `assistant` cujas parts
// são só `tool_use`, que é como TODA ferramenta aparece enquanto o resultado
// não chega (e para sempre, quando a saída é curta). Agrupar só os chips
// deixaria 82% da atividade fora da linha — exatamente a parede que a ordem
// do Rica manda virar UMA linha.
//
// Então a família que agrupa aqui é a LINHA DE TRABALHO, não o chip: chip de
// ferramenta ∪ assistant cuja única coisa visível é tool_use. O thinking oco
// já saiu no `temConteudoVisivel` (pipeline), mas uma mensagem pode trazer
// thinking vazio JUNTO do tool_use — a régua abaixo é a mesma dos renderers:
// o que não pinta nada não desempata a run.
//
// Lógica pura, sem React: o `node --test` roda este módulo direto. O resumo
// verbal do grupo (a frase "Executou 6 comandos, leu um arquivo") mora no
// irmão `resumo-do-grupo.ts`; o desenho, em `grupo-ferramentas.tsx`.

import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';

export type ChipDeFerramenta = Extract<RenderItem, { kind: 'chip' }>;
export type AssistenteDeTrabalho = Extract<RenderItem, { kind: 'assistant' }>;

/** O que pode entrar num grupo: um chip de ferramenta ou um assistant que só
 *  tem tool_use visível. Os dois são preservados inteiros dentro do grupo. */
export type MembroDoGrupo = ChipDeFerramenta | AssistenteDeTrabalho;

export type GrupoFerramentas = {
  kind: 'grupo-ferramentas';
  itens: MembroDoGrupo[];
};

/** A LINHA VIVA — o "está acontecendo agora" quando a corrida trabalha MAS
 *  ainda não tocou em nenhuma ferramenta (ou está entre uma e outra): o
 *  intervalo entre o Rica mandar e o agente agir, que antes era tela muda.
 *  Nasce sintética no fim do feed (feed-da-conversa.tsx), nunca do
 *  classificador — por isso não tem `payload`. `desdeMs` ancora o tempo
 *  decorrido, que conta sozinho no cliente. Quando o trabalho de verdade
 *  aparece, ela é SUBSTITUÍDA por ele — não some deixando buraco. */
export type LinhaViva = {
  kind: 'linha-viva';
  desdeMs: number;
};

/** A saída do pipeline do feed: tudo que o core produz, menos `tool-group`
 *  (esta passada o substitui — ver o cabeçalho), mais o grupo amplo. */
export type ItemDoFeed = Exclude<RenderItem, { kind: 'tool-group' }> | GrupoFerramentas | LinhaViva;

/** É linha de trabalho? A régua do assistant é a MESMA do `temConteudoVisivel`
 *  e da `Parte`: texto e thinking só contam quando têm caractere; tool_result
 *  órfão desenha linha seca, não é trabalho. */
export function ehLinhaDeTrabalho(item: RenderItem): boolean {
  if (item.kind === 'chip') return item.classifierKind === 'tool';
  if (item.kind !== 'assistant') return false;
  let temToolUse = false;
  for (const parte of item.parts) {
    switch (parte.type) {
      case 'tool_use':
        temToolUse = true;
        break;
      case 'tool_result':
        return false;
      case 'text':
        if (/\S/.test(parte.text)) return false;
        break;
      case 'thinking':
        if (/\S/.test(parte.thinking)) return false;
        break;
    }
  }
  return temToolUse;
}

/**
 * §7 com a largura real: colapsa runs consecutivas de linhas de trabalho num
 * `GrupoFerramentas`. 1 isolada fica como está — uma ferramenta sozinha já é
 * a linha discreta. Nenhum `tool-group` atravessa: esta passada o subsumes.
 */
export function agrupaFerramentas(itens: readonly RenderItem[]): ItemDoFeed[] {
  const saida: ItemDoFeed[] = [];
  let indice = 0;
  while (indice < itens.length) {
    const atual = itens[indice];
    if (!ehLinhaDeTrabalho(atual)) {
      saida.push(atual as ItemDoFeed);
      indice++;
      continue;
    }
    let fim = indice + 1;
    while (fim < itens.length && ehLinhaDeTrabalho(itens[fim])) fim++;
    if (fim - indice === 1) {
      saida.push(atual as ItemDoFeed);
    } else {
      saida.push({
        kind: 'grupo-ferramentas',
        itens: itens.slice(indice, fim) as MembroDoGrupo[],
      });
    }
    indice = fim;
  }
  return saida;
}
