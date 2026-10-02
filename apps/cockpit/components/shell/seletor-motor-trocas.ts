/**
 * A TROCA DIFERIDA do seletor — o caminho das famílias em que modelo e esforço
 * só valem no próximo boot (a Tara): grava, confere o que a sessão confirmou e,
 * quando a escolha não alcança a sessão viva, registra na operação única
 * (`operacao-de-motor.ts`). A troca a quente (Claude Code) não passa por aqui:
 * vai para a espera por slug (`executor-de-troca.ts`).
 *
 * Saiu de `seletor-motor.tsx` (02/10) sem mudar uma linha de lógica: as funções
 * fecham sobre o mesmo estado do componente, que chega pelo contexto a cada
 * render — o mesmo frescor que tinham quando moravam lá dentro.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { fetchAgentPainel } from '@grupo_borges/cockpit-core/api';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';
import { patchAgentEffort, postAgentModel } from '../../lib/acoes-no-agente.ts';
import { esperaConvergenciaDoEsforco, type ControleConvergencia } from './convergencia-esforco';
import { desfechoDaTrocaDeEsforco, desfechoDaTrocaDeModelo } from './motor';
import { fecharSePronto, type PainelDoMotor as PainelDaDecisao } from './operacao-de-motor.ts';
import type { TelaDoSeletor } from './seletor-motor-menu';
import { esquecerPainel } from './sincronizacao-painel';
import { TEXTO_PERGUNTA_ABERTA } from './executor-de-troca.ts';
import { classificaErroDaTroca, jaEstava, type DesfechoDoPedido } from './troca-em-espera.ts';

export type PainelDoMotor = Pick<AgentPainelResponse, 'model' | 'effort' | 'motor'>;

export type ContextoDasTrocas = {
  agentSlug: string;
  painel: PainelDoMotor | null | undefined;
  cobrePedido: boolean;
  geracao: MutableRefObject<number>;
  leitura: MutableRefObject<AbortController | null>;
  convergencia: MutableRefObject<ControleConvergencia | null>;
  invalidar: () => number;
  setPainel: Dispatch<SetStateAction<PainelDoMotor | null | undefined>>;
  setSalvando: (salvando: boolean) => void;
  setAviso: (aviso: string | null) => void;
  setTela: (tela: TelaDoSeletor) => void;
  mostrarAviso: (mensagem: string) => void;
  registrar: (confere: (painel: PainelDaDecisao) => boolean) => void;
  alterarAbertura: (proximo: boolean) => void;
};

export function trocasDiferidas({
  agentSlug, painel, cobrePedido, geracao, leitura, convergencia, invalidar,
  setPainel, setSalvando, setAviso, setTela, mostrarAviso, registrar, alterarAbertura,
}: ContextoDasTrocas) {
  /** O 409 da troca: ocupado é esperar (o chip reenvia sozinho, sem pedir
   *  confirmação); pergunta de outra troca aberta aponta a barra do chat. */
  function desfechoDoErro(erro: unknown, falha: string, superado: boolean): DesfechoDoPedido {
    const tipo = classificaErroDaTroca(erro);
    // Ocupado segue esperando mesmo se uma releitura do painel superou este
    // envio: a espera é da troca, não da leitura.
    if (tipo === 'esperar') return 'esperar';
    if (superado) return 'falhou';
    mostrarAviso(tipo === 'pergunta-aberta' ? TEXTO_PERGUNTA_ABERTA : falha);
    return 'falhou';
  }

  /** O que as duas trocas fazem igual: esta escolha supera a anterior, o painel
   *  guardado deixa de valer, e o "salvando" só apaga se ninguém a superou. */
  async function pedirTroca(
    falha: string,
    pedir: (minha: number) => Promise<DesfechoDoPedido>,
  ): Promise<DesfechoDoPedido> {
    const minha = invalidar();
    esquecerPainel(agentSlug);
    setSalvando(true);
    setAviso(null);
    try {
      return await pedir(minha);
    } catch (erro) {
      return desfechoDoErro(erro, falha, minha !== geracao.current);
    } finally {
      if (minha === geracao.current) setSalvando(false);
    }
  }

  const trocarEsforco = (valor: string) => pedirTroca('Não foi possível trocar o esforço.', async (minha) => {
    const resposta = await patchAgentEffort(agentSlug, valor);
    if (minha !== geracao.current) return 'feito';
    // Já era o nível da sessão: sucesso silencioso. Pergunta que ficou
    // aberta: quem responde é a barra acima do campo, não um aviso aqui.
    if (jaEstava(resposta) || resposta.pergunta_aberta) return 'feito';
    const desfecho = desfechoDaTrocaDeEsforco(resposta);
    if (desfecho === 'entrega-falhou') {
      mostrarAviso('Não foi possível entregar a troca ao agente.');
      return 'falhou';
    }
    if (desfecho === 'pendente') {
      mostrarAviso('A troca foi entregue, mas a sessão ainda não confirmou o nível novo. O card segue no nível atual até ela confirmar.');
      const controlador = new AbortController();
      leitura.current = controlador;
      convergencia.current = esperaConvergenciaDoEsforco(
        valor, () => fetchAgentPainel(agentSlug, controlador.signal),
        (novo) => {
          if (minha === geracao.current && novo.slug === agentSlug) setPainel(novo);
        },
      );
      return 'feito';
    }
    const comEsforco = painel ? {
      ...painel,
      effort: {
        ...painel.effort, value: resposta.effort, source: resposta.source,
        requested: cobrePedido ? valor : painel.effort.requested,
        session_may_diverge: resposta.session_may_diverge,
      },
    } : null;
    if (comEsforco) setPainel(comEsforco);
    // O Codex recebe o esforço por env var de boot: o back grava e
    // responde `session_may_diverge`. É o sinal de que a escolha não alcança
    // a sessão viva — e é ele, não a família, que decide religar (a régua de
    // quem aceita troca a quente mora no back).
    //
    // A gaveta fica ABERTA aqui: é dentro dela que ele escolhe o resto. O que
    // volta é a tela inicial, com o valor novo já no lugar.
    if (resposta.session_may_diverge) {
      setTela('inicio');
      registrar((p) => p.effort?.value === resposta.effort);
    } else {
      // Trocou a quente: não há o que religar por ESTA escolha. Mas ela pode ser
      // o campo que faltava para uma troca de MOTOR já guardada — e era aqui que
      // o pacote ficava pendurado para sempre, com o motor novo nunca entrando.
      void fecharSePronto(agentSlug, (p) => p.effort?.value === resposta.effort);
      alterarAbertura(false);
    }
    return 'feito';
  });

  const trocarModelo = (valor: string) => pedirTroca('Não foi possível trocar o modelo.', async (minha) => {
    const resposta = await postAgentModel(agentSlug, valor);
    if (minha !== geracao.current) return 'feito';
    // Ver o gêmeo em `trocarEsforco`: `ja_estava` vem com `tmux_delivered:
    // false`, e o desfecho antigo o leria como entrega que falhou.
    if (jaEstava(resposta) || resposta.pergunta_aberta) return 'feito';
    const desfecho = desfechoDaTrocaDeModelo(resposta);
    if (desfecho === 'entrega-falhou') {
      mostrarAviso('Não foi possível entregar a troca ao agente.');
      return 'falhou';
    }
    const comModelo = painel?.model ? {
      ...painel,
      model: { ...painel.model, value: resposta.model, source: 'agent.state_model',
        session_may_diverge: !resposta.confirmed },
    } : null;
    if (comModelo) setPainel(comModelo);
    if (resposta.confirmed || desfecho === 'proximo-turno') {
      // `proximo-turno` é o modelo que virou env var de boot (`runtime_switch`
      // false): gravado, sem tocar a sessão. É exatamente o caso que a
      // operação única resolve — e a gaveta segue aberta para o esforço.
      if (desfecho === 'proximo-turno') {
        setTela('inicio');
        registrar((p) => p.model?.value === resposta.model);
      } else {
        // Ver o comentário gêmeo em `trocarEsforco`: escolha que vale a quente
        // ainda pode fechar o pacote de uma troca de motor guardada.
        void fecharSePronto(agentSlug, (p) => p.model?.value === resposta.model);
        alterarAbertura(false);
      }
      return 'feito';
    }
    mostrarAviso('A troca foi entregue, mas a sessão ainda não a confirmou.');
    return 'feito';
  });

  return { trocarEsforco, trocarModelo };
}
