import type { ItemDoFeed } from './grupo-ferramentas.ts';

/**
 * Identidade estável de um item, para o virtualizador não perder a medição
 * quando a lista cresce.
 *
 * `uuid || id` é a mesma régua do `refDe` da ponte antiga. Os kinds sem
 * `payload` têm chave natural própria — sem isso cairiam no índice, e o índice
 * muda quando qualquer coisa antes deles muda. O grupo de ferramentas ancora
 * no PRIMEIRO membro: a run só cresce para a direita, então a chave — e o
 * estado de aberto/fechado — sobrevive ao grupo engordando no stream.
 */
export function chaveDe(item: ItemDoFeed): string {
  switch (item.kind) {
    case 'sidechain-group':
      return `sg-${item.rootUuid}`;
    case 'sidechain-cluster':
      return `sc-${item.groups[0]?.rootUuid ?? 'sem-raiz'}`;
    case 'ask-user':
      return `ask-${item.entry.request_id}`;
    case 'grupo-ferramentas':
      return `gf-${item.itens[0]?.payload.uuid ?? 'sem-raiz'}`;
    case 'linha-viva':
      // Uma só por feed, sempre na ponta: a chave fixa é o que preserva o
      // componente (e o relógio que já está correndo) entre flushes.
      return 'linha-viva';
    default:
      return item.payload.uuid || String(item.payload.id);
  }
}
