// "Item sem conteúdo visível não desenha NADA" — ordem do Rica, 02/08, com
// print: 39 de 43 itens do stream viravam só o padding vertical do feed. A
// fonte são mensagens `assistant` cujas parts não pintam nada — e o corpus
// explica o volume: 803 de 804 thinkings não têm texto (lib/thinking.ts), e
// cada uma virava um item oco.
//
// A régua aqui tem de ser a MESMA dos renderers, senão o feed volta a mostrar
// vazio por uma ponta: `Parte` (corpo-do-item.tsx) desenha texto só quando há
// caractere, `Thinking` devolve null quando o conteúdo é espaço em branco, e
// `tool_use`/`tool_result` sempre desenham (a linha de execução ou a linha
// seca de órfão). Todos os outros kinds nascem com conteúdo por construção —
// o filtro só tem trabalho no caso `assistant`.

import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';

import { leAnexoImagem } from '../../components/feed/anexo-imagem.ts';

export function temConteudoVisivel(item: RenderItem): boolean {
  // Segundo caso, 08/08: o envelope de imagem chega picado em duas mensagens
  // `user` desde que o CC passou a anexar a foto sozinho. A metade que não
  // trouxe nem o caminho nem a legenda — `[Image: source:]` de arquivo fora de
  // `uploads/`, ou o cabeçalho sem `Caption:` — não desenha nada e não pode
  // virar um balão com o caminho absoluto na tela do Rica.
  if (item.kind === 'user') {
    const anexo = leAnexoImagem(item.text);
    return anexo === null || anexo.filename !== null || anexo.legenda !== null;
  }
  if (item.kind !== 'assistant') return true;
  return item.parts.some((parte) => {
    switch (parte.type) {
      case 'tool_use':
      case 'tool_result':
        return true;
      case 'text':
        return /\S/.test(parte.text);
      case 'thinking':
        return /\S/.test(parte.thinking);
    }
  });
}
