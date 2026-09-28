/**
 * As ações do cockpit que podem abrir a pergunta "trocar mesmo?" na tela do
 * agente — troca de modelo, de esforço e envio de texto (um `/model` digitado
 * no composer abre a mesma pergunta). Mesma assinatura das do core; a única
 * diferença é pedir releitura da frota ao terminar, dê certo ou não, porque a
 * pergunta não gera evento no SSE (ver `pedeReleituraDaFrota`).
 */
import {
  patchAgentEffort as patchAgentEffortDoCore,
  postAgentInput as postAgentInputDoCore,
  postAgentModel as postAgentModelDoCore,
} from '@grupo_borges/cockpit-core/api';

import { pedeReleituraDaFrota } from './frota-releitura.ts';

function comReleitura<A extends unknown[], R>(acao: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    try {
      return await acao(...args);
    } finally {
      pedeReleituraDaFrota();
    }
  };
}

export const postAgentModel = comReleitura(postAgentModelDoCore);
export const patchAgentEffort = comReleitura(patchAgentEffortDoCore);
export const postAgentInput = comReleitura(postAgentInputDoCore);
