'use client';

import { useEffect, useState } from 'react';
import {
  AgentInputError,
  fetchAgentPainel,
  patchAgentEffort,
  postAgentModel,
} from '@grupo_borges/cockpit-core/api';
import type { AgentPainelResponse } from '@grupo_borges/cockpit-core/cockpit-types';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { EtiquetaDoEsforco } from './etiqueta-esforco';
import {
  desfechoDaTrocaDeEsforco,
  desfechoDaTrocaDeModelo,
  etiquetaDoEsforco,
  rotulaEsforco,
  rotulaModelo,
  type Motor,
} from './motor';
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
  const [painel, setPainel] = useState<PainelDoMotor | null>(null);
  const [aberto, setAberto] = useState(false);
  const [tela, setTela] = useState<TelaDoSeletor>('inicio');
  // `string` e não um Literal fechado: o catálogo Codex é lido do CLI em tempo
  // de execução, então a pele não tem como enumerar os slugs em tipo.
  const [modeloPendente, setModeloPendente] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const telaEstreita = usaTelaEstreita();

  useEffect(() => {
    let vivo = true;
    setPainel(null);
    fetchAgentPainel(agentSlug)
      .then((resposta) => {
        if (vivo) setPainel({ model: resposta.model ?? null, effort: resposta.effort });
      })
      .catch(() => {
        if (vivo) setPainel(null);
      });
    return () => {
      vivo = false;
    };
  }, [agentSlug]);

  const modelo = painel?.model ?? null;
  const esforco = painel?.effort ?? null;
  const rotuloModelo = modelo?.value ? rotulaModelo(modelo.value) : motor.modelo;
  const rotuloDoEsforco = esforco?.value ? rotulaEsforco(esforco.value) : motor.esforco;
  const etiquetaEsforco = etiquetaDoEsforco(esforco, esforcoCobrePedido);
  const temControle = Boolean(modelo?.allowed.length || esforco?.allowed.length);

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
    setSalvando(true);
    setAviso(null);
    try {
      const resposta = await patchAgentEffort(agentSlug, valor);
      // 200 não é sinônimo de aplicado — o back sinaliza no corpo, igual à
      // troca de modelo. A máquina de estados mora em motor.ts (testada);
      // aqui ficam os textos. Os dois caminhos de não-aplicado NÃO fecham o
      // menu e NÃO pintam o card com o valor pedido — enquanto a sessão não
      // confirma, o valor honesto é o antigo, e o painel converge sozinho
      // quando a statusline viva registrar a troca.
      const desfecho = desfechoDaTrocaDeEsforco(resposta);
      if (desfecho === 'entrega-falhou') {
        mostrarAviso('Não foi possível entregar a troca ao agente.');
        return;
      }
      if (desfecho === 'pendente') {
        mostrarAviso(
          'A troca foi entregue, mas o agente está no meio de um turno e ainda não a confirmou. O card segue no nível atual até a sessão confirmar.',
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

  if (!temControle) {
    return (
      <div
        className="flex min-w-0 items-center"
        style={{ gap: '3px', fontSize: 'var(--ck-text-sm)' }}
        title={`${rotuloModelo}${rotuloDoEsforco ? `, esforço ${rotuloDoEsforco}` : ''}`}
      >
        <span
          className="truncate"
          style={{
            color:
              motor.certeza === 'pode-divergir'
                ? 'var(--ck-text-tertiary)'
                : 'var(--ck-text-secondary)',
          }}
        >
          {rotuloModelo}
        </span>
        {rotuloDoEsforco ? (
          <span style={{ color: 'var(--ck-text-secondary)' }}>{rotuloDoEsforco}</span>
        ) : null}
        {etiquetaEsforco ? <EtiquetaDoEsforco etiqueta={etiquetaEsforco} /> : null}
      </div>
    );
  }

  return (
    <DropdownMenu open={aberto} onOpenChange={alterarAbertura}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Configurar modelo e esforço de ${agentName}`}
          aria-haspopup="menu"
          aria-expanded={aberto}
          className="ck-seletor-motor ck-veil flex min-w-0 items-center"
          // TEXTO SOLTO, não pílula — 10/08. A cápsula (borda + material +
          // desfoque + fio de luz) desenhava uma segunda superfície dentro de
          // uma superfície que já é material, e o rótulo do motor não é um
          // controle de massa: ele é metadado do que está escrito. O raio fica
          // porque o anel de `:focus-visible` é `inset` e sem ele o foco vira
          // um retângulo em volta do texto.
          //
          // `marginBottom` casa com o do botão de onda (`--ck-space-1`), não com
          // o padding da caixa: os dois têm 32px de altura e dividem o mesmo
          // flex `items-center`, então margem diferente era 8px de desnível
          // entre o rótulo e o único elemento sólido da linha.
          style={{
            height: '32px',
            minHeight: '32px',
            gap: 'var(--ck-space-1)',
            marginBottom: 'calc(var(--ck-space-1) * -1)',
            // O `ck-veil` continua: em repouso não pinta nada, e é ele que dá
            // hover e press ao rótulo agora que não há mais cápsula desenhada.
            // O respiro de 8px existe para esse realce (e para o dedo) ter área;
            // a margem negativa devolve os mesmos 8px, então a distância entre
            // o texto e o botão de onda segue sendo o `gap` de 12px de antes.
            padding: '0 var(--ck-space-2)',
            marginRight: 'calc(var(--ck-space-2) * -1)',
            borderRadius: 'var(--ck-radius-pill)',
            fontSize: 'var(--ck-text-base)',
            fontWeight: 500,
            color:
              motor.certeza === 'pode-divergir'
                ? 'var(--ck-text-tertiary)'
                : 'var(--ck-text-secondary)',
          }}
        >
          <span className="truncate">{rotuloModelo}</span>
          {rotuloDoEsforco ? <span className="shrink-0">{rotuloDoEsforco}</span> : null}
          {etiquetaEsforco ? <EtiquetaDoEsforco etiqueta={etiquetaEsforco} /> : null}
          <span aria-hidden className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>⌄</span>
        </button>
      </DropdownMenuTrigger>

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
