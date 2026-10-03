/**
 * O retrato da frota de um que o layout entrega ao `FrotaProvider` no painel
 * do cliente. Sem sessão (o `/entrar`), a frota nasce vazia — nada na tela de
 * login a lê. Servidor só: lê o cookie do pedido.
 */
import type { FleetResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import { agenteDoCliente, frotaDoCliente } from './frota-do-cliente';
import { buscaAgente, leSessao } from './sessao-do-portao';

export async function frotaInicialDoCliente(): Promise<FleetResponse> {
  const agoraS = Math.floor(Date.now() / 1_000);
  const sessao = await leSessao();
  const agente = sessao?.slug ? await buscaAgente(sessao.slug).catch(() => null) : null;
  return frotaDoCliente(agente ? [agenteDoCliente(agente, null, agoraS)] : [], agoraS);
}
