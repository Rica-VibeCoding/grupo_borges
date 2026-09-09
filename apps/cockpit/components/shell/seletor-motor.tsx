'use client';

import { useEffect, useRef, useState } from 'react';
import { AgentInputError, fetchAgentPainel, patchAgentEffort, postAgentModel } from '@grupo_borges/cockpit-core/api';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';
import { DropdownMenu, DropdownMenuContent } from '../ui/dropdown-menu';
import { esperaConvergenciaDoEsforco, type ControleConvergencia } from './convergencia-esforco';
import { EtiquetaDoEsforco } from './etiqueta-esforco';
import {
  contratoSeparaPedido, desfechoDaTrocaDeEsforco, desfechoDaTrocaDeModelo,
  etiquetaDoEsforco, rotulaEsforco, rotulaModelo, type Motor,
} from './motor';
import { GatilhoDoSeletor } from './seletor-motor-gatilho';
import { ConteudoDoSeletor, type TelaDoSeletor } from './seletor-motor-menu';
import { sincronizarPainel } from './sincronizacao-painel';
import { TEXTO_VALE_NO_BOOT } from './troca-de-motor';

type PainelDoMotor = Pick<AgentPainelResponse, 'model' | 'effort' | 'motor'>;
type SeletorMotorProps = {
  agentSlug: string;
  agentName: string;
  motor: Motor;
  esforcoCobrePedido: boolean;
};

function pedeConfirmacao(erro: unknown): boolean {
  return erro instanceof AgentInputError && erro.status === 409 && erro.detail === 'agent_busy_confirm_required';
}

function usaTelaEstreita() {
  const [estreita, setEstreita] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const atualizar = () => setEstreita(media.matches);
    atualizar();
    media.addEventListener('change', atualizar);
    return () => media.removeEventListener('change', atualizar);
  }, []);
  return estreita;
}

export function SeletorMotor(props: SeletorMotorProps) {
  return <SeletorDoAgente key={props.agentSlug} agentSlug={props.agentSlug} agentName={props.agentName} />;
}

