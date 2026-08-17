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

/** Ordem literal do Rica, por slug — o nome é o rótulo, o slug é a chave.
 *
 *  Continua sendo a ordem de fábrica: vale até o primeiro arrasto, e volta a
 *  valer se o banco for zerado. Deixou de ser a última palavra em 17/08, quando
 *  a sidebar virou arrastável — a posição agora é do Rica, não do arquivo. */
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

const FIM_DA_FILA = Number.MAX_SAFE_INTEGER;

export function ordenaTropa(agentes: Agent[]): Agent[] {
  // Ou a lista inteira usa o número do banco, ou nenhuma usa. O `PATCH
  // /api/fleet/ordem` grava a tropa toda de uma vez, então "metade arrastada"
  // não é estado que exista — e misturar as duas réguas empataria a posição 0
  // ditada com a posição 0 arrastada.
  const foiArrastada = agentes.some((agente) => typeof agente.ordem === 'number');

  const posicao = (agente: Agent) => {
    // `typeof`, não `??` nem truthiness: `ordem: 0` é o topo da lista, e um
    // teste de verdade mandaria o primeiro agente pro fim.
    if (foiArrastada) {
      return typeof agente.ordem === 'number' ? agente.ordem : FIM_DA_FILA;
    }
    // Agente fora da lista (frota nova, slug renomeado) cai no fim em ordem de
    // nome, nunca some e nunca cai no meio de quem tem posição ditada.
    const i = ORDEM_DA_TROPA.indexOf(agente.slug);
    return i === -1 ? FIM_DA_FILA : i;
  };

  return [...agentes].sort(
    (a, b) => posicao(a) - posicao(b) || a.name.localeCompare(b.name, 'pt-BR'),
  );
}
