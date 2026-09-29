import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

export function cabecalhoDaFerramenta(mensagens: readonly MessagePayload[]): string | null {
  for (let i = mensagens.length - 1; i >= 0; i -= 1) {
    const item = mensagens[i];
    if (item.is_sidechain) continue;
    const conteudo = item.message?.content;
    if (item.message?.role === 'assistant' && Array.isArray(conteudo)) {
      for (let j = conteudo.length - 1; j >= 0; j -= 1) {
        const parte = conteudo[j];
        if (parte?.type !== 'tool_use') continue;
        const entrada = parte.input;
        if (!entrada || typeof entrada !== 'object' || !('description' in entrada)) return null;
        const descricao = entrada.description;
        if (typeof descricao !== 'string' || descricao.length > 120 || /[/\\`|$={}<>]/u.test(descricao)) return null;
        const palavras = descricao.normalize('NFC').toLowerCase().match(/\p{L}+/gu) ?? [];
        const portugues = palavras.some((palavra) =>
          /[áàâãéêíóôõúüç]/u.test(palavra) || /^(tô|o|a|de|do|da|e|que|pra)$/u.test(palavra));
        return portugues ? descricao : null;
      }
    }
    if (item.message?.role === 'user') {
      if (Array.isArray(conteudo) && conteudo.some((parte) => parte?.type === 'tool_result')) continue;
      return null;
    }
  }
  return null;
}