function SeletorDoAgente({ agentSlug, agentName }: Pick<SeletorMotorProps, 'agentSlug' | 'agentName'>) {
  const [painel, setPainel] = useState<PainelDoMotor | null | undefined>(undefined);
  const [aberto, setAberto] = useState(false);
  const [tela, setTela] = useState<TelaDoSeletor>('inicio');
  const [modeloPendente, setModeloPendente] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const telaEstreita = usaTelaEstreita();
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
  const ressalva = divergindo ? (
    <span role="status" style={{ color: 'var(--ck-state-attention)', fontSize: 'var(--ck-text-xs)' }}>
      {TEXTO_VALE_NO_BOOT}
    </span>
  ) : null;

  function alterarAbertura(proximo: boolean) {
    setAberto(proximo);
    if (!proximo) {
      setTela('inicio');
      setModeloPendente(null);
      setAviso(null);
    }
  }

  function mostrarAviso(mensagem: string) {
    setAviso(mensagem);
    setTela('aviso');
  }

  async function trocarEsforco(valor: string) {
    const minha = invalidar();
    setSalvando(true);
    setAviso(null);
    try {
      const resposta = await patchAgentEffort(agentSlug, valor);
      if (minha !== geracao.current) return;
      const desfecho = desfechoDaTrocaDeEsforco(resposta);
      if (desfecho === 'entrega-falhou') {
        mostrarAviso('Não foi possível entregar a troca ao agente.');
        return;
      }
      if (desfecho === 'pendente') {
        mostrarAviso('A troca foi entregue, mas o agente está no meio de um turno e ainda não a confirmou. O card segue no nível atual até a sessão confirmar.');
        const controlador = new AbortController();
        leitura.current = controlador;
        convergencia.current = esperaConvergenciaDoEsforco(
          valor, () => fetchAgentPainel(agentSlug, controlador.signal),
          (novo) => {
            if (minha === geracao.current && novo.slug === agentSlug) setPainel(novo);
          },
        );
        return;
      }
      setPainel((atual) => atual ? {
        ...atual,
        effort: {
          ...atual.effort, value: resposta.effort, source: resposta.source,
          requested: cobrePedido ? valor : atual.effort.requested,
          session_may_diverge: resposta.session_may_diverge,
        },
      } : atual);
      alterarAbertura(false);
    } catch {
      if (minha === geracao.current) mostrarAviso('Não foi possível trocar o esforço.');
    } finally {
      if (minha === geracao.current) setSalvando(false);
    }
  }

  async function trocarModelo(valor: string, forcar = false) {
    const minha = invalidar();
    setSalvando(true);
    setAviso(null);
    try {
      const resposta = await postAgentModel(agentSlug, valor, { force: forcar });
      if (minha !== geracao.current) return;
      const desfecho = desfechoDaTrocaDeModelo(resposta);
      if (desfecho === 'entrega-falhou') {
        mostrarAviso('Não foi possível entregar a troca ao agente.');
        return;
      }
      setModeloPendente(null);
      setPainel((atual) => atual?.model ? {
        ...atual,
        model: { ...atual.model, value: resposta.model, source: 'agent.state_model',
          session_may_diverge: !resposta.confirmed },
      } : atual);
      if (resposta.confirmed || desfecho === 'proximo-turno') {
        alterarAbertura(false);
        return;
      }
      mostrarAviso('A troca foi entregue, mas a sessão ainda não a confirmou.');
    } catch (erro) {
      if (minha !== geracao.current) return;
      if (!forcar && pedeConfirmacao(erro)) {
        setModeloPendente(valor);
        setTela('confirmacao');
        return;
      }
      mostrarAviso('Não foi possível trocar o modelo.');
    } finally {
      if (minha === geracao.current) setSalvando(false);
    }
  }

  const opcoesModelo = modelo?.allowed.map((valor) => ({
    chave: valor, rotulo: rotulaModelo(valor, modelo.labels), selecionado: modelo.value === valor,
    aoSelecionar: () => void trocarModelo(valor),
  })) ?? [];
  const opcoesEsforco = esforco?.allowed.map((valor) => ({
    chave: valor, rotulo: rotulaEsforco(valor) ?? valor, selecionado: esforco.value === valor,
    aoSelecionar: () => void trocarEsforco(valor),
  })) ?? [];

  if (!temControle) {
    if (!rotuloModelo && !rotuloDoEsforco) return null;
    return (
      <div className="flex min-w-0 flex-col" style={{ fontSize: 'var(--ck-text-sm)' }}>
        <div className="flex items-center" style={{ gap: '3px' }}>
          {rotuloModelo ? <span className="truncate" style={{ color: tintaModelo }}>{rotuloModelo}</span> : null}
          {rotuloDoEsforco ? <span style={{ color: tintaEsforco }}>{rotuloDoEsforco}</span> : null}
          {etiquetaEsforco ? <EtiquetaDoEsforco etiqueta={etiquetaEsforco} /> : null}
        </div>
        {ressalva}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <DropdownMenu open={aberto && temControle} onOpenChange={alterarAbertura}>
        <GatilhoDoSeletor
          agentName={agentName} aberto={aberto} rotuloModelo={rotuloModelo}
          rotuloDoEsforco={rotuloDoEsforco} etiquetaEsforco={etiquetaEsforco}
          tintaModelo={tintaModelo} tintaEsforco={tintaEsforco}
        />
        <DropdownMenuContent
          className={`ck-menu-surge ${aberto ? 'ck-menu-aberto' : 'ck-menu-fechado'}`}
          side="top" align="start" sideOffset={4} collisionPadding={8}
          style={{ width: 'var(--ck-w-menu)' }}
        >
          <ConteudoDoSeletor
            tela={tela} opcoesModelo={opcoesModelo} opcoesEsforco={opcoesEsforco}
            rotuloModelo={rotuloModelo} rotuloDoEsforco={rotuloDoEsforco}
            salvando={salvando} telaEstreita={telaEstreita} modeloPendente={modeloPendente}
            aviso={aviso} aoMudarTela={setTela}
            aoConfirmarTroca={() => { if (modeloPendente) void trocarModelo(modeloPendente, true); }}
            aoFechar={() => alterarAbertura(false)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {ressalva}
    </div>
  );
}
