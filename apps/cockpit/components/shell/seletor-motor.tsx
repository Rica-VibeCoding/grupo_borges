'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchAgentPainel, postAgentAplicarMotor } from '@grupo_borges/cockpit-core/api';
import { DropdownMenu, DropdownMenuContent } from '../ui/dropdown-menu';
import type { ControleConvergencia } from './convergencia-esforco';
import {
  contratoSeparaPedido, etiquetaDoEsforco, rotulaEsforco, rotulaModelo, type Motor,
} from './motor';
import { aplicarMotor, esquecerConfirmacao, registrarEscolha, revisarFaltas, type PainelDoMotor as PainelDaDecisao } from './operacao-de-motor.ts';
import { GatilhoDoSeletor } from './seletor-motor-gatilho';
import { ConteudoDoSeletor, type TelaDoSeletor } from './seletor-motor-menu';
import { LeituraDoMotor, RessalvaDoSeletor, usaRecado } from './seletor-motor-ressalva';
import { trocasDiferidas, type PainelDoMotor } from './seletor-motor-trocas';
import { esquecerPainel, painelGuardado, sincronizarPainel, tomarPreaquecimento } from './sincronizacao-painel';
import type { PedidoDeTroca } from './troca-em-espera.ts';
import { usaOperacaoDeMotor } from './usa-operacao-de-motor.ts';
import { usaTelaEstreita } from './usa-tela-estreita';
import { usaTrocaEmEspera } from './usa-troca-em-espera.ts';

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
  // Nasce com o último painel lido deste agente, e a leitura fresca substitui:
  // sem isso o chip ficava sem dropdown até o `/painel` responder (28/09).
  const [painel, setPainel] = useState<PainelDoMotor | null | undefined>(() => painelGuardado(agentSlug));
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
      // A leitura que o toque na tropa já soltou vale por esta (`preaquecePainel`).
      return (tomarPreaquecimento(slug) ?? fetchAgentPainel(slug, controlador.signal)).then((novo) => {
        if (controlador.signal.aborted) throw new Error('leitura superada');
        return novo;
      });
    }, (novo, { fundo }) => {
      if (fundo) {
        // Painel de segundo plano (reenvio, convergência, barra do chat): só o
        // dado. A gaveta que ele abriu agora e o "salvando" dele ficam.
        setPainel(novo);
        revisarFaltas(agentSlug, novo);
        return;
      }
      invalidar();
      setPainel(novo);
      setSalvando(false);
      alterarAbertura(false);
      // Painel novo conta o que ainda falta — e só isso: releitura não religa.
      revisarFaltas(agentSlug, novo);
    },
    // Leitura que falhou (ou foi superada por uma escolha feita no chip já
    // semeado) não apaga o painel que está na tela.
    () => setPainel((atual) => atual ?? null));
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
      // Religar pode mudar o motor: o painel guardado deixa de valer.
      aplicar: (force: boolean) => { esquecerPainel(agentSlug); return postAgentAplicarMotor(agentSlug, { force }); },
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

  // A troca diferida (gravar, conferir, registrar na operação única) mora em
  // `seletor-motor-trocas.ts`; recriada a cada render, como antes, para fechar
  // sobre o painel e o estado deste render.
  const { trocarEsforco, trocarModelo } = trocasDiferidas({
    agentSlug, painel, cobrePedido, geracao, leitura, convergencia, invalidar,
    setPainel, setSalvando, setAviso, setTela, mostrarAviso, registrar, alterarAbertura,
  });

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
        tintaModelo={tintaModelo} ressalva={ressalva}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <DropdownMenu open={aberto && temControle} onOpenChange={alterarAbertura}>
        <GatilhoDoSeletor
          agentName={agentName} aberto={aberto} rotuloModelo={rotuloModelo}
          rotuloDoEsforco={rotuloDoEsforco} etiquetaEsforco={etiquetaEsforco}
          tintaModelo={tintaModelo}
          andamento={troca.andamento} andamentoLongo={troca.andamentoLongo} cancelaNoToque={Boolean(troca.espera) && !troca.emVoo}
          rotuloPedido={pedidoEmCurso ? rotuloDoPedido(pedidoEmCurso, modelo?.labels) : null}
        />
        <DropdownMenuContent
          className={`ck-menu-surge ${aberto ? 'ck-menu-aberto' : 'ck-menu-fechado'}`}
          side="top" align="start" sideOffset={4} collisionPadding={8}
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
