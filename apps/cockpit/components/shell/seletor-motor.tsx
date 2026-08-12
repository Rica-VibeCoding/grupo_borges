'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AgentInputError,
  fetchAgentPainel,
  patchAgentEffort,
  postAgentModel,
} from '@grupo_borges/cockpit-core/api';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import { DropdownMenu, DropdownMenuContent } from '../ui/dropdown-menu';
import { esperaConvergenciaDoEsforco, type ControleConvergencia } from './convergencia-esforco';
import { EtiquetaDoEsforco } from './etiqueta-esforco';
import {
  desfechoDaTrocaDeEsforco,
  desfechoDaTrocaDeModelo,
  etiquetaDoEsforco,
  rotulaEsforco,
  rotulaModelo,
  type Motor,
} from './motor';
import { GatilhoDoSeletor } from './seletor-motor-gatilho';
import { ConteudoDoSeletor, type TelaDoSeletor } from './seletor-motor-menu';

type PainelDoMotor = Pick<AgentPainelResponse, 'model' | 'effort'>;

type SeletorMotorProps = {
  agentSlug: string;
  agentName: string;
  motor: Motor;
  /** Kimi/Codex têm `requested` no painel; o Claude não (ver motor.ts). */
  esforcoCobrePedido: boolean;
};

function pedeConfirmacao(erro: unknown): boolean {
  return (
    erro instanceof AgentInputError &&
    erro.status === 409 &&
    erro.detail === 'agent_busy_confirm_required'
  );
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

export function SeletorMotor({ agentSlug, agentName, motor, esforcoCobrePedido }: SeletorMotorProps) {
  // `undefined` = ainda não voltou; `null` = voltou sem nada. Ver `!temControle`.
  const [painel, setPainel] = useState<PainelDoMotor | null | undefined>(undefined);
  const [aberto, setAberto] = useState(false);
  const [tela, setTela] = useState<TelaDoSeletor>('inicio');
  // `string` e não um Literal fechado: o catálogo Codex é lido do CLI em tempo
  // de execução, então a pele não tem como enumerar os slugs em tipo.
  const [modeloPendente, setModeloPendente] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const telaEstreita = usaTelaEstreita();
  const convergencia = useRef<ControleConvergencia | null>(null);

  useEffect(() => {
    let vivo = true;
    setPainel(undefined);
    convergencia.current?.parar();
    convergencia.current = null;
    fetchAgentPainel(agentSlug)
      .then((resposta) => {
        if (vivo) setPainel({ model: resposta.model ?? null, effort: resposta.effort });
      })
      .catch(() => {
        if (vivo) setPainel(null);
      });
    return () => {
      vivo = false;
      convergencia.current?.parar();
      convergencia.current = null;
    };
  }, [agentSlug]);

  const modelo = painel?.model ?? null;
  const esforco = painel?.effort ?? null;
  const rotuloModelo = modelo?.value ? rotulaModelo(modelo.value) : motor.modelo;
  const rotuloDoEsforco = esforco?.value ? rotulaEsforco(esforco.value) : motor.esforco;
  const etiquetaEsforco = etiquetaDoEsforco(esforco, esforcoCobrePedido);
  const temControle = Boolean(modelo?.allowed.length || esforco?.allowed.length);

  // DOIS DEGRAUS DE TINTA, não um — 10/08. Modelo e esforço dividiam a mesma
  // cor, e o rótulo lia como um bloco só ("Opus extra alto"); a referência
  // separa QUEM pensa de QUANTO pensa dando claro ao nome e cinza ao nível.
  // `pode-divergir` continua sendo um degrau inteiro abaixo — a incerteza vale
  // para o par, não só para o modelo —, e o degrau relativo sobrevive lá.
  const divergindo = motor.certeza === 'pode-divergir';
  const tintaModelo = divergindo ? 'var(--ck-text-secondary)' : 'var(--ck-text-primary)';
  const tintaEsforco = divergindo ? 'var(--ck-text-tertiary)' : 'var(--ck-text-secondary)';

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
    // Uma nova troca supera qualquer convergência da troca anterior — sem
    // isto, duas trocas seguidas deixariam dois polls escrevendo `painel` um
    // por cima do outro.
    convergencia.current?.parar();
    setSalvando(true);
    setAviso(null);
    try {
      const resposta = await patchAgentEffort(agentSlug, valor);
      // 200 não é sinônimo de aplicado — o back sinaliza no corpo, igual à
      // troca de modelo. A máquina de estados mora em motor.ts (testada);
      // aqui ficam os textos. Os dois caminhos de não-aplicado NÃO fecham o
      // menu e NÃO pintam o card com o valor pedido — enquanto a sessão não
      // confirma, o valor honesto é o antigo.
      const desfecho = desfechoDaTrocaDeEsforco(resposta);
      if (desfecho === 'entrega-falhou') {
        mostrarAviso('Não foi possível entregar a troca ao agente.');
        return;
      }
      if (desfecho === 'pendente') {
        mostrarAviso(
          'A troca foi entregue, mas o agente está no meio de um turno e ainda não a confirmou. O card segue no nível atual até a sessão confirmar.',
        );
        // O painel NÃO converge sozinho — o efeito de montagem só busca uma
        // vez por `agentSlug`. Aqui a máquina poll o `/painel` até o back
        // confirmar o valor pedido (achado [3] da auditoria, 09/08).
        convergencia.current?.parar();
        convergencia.current = esperaConvergenciaDoEsforco(
          valor,
          () => fetchAgentPainel(agentSlug),
          (resposta) =>
            setPainel({ model: resposta.model ?? null, effort: resposta.effort }),
        );
        return;
      }
      setPainel((atual) =>
        atual
          ? {
              ...atual,
              effort: {
                ...atual.effort,
                value: resposta.effort,
                source: resposta.source,
                session_may_diverge: resposta.session_may_diverge,
              },
            }
          : atual,
      );
      alterarAbertura(false);
    } catch {
      mostrarAviso('Não foi possível trocar o esforço.');
    } finally {
      setSalvando(false);
    }
  }

  async function trocarModelo(valor: string, forcar = false) {
    setSalvando(true);
    setAviso(null);
    try {
      const resposta = await postAgentModel(agentSlug, valor, { force: forcar });
      const desfecho = desfechoDaTrocaDeModelo(resposta);
      if (desfecho === 'entrega-falhou') {
        mostrarAviso('Não foi possível entregar a troca ao agente.');
        return;
      }
      setModeloPendente(null);
      setPainel((atual) =>
        atual?.model
          ? {
              ...atual,
              model: {
                ...atual.model,
                value: resposta.model,
                source: 'agent.state_model',
                session_may_diverge: !resposta.confirmed,
              },
            }
          : atual,
      );
      // Codex/Kimi fecham igual ao confirmado: a escolha foi gravada e é a que
      // vale daqui pra frente. O aviso de "vale no próximo turno" foi retirado
      // a pedido do Rica (10/08) — a ressalva continua no `session_may_diverge`,
      // que é o canal que já existe pra isso.
      if (resposta.confirmed || desfecho === 'proximo-turno') {
        alterarAbertura(false);
        return;
      }
      mostrarAviso('A troca foi entregue, mas a sessão ainda não a confirmou.');
    } catch (erro) {
      if (!forcar && pedeConfirmacao(erro)) {
        setModeloPendente(valor);
        setTela('confirmacao');
        return;
      }
      mostrarAviso('Não foi possível trocar o modelo.');
    } finally {
      setSalvando(false);
    }
  }

  // A lista vem inteira do back e não é mais filtrada aqui. O filtro anterior
  // só deixava passar fable/opus/sonnet/haiku, então o `allowed` da Tara — que
  // são slugs `codex-*` — era descartado por completo e o menu de modelo dela
  // nascia vazio. Quem sabe o que cada motor aceita é o back (`model.allowed`);
  // a pele só traduz o rótulo.
  const opcoesModelo =
    modelo?.allowed.map((valor) => ({
      chave: valor,
      rotulo: rotulaModelo(valor),
      selecionado: modelo.value === valor,
      aoSelecionar: () => void trocarModelo(valor),
    })) ?? [];

  const opcoesEsforco =
    esforco?.allowed.map((valor) => ({
      chave: valor,
      rotulo: rotulaEsforco(valor) ?? valor,
      selecionado: esforco.value === valor,
      aoSelecionar: () => void trocarEsforco(valor),
    })) ?? [];

  // Veredito só DEPOIS da resposta: dado antes, o rótulo nascia texto pequeno e
  // cinza e virava botão quando o painel voltava — o pulo filmado em 12/08.
  if (!temControle && painel !== undefined) {
    return (
      <div
        className="flex min-w-0 items-center"
        style={{ gap: '3px', fontSize: 'var(--ck-text-sm)' }}
        title={`${rotuloModelo}${rotuloDoEsforco ? `, esforço ${rotuloDoEsforco}` : ''}`}
      >
        <span className="truncate" style={{ color: tintaModelo }}>
          {rotuloModelo}
        </span>
        {rotuloDoEsforco ? <span style={{ color: tintaEsforco }}>{rotuloDoEsforco}</span> : null}
        {etiquetaEsforco ? <EtiquetaDoEsforco etiqueta={etiquetaEsforco} /> : null}
      </div>
    );
  }

  return (
    // Esperando não há opção para listar; o toque abre quando o painel vem.
    <DropdownMenu open={aberto && temControle} onOpenChange={alterarAbertura}>
      <GatilhoDoSeletor
        agentName={agentName}
        aberto={aberto}
        rotuloModelo={rotuloModelo}
        rotuloDoEsforco={rotuloDoEsforco}
        etiquetaEsforco={etiquetaEsforco}
        tintaModelo={tintaModelo}
        tintaEsforco={tintaEsforco}
      />

      <DropdownMenuContent
        className={`ck-menu-surge ${aberto ? 'ck-menu-aberto' : 'ck-menu-fechado'}`}
        side="top"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        style={{ width: 'var(--ck-w-menu)' }}
      >
        <ConteudoDoSeletor
          tela={tela}
          opcoesModelo={opcoesModelo}
          opcoesEsforco={opcoesEsforco}
          rotuloModelo={rotuloModelo}
          rotuloDoEsforco={rotuloDoEsforco}
          salvando={salvando}
          telaEstreita={telaEstreita}
          modeloPendente={modeloPendente}
          aviso={aviso}
          aoMudarTela={setTela}
          aoConfirmarTroca={() => {
            if (modeloPendente) void trocarModelo(modeloPendente, true);
          }}
          aoFechar={() => alterarAbertura(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
