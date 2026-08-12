/**
 * A ordem da Tropa — FIXA, ditada pelo Rica (11/08).
 *
 * A versão anterior era alfabética por nome, e antes dela cada estado era uma
 * seção: a posição de uma linha mudava a cada flip trabalhando↔ocioso e a coluna
 * inteira dançava. O alfabeto matou a dança, mas embaralhava a leitura — quem
 * está de pé ficava separado por quem dorme.
 *
 * Agora a posição é ditada, não calculada: a lista abaixo É a ordem, sempre a
 * mesma, com ou sem sessão viva. O estado continua no ponto do retrato, que é
 * onde ele nunca mexeu na posição de ninguém.
 *
 * `aguardando` NÃO sobe mais. Era a única exceção da versão alfabética ("se o
 * âmbar é o sinal, ele não pode nascer no meio de uma lista"), e ordem fixa não
 * comporta exceção — quem sobe, dança. O âmbar segue no retrato.
 */
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

/** Ordem literal do Rica, por slug — o nome é o rótulo, o slug é a chave. */
const ORDEM_DA_TROPA = [
  'pavan',
  'daniel',
  'tara',
  'vinicius',
  'felipe',
  'barsi',
  'hiro',
  'canarinho',
];

export function ordenaTropa(agentes: Agent[]): Agent[] {
  // Agente fora da lista (frota nova, slug renomeado) cai no fim em ordem de
  // nome, nunca some e nunca cai no meio de quem tem posição ditada.
  const posicao = (agente: Agent) => {
    const i = ORDEM_DA_TROPA.indexOf(agente.slug);
    return i === -1 ? ORDEM_DA_TROPA.length : i;
  };
  return [...agentes].sort(
    (a, b) => posicao(a) - posicao(b) || a.name.localeCompare(b.name, 'pt-BR'),
  );
}
