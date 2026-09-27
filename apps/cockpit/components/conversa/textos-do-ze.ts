import type { MessagePayload } from '@grupo_borges/cockpit-core/messages-types';

export type TextoDoZe = { id: number; texto: string };

export function maiorIdDasMensagens(
  mensagens: readonly MessagePayload[],
  piso = 0,
): number {
  let maior = piso;
  for (const mensagem of mensagens) maior = Math.max(maior, mensagem.id);
  return maior;
}

export function textosDoZeDepoisDe(
  mensagens: readonly MessagePayload[],
  depoisDe: number,
): TextoDoZe[] {
  const textos: TextoDoZe[] = [];

  for (const item of mensagens) {
    if (item.id <= depoisDe || item.kind !== 'assistant' || item.message?.role !== 'assistant') {
      continue;
    }

    const conteudo = item.message.content;
    if (typeof conteudo === 'string') {
      const texto = conteudo.trim();
      if (texto) textos.push({ id: item.id, texto });
      continue;
    }

    for (const parte of conteudo) {
      if (parte.type !== 'text') continue;
      const texto = parte.text.trim();
      if (texto) textos.push({ id: item.id, texto });
    }
  }

  return textos;
}
