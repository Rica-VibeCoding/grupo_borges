'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchAgentPainel, patchAgentEffort, postAgentAplicarMotor, postAgentModel } from '@grupo_borges/cockpit-core/api';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';
import { DropdownMenu, DropdownMenuContent } from '../ui/dropdown-menu';
import { esperaConvergenciaDoEsforco, type ControleConvergencia } from './convergencia-esforco';
import {
  contratoSeparaPedido, desfechoDaTrocaDeEsforco, desfechoDaTrocaDeModelo,
  etiquetaDoEsforco, rotulaEsforco, rotulaModelo, type Motor,
} from './motor';
import { aplicarMotor, esquecerConfirmacao, fecharSePronto, registrarEscolha, revisarFaltas, type PainelDoMotor as PainelDaDecisao } from './operacao-de-motor.ts';
import { GatilhoDoSeletor } from './seletor-motor-gatilho';
import { ConteudoDoSeletor, type TelaDoSeletor } from './seletor-motor-menu';
import { LeituraDoMotor, RessalvaDoSeletor, usaRecado } from './seletor-motor-ressalva';
import { sincronizarPainel } from './sincronizacao-painel';
import { TEXTO_PERGUNTA_ABERTA } from './executor-de-troca.ts';
import { classificaErroDaTroca, jaEstava, type DesfechoDoPedido, type PedidoDeTroca } from './troca-em-espera.ts';
import { usaOperacaoDeMotor } from './usa-operacao-de-motor.ts';
import { usaTelaEstreita } from './usa-tela-estreita';
import { usaTrocaEmEspera } from './usa-troca-em-espera.ts';

type PainelDoMotor = Pick<AgentPainelResponse, 'model' | 'effort' | 'motor'>;
type SeletorMotorProps = {
  agentSlug: string;
  agentName: string;
  motor: Motor;
  esforcoCobrePedido: boolean;
};


function rotuloDoPedido(pedido: PedidoDeTroca, labels?: Record<string, string>): string {
  return pedido.tipo === 'modelo' ? rotulaModelo(pedido.valor, labels) : rotulaEsforco(pedido.valor) ?? pedido.valor;
}

export function SeletorMotor(props: SeletorMotorProps) {
  return <SeletorDoAgente key={props.agentSlug} agentSlug={props.agentSlug} agentName={props.agentName} />;
}

