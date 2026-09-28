/**
 * Quem ENVIA a troca a quente de modelo/esforço (Claude Code) — sem depender
 * de chip montado (28/09, code-review). O reenvio da espera roda com o Rica em
 * outro agente; se o desfecho fosse para o estado de um `SeletorMotor`
 * desmontado, o sucesso voltava o chip ao modelo antigo e a falha sumia calada.
 * Aqui o desfecho vai para quem sobrevive à rota: o painel novo é PUBLICADO
 * (`publicarPainel`, o chip montado o recebe; o que montar depois o lê), e o
 * recado de falha fica guardado na store da espera, por slug.
 *
 * A rede entra por argumento — a instância do cliente está em
 * `esperas-de-troca-cliente.ts`.
 */
import type {
  AgentEffortChangeResponse,
  AgentModelChangeResponse,
} from '@grupo_borges/cockpit-core/api';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import { esperaConvergenciaDoEsforco, type ControleConvergencia, type DependenciasConvergencia } from './convergencia-esforco.ts';
import { desfechoDaTrocaDeEsforco, desfechoDaTrocaDeModelo } from './motor.ts';
import { classificaErroDaTroca, jaEstava, type DesfechoDoPedido, type PedidoDeTroca } from './troca-em-espera.ts';

export const TEXTO_ENTREGA_FALHOU = 'Não foi possível entregar a troca ao agente.';
export const TEXTO_PERGUNTA_ABERTA = 'Há uma troca esperando resposta logo acima do campo.';
export const TEXTO_MODELO_FALHOU = 'Não foi possível trocar o modelo.';
export const TEXTO_ESFORCO_FALHOU = 'Não foi possível trocar o esforço.';
export const TEXTO_MODELO_SEM_CONFIRMACAO = 'A troca foi entregue, mas a sessão ainda não a confirmou.';
export const TEXTO_ESFORCO_PENDENTE =
  'A troca foi entregue, mas a sessão ainda não confirmou o nível novo. O card segue no nível atual até ela confirmar.';

type Painel = AgentPainelResponse;

export type RedeDaTroca = {
  postModel: (slug: string, valor: string) => Promise<AgentModelChangeResponse>;
  patchEffort: (slug: string, valor: string) => Promise<AgentEffortChangeResponse>;
  lePainel: (slug: string) => Promise<Painel>;
  publicar: (painel: Painel) => void;
  /** A escolha a quente pode fechar o pacote de uma troca de motor guardada
   *  (`fecharSePronto` de `operacao-de-motor.ts`). */
  fecharSePronto?: (slug: string, tambem: (painel: Pick<Painel, 'model' | 'effort' | 'motor'>) => boolean) => unknown;
  convergencia?: DependenciasConvergencia;
};

export type ExecutorDeTroca = ((
  slug: string,
  pedido: PedidoDeTroca,
  recado: (texto: string) => void,
) => Promise<DesfechoDoPedido>) & { pararConvergencia: (slug: string) => void };

export function criaExecutorDeTroca(rede: RedeDaTroca): ExecutorDeTroca {
  const convergencias = new Map<string, ControleConvergencia>();

  function pararConvergencia(slug: string) {
    convergencias.get(slug)?.parar();
    convergencias.delete(slug);
  }

  function republicar(slug: string) {
    void rede.lePainel(slug).then(rede.publicar).catch(() => undefined);
  }

  async function executar(
    slug: string,
    pedido: PedidoDeTroca,
    recado: (texto: string) => void,
  ): Promise<DesfechoDoPedido> {
    // Troca nova do mesmo agente: a convergência da anterior perdeu o sentido.
    pararConvergencia(slug);
    const falha = pedido.tipo === 'modelo' ? TEXTO_MODELO_FALHOU : TEXTO_ESFORCO_FALHOU;
    try {
      if (pedido.tipo === 'modelo') {
        const resposta = await rede.postModel(slug, pedido.valor);
        // `ja_estava` vem com `tmux_delivered: false`: sucesso, não entrega falha.
        // Pergunta aberta: quem responde é a barra acima do campo.
        if (jaEstava(resposta) || resposta.pergunta_aberta) {
          republicar(slug);
          return 'feito';
        }
        if (desfechoDaTrocaDeModelo(resposta) === 'entrega-falhou') {
          recado(TEXTO_ENTREGA_FALHOU);
          return 'falhou';
        }
        if (resposta.confirmed) void rede.fecharSePronto?.(slug, (p) => p.model?.value === resposta.model);
        else recado(TEXTO_MODELO_SEM_CONFIRMACAO);
        republicar(slug);
        return 'feito';
      }
      const resposta = await rede.patchEffort(slug, pedido.valor);
      if (jaEstava(resposta) || resposta.pergunta_aberta) {
        republicar(slug);
        return 'feito';
      }
      const desfecho = desfechoDaTrocaDeEsforco(resposta);
      if (desfecho === 'entrega-falhou') {
        recado(TEXTO_ENTREGA_FALHOU);
        return 'falhou';
      }
      if (desfecho === 'pendente') {
        recado(TEXTO_ESFORCO_PENDENTE);
        convergencias.set(slug, esperaConvergenciaDoEsforco(
          pedido.valor, () => rede.lePainel(slug),
          (painel) => { convergencias.delete(slug); rede.publicar(painel); },
          rede.convergencia,
        ));
        return 'feito';
      }
      void rede.fecharSePronto?.(slug, (p) => p.effort?.value === resposta.effort);
      republicar(slug);
      return 'feito';
    } catch (erro) {
      const tipo = classificaErroDaTroca(erro);
      if (tipo === 'esperar') return 'esperar';
      recado(tipo === 'pergunta-aberta' ? TEXTO_PERGUNTA_ABERTA : falha);
      return 'falhou';
    }
  }

  return Object.assign(executar, { pararConvergencia });
}
