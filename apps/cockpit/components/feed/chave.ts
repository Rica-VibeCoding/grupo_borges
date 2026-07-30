import type { RenderItem } from '@grupo_borges/cockpit-core/render-items';

/**
 * Identidade estável de um item, para o virtualizador não perder a medição
 * quando a lista cresce.
 *
 * `uuid || id` é a mesma régua do `refDe` da ponte antiga. Os três kinds sem
 * `payload` têm chave natural própria — sem isso cairiam no índice, e o índice
 * muda quando qualquer coisa antes deles muda.
 */
export function chaveDe(item: RenderItem): string {
  switch (item.kind) {
    case 'sidechain-group':
      return `sg-${item.rootUuid}`;
    case 'sidechain-cluster':
      return `sc-${item.groups[0]?.rootUuid ?? 'sem-raiz'}`;
    case 'ask-user':
      return `ask-${item.entry.request_id}`;
    default:
      return item.payload.uuid || String(item.payload.id);
  }
}
