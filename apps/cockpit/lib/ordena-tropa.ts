/**
 * A ordem da Tropa — estável, de propósito.
 *
 * Antes cada estado era uma seção e a posição de uma linha mudava a cada flip
 * trabalhando↔ocioso: a coluna inteira dançava, e a seção que esvaziava sumia
 * junto com o título, empurrando todo mundo abaixo. Ordem do Rica (11/08): só
 * comportamento — nada de chip, nada de componente novo. A posição carrega
 * IDENTIDADE; o estado fica no ponto do retrato.
 *
 * A única exceção é `aguardando` (ordem 0): é o único estado que chama o
 * humano, decisão da v2 — "se o âmbar é o sinal, ele não pode nascer no meio
 * de uma lista". Raro e significativo, não dança.
 */
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { estadoDe } from '../components/shell/estado.ts';

export function ordenaTropa(agentes: Agent[]): Agent[] {
  const sobeQuemChama = (agente: Agent) => (estadoDe(agente.status).ordem === 0 ? 0 : 1);
  return [...agentes].sort(
    (a, b) => sobeQuemChama(a) - sobeQuemChama(b) || a.name.localeCompare(b.name, 'pt-BR'),
  );
}