function SeletorDoAgente({ agentSlug, agentName }: Pick<SeletorMotorProps, 'agentSlug' | 'agentName'>) {
  const [painel, setPainel] = useState<PainelDoMotor | null | undefined>(undefined);
  const [aberto, setAberto] = useState(false);
  const [tela, setTela] = useState<TelaDoSeletor>('inicio');
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recado, setRecado] = usaRecado();
  const telaEstreita = usaTelaEstreita();
  const operacao = usaOperacaoDeMotor(agentSlug);
  // Enquanto o agente religa, a gaveta não aceita outra escolha: a segunda
  // desligaria um agente no meio do próprio boot.
  const aplicando = operacao.fase === 'aplicando';
  const convergencia = useRef<ControleConvergencia | null>(null);
  const leitura = useRef<AbortController | null>(null);
  const geracao = useRef(0);

  function invalidar() {
    geracao.current += 1;
    leitura.current?.abort();
    convergencia.current?.parar();
    convergencia.current = null;
    return geracao.current;
  }

  useEffect(() => {
    const parar = sincronizarPainel(agentSlug, (slug, signal) => {
      const controlador = new AbortController();
      leitura.current = controlador;
      signal.addEventListener('abort', () => controlador.abort(), { once: true });
      return fetchAgentPainel(slug, controlador.signal).then((novo) => {
        if (controlador.signal.aborted) throw new Error('leitura superada');
        return novo;
      });
    }, (novo) => {
      invalidar();
      setPainel(novo);
      setSalvando(false);
      alterarAbertura(false);
      // Painel novo conta o que ainda falta — e só isso: releitura não religa.
      revisarFaltas(agentSlug, novo);
    }, () => setPainel(null));
    return () => { parar(); invalidar(); };
  }, [agentSlug]);

  const modelo = painel?.model ?? null;
  const esforco = painel?.effort ?? null;
  const rotuloModelo = modelo ? (modelo.value ? rotulaModelo(modelo.value, modelo.labels) : 'Escolher modelo') : null;
  const rotuloDoEsforco = rotulaEsforco(esforco?.value) ?? (esforco?.allowed.length ? 'Escolher esforço' : null);
  const cobrePedido = contratoSeparaPedido({ model_family: painel?.motor?.familia });
  const etiquetaEsforco = etiquetaDoEsforco(esforco, cobrePedido);
  const temControle = Boolean(modelo?.allowed.length || esforco?.allowed.length);
  const divergindo = Boolean(modelo?.session_may_diverge || esforco?.session_may_diverge);
  const tintaModelo = divergindo ? 'var(--ck-text-secondary)' : 'var(--ck-text-primary)';
  const tintaEsforco = divergindo ? 'var(--ck-text-tertiary)' : 'var(--ck-text-secondary)';
  // Troca a quente (Claude Code): a gaveta fecha no toque e o chip conta a
  // troca — "esperando o agente terminar", "trocando…" — sem prender o
  // composer atrás de um menu modal pelos ~6 s da troca que abre o modal.
  const trocaAQuente = !cobrePedido;
  const troca = usaTrocaEmEspera(agentSlug, setRecado);
  const pedidoEmCurso = troca.pedido;
  const ressalva = (
    <RessalvaDoSeletor
      operacao={operacao} aoConfirmarOperacao={() => void aplicar()}
      recado={troca.andamento ? null : recado} divergindo={divergindo && !troca.andamento}
    />
  );

  function alterarAbertura(proximo: boolean) {
    // Tocar de novo o chip que espera CANCELA a espera (27/09). Em voo, o
    // comando já saiu: o toque não abre a gaveta no meio da troca.
    if (proximo && troca.andamento) {
      if (!troca.emVoo) troca.cancelar();
      return;
    }
    setAberto(proximo);
    if (!proximo) {
      setTela('inicio');
      setAviso(null);
      // Pergunta fora da tela é pergunta caducada — reabrir e achar o "tocar de
      // novo confirma" armado faria um toque distraído matar o turno em voo.
      esquecerConfirmacao(agentSlug);
      // Fechar a gaveta NÃO aplica nada: quem religa é o pacote fechando
      // (`conferirPacote`). Era o gatilho até 10/09, e ele viu o religar
      // disparar ao sair do menu do motor para escolher o modelo.
    }
  }

  function redeDaOperacao() {
    return {
      aplicar: (force: boolean) => postAgentAplicarMotor(agentSlug, { force }),
      lePainel: () => fetchAgentPainel(agentSlug),
      reler: () => {
        const controlador = new AbortController();
        leitura.current = controlador;
        void fetchAgentPainel(agentSlug, controlador.signal)
          .then((novo) => { if (novo.slug === agentSlug) setPainel(novo); })
          .catch(() => undefined);
      },
    };
  }

  /** A ESCOLHA APLICA SOZINHA (Rica, 09/09) — só quando ela não vale na sessão
   *  viva. Nas famílias que trocam a quente não há nada a religar, e desligar o
   *  agente ali seria custo puro. */
  async function aplicar() {
    await aplicarMotor(agentSlug, redeDaOperacao(), agentName);
  }

  /** Motor, modelo e esforço são escolhas para o MESMO boot. A escolha fica
   *  guardada e religa quando o pacote fechar — um boot para todas. O painel vai
   *  junto porque aqui o valor novo já está em mão: se era o último campo em
   *  branco, religa neste toque. */
  function registrar(confere: (painel: PainelDaDecisao) => boolean) {
    void registrarEscolha(agentSlug, { rede: redeDaOperacao(), nome: agentName, confere });
  }

  function mostrarAviso(mensagem: string) {
    setAviso(mensagem);
    setTela('aviso');
  }

  /** A troca a quente (Claude Code) vai para a espera por slug, que envia sem
   *  depender deste chip montado (`executor-de-troca.ts`). A troca diferida da
   *  Tara segue aqui, com a gaveta aberta: é dentro dela que ele escolhe o resto. */
  function escolher(pedido: PedidoDeTroca) {
    setRecado(null);
    if (!trocaAQuente) {
      void (pedido.tipo === 'modelo' ? trocarModelo(pedido.valor) : trocarEsforco(pedido.valor));
      return;
    }
    alterarAbertura(false);
    troca.pedir(pedido);
  }

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

  async function trocarEsforco(valor: string): Promise<DesfechoDoPedido> {
    const minha = invalidar();
    setSalvando(true);
    setAviso(null);
    try {
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
    } catch (erro) {
      return desfechoDoErro(erro, 'Não foi possível trocar o esforço.', minha !== geracao.current);
    } finally {
      if (minha === geracao.current) setSalvando(false);
    }
  }

  async function trocarModelo(valor: string): Promise<DesfechoDoPedido> {
    const minha = invalidar();
    setSalvando(true);
    setAviso(null);
    try {
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
    } catch (erro) {
      return desfechoDoErro(erro, 'Não foi possível trocar o modelo.', minha !== geracao.current);
    } finally {
      if (minha === geracao.current) setSalvando(false);
    }
  }

  const opcoesModelo = modelo?.allowed.map((valor) => ({
    chave: valor, rotulo: rotulaModelo(valor, modelo.labels), selecionado: modelo.value === valor,
    aoSelecionar: () => escolher({ tipo: 'modelo', valor }),
  })) ?? [];
  const opcoesEsforco = esforco?.allowed.map((valor) => ({
    chave: valor, rotulo: rotulaEsforco(valor) ?? valor, selecionado: esforco.value === valor,
    aoSelecionar: () => escolher({ tipo: 'esforco', valor }),
  })) ?? [];

  if (!temControle) {
    if (!rotuloModelo && !rotuloDoEsforco) return null;
    return (
      <LeituraDoMotor
        rotuloModelo={rotuloModelo} rotuloDoEsforco={rotuloDoEsforco} etiquetaEsforco={etiquetaEsforco}
        tintaModelo={tintaModelo} tintaEsforco={tintaEsforco} ressalva={ressalva}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <DropdownMenu open={aberto && temControle} onOpenChange={alterarAbertura}>
        <GatilhoDoSeletor
          agentName={agentName} aberto={aberto} rotuloModelo={rotuloModelo}
          rotuloDoEsforco={rotuloDoEsforco} etiquetaEsforco={etiquetaEsforco}
          tintaModelo={tintaModelo} tintaEsforco={tintaEsforco}
          andamento={troca.andamento} andamentoLongo={troca.andamentoLongo} cancelaNoToque={Boolean(troca.espera) && !troca.emVoo}
          rotuloPedido={pedidoEmCurso ? rotuloDoPedido(pedidoEmCurso, modelo?.labels) : null}
        />
        <DropdownMenuContent
          className={`ck-menu-surge ${aberto ? 'ck-menu-aberto' : 'ck-menu-fechado'}`}
          side="top" align="start" sideOffset={4} collisionPadding={8}
          style={{ width: 'var(--ck-w-menu)' }}
        >
          <ConteudoDoSeletor
            tela={tela} opcoesModelo={opcoesModelo} opcoesEsforco={opcoesEsforco}
            rotuloModelo={rotuloModelo} rotuloDoEsforco={rotuloDoEsforco}
            salvando={salvando || aplicando} telaEstreita={telaEstreita}
            aviso={aviso} aoMudarTela={setTela}
            aoFechar={() => alterarAbertura(false)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {ressalva}
    </div>
  );
}
