/**
 * O vazio da coluna de conversa — a regra que decide se a tela mostra nada,
 * "Sem conversa ainda." ou o feed. Extraída de `feed-da-conversa.tsx` (11/08,
 * task 2dac8a8b) depois que o gate de uma linha falhou no caso que importa:
 * histórico vazio com delegação viva em `connecting`/`replaying` renderizava
 * a delegação sozinha e o histórico entrava depois, empurrando ela — salto.
 *
 * A linha viva não sobrevive sem histórico (o âncora precisa da última
 * mensagem), então a lista final só difere da base pela delegação — o domínio
 * aqui é completo.
 */
import type { CanarioStreamStatus } from './spike/canario-stream-controller.ts';

export type DecisaoDoVazio = 'nada' | 'sem-conversa' | 'feed';

export function decideVazio({
  temHistorico,
  temDelegacao,
  status,
}: {
  temHistorico: boolean;
  temDelegacao: boolean;
  status: CanarioStreamStatus | null;
}): DecisaoDoVazio {
  // Enquanto o histórico não chegou, branco — mesmo com delegação: o branco
  // é honesto (conversa de verdade pode estar a caminho), e a delegação
  // entraria sozinha para o histórico empurrá-la logo depois.
  if (!temHistorico && status !== 'live') return 'nada';
  // Vazio de verdade vira a palavra. Delegação conta como conteúdo: o agente
  // pode não ter conversa ainda e estar trabalhando a pedido de outra frente.
  if (!temHistorico && !temDelegacao) return 'sem-conversa';
  return 'feed';
}
