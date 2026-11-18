/**
 * O QUE MUDA POR AGENTE no painel do cliente — e só nele.
 *
 * O `modo.ts` corta peças por PRODUTO (frota × cliente). Aqui o corte é por
 * QUEM USA: o mesmo build do cliente serve o Ted (Daniel, 9 anos), o Fred e a
 * Sofia. O botão de voz grande vale para os três clientes (Rica, 18/11); a
 * lousa e a voz que toca sozinha são só do Ted.
 *
 * A frota nunca liga nada daqui: a tela do Rica segue com a voz só no toque —
 * ordem dele de 11/08, registrada em `components/feed/bolha-voz.tsx`.
 */
import { MODO, type ModoDoCockpit } from './modo.ts';

export type PerfilDoAgente = {
  /** O botão de voz do composer em tamanho de dedo de criança, com movimento. */
  botaoDeVozGrande: boolean;
  /** Bloco de código com moldura de caixa vira quadro verde com letra de giz. */
  lousa: boolean;
  /** Um trecho curto da resposta (fora da lousa) toca sozinho ao chegar — com
   *  a chave "fala / fica quieto" na mão de quem usa. */
  falaSozinha: boolean;
};

/** Agentes de criança: hoje só o Ted. Slug do cadastro do portão. */
const AGENTES_DE_CRIANCA: ReadonlySet<string> = new Set(['ted']);

export function perfilDo(modo: ModoDoCockpit, slug: string | undefined): PerfilDoAgente {
  const cliente = modo === 'cliente';
  const crianca = cliente && slug !== undefined && AGENTES_DE_CRIANCA.has(slug);
  return { botaoDeVozGrande: cliente, lousa: crianca, falaSozinha: crianca };
}

export function perfilDoAgente(slug: string | undefined): PerfilDoAgente {
  return perfilDo(MODO, slug);
}
