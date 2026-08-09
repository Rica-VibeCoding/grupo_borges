/**
 * A régua da tela de MCPs — o que decide, fora do componente (`mcp-painel.tsx`).
 *
 * Nome deliberadamente DIFERENTE do componente — não `mcp-painel.ts` — depois
 * de bater no defeito documentado em
 * `reference_turbopack_self_import_ts_tsx_ambiguo.md`: `.ts`+`.tsx` de mesmo
 * nome resolve errado, e não só no self-import (o Turbopack acertou depois da
 * extensão explícita, mas o `tsc` do CONSUMIDOR externo — `page.tsx` — ainda
 * pegava o `.ts` sem export nenhum de componente). Seguindo a convenção
 * dominante do resto do shell (`acoes-rapidas.ts`/`bloco-de-acoes.tsx`,
 * `cota.ts`/`bloco-de-cota.tsx`, `estado.ts`/`tropa.tsx`): nomes de arquivo
 * distintos tiram a ambiguidade da raiz, em vez de depender de extensão
 * explícita em todo import presente e futuro.
 *
 * Escopo fechado à tab `mcps` do `matchesTab` (`@grupo_borges/cockpit-core/mcp-filter`):
 * a tarefa pediu a tela de MCPs, não o painel de recursos inteiro (skills +
 * subagentes já têm tabs prontas ali, mas ninguém pediu essa tela ainda — entrar
 * por elas agora seria escopo que a tarefa não abriu).
 */
import { matchesTab } from '@grupo_borges/cockpit-core/mcp-filter';
import type { McpServer } from '@grupo_borges/cockpit-core/api';

/** Só os servidores MCP de verdade, alfabéticos por nome — a ordem em que o
 *  back devolve mistura plugin/mcp_json/remote sem critério, e uma lista que
 *  reordena a cada refetch é pior que uma ordenada errado uma vez. */
export function servidoresMcp(servers: McpServer[]): McpServer[] {
  return servers
    .filter((s) => matchesTab(s, 'mcps'))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** Predicado de busca. Substring simples em nome e id, minúsculo — os dois
 *  campos são identificadores técnicos (`supabase-ze`, `claude.ai Supabase`),
 *  não texto livre, então não precisa de normalização de acento. */
export function combinaBusca(server: McpServer, termo: string): boolean {
  const alvo = termo.trim().toLocaleLowerCase('pt-BR');
  if (!alvo) return true;
  return (
    server.name.toLocaleLowerCase('pt-BR').includes(alvo) ||
    server.id.toLocaleLowerCase('pt-BR').includes(alvo)
  );
}

/** Rótulo pt-BR da origem — a segunda linha da fileira, junto do id. */
export function rotuloDaOrigem(kind: McpServer['kind']): string {
  switch (kind) {
    case 'plugin':
      return 'plugin';
    case 'mcp_json':
      return 'workspace';
    case 'remote':
      return 'claude.ai';
    case 'user_scope':
      return 'usuário';
    case 'agent_user':
      return 'subagente';
  }
}

/** Aviso de efeito colateral — só quando desligar ESTE server desliga mais do
 *  que ele. Hoje só acontece com `kind=plugin`: o toggle chama `claude plugin
 *  enable/disable`, que vale pro plugin inteiro, e um plugin pode expor mais
 *  de um tipo de recurso (o `vercel-plugin` real expõe skill+mcp+subagent+hook
 *  ao mesmo tempo). Desligar o MCP dele nesta tela desliga a skill junto, e
 *  quem só queria uma coisa perde a outra sem aviso — a menos que a gente
 *  avise aqui. */
export function avisoEfeitoColateral(server: McpServer): string | null {
  const provides = server.provides ?? [];
  if (server.kind !== 'plugin' || provides.length <= 1) return null;
  const outros = provides.filter((p) => p !== 'mcp');
  if (outros.length === 0) return null;
  return `este plugin também expõe ${outros.join(' e ')} — desligar aqui desliga tudo junto`;
}
