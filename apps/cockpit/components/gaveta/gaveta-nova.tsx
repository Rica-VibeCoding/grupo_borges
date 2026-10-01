'use client';

/**
 * A GAVETA DO ZERO — ideia para o Rica olhar (branch `ideia/gaveta-do-zero`).
 *
 * Mesmas funções da gaveta de 28/09, forma nova, na linguagem da referência
 * ACI Biller dark: um cartão-mãe preto com o herói no topo e, embaixo, cartões
 * grafite com blocos pretos dentro.
 *
 * Versão DISCRETA (`ideia/gaveta-discreta`): o herói virou cabeçalho de uma
 * linha e o interruptor subiu para ele — o cartão Sessão perdeu o título.
 *
 * - **Sessão** — o interruptor É o ciclo de vida: ligado = "Ativo" (azul),
 *   um toque desliga direto (sem armar, pedido do Rica 01/10); desligado,
 *   tocar liga. Dentro: o pulso, a porta do Histórico de conversas
 *   (`?painel=conversas`), a pesquisa (só onde existe) e os comandos. A porta
 *   tomou o lugar do Destravar, que saiu da gaveta (Rica, 01/10), e aparece
 *   com o agente ligado e desligado.
 * - **Motor e conta** — os blocos de sempre, cada um num bloco preto.
 * - **MCPs** — a área tracejada com "+", porta para `?painel=mcps`.
 * - **Conversa** — só quando a gaveta abre pela tela de voz.
 *
 * Estado e rede vêm de `usaVidaDoAgente`, cópia fiel do antigo `BlocoDeAcoes`. O
 * `flex-auto` (não `flex-1`) segue a lição do iPhone de 02/08 (estética §5).
 */
import { usePathname, useSearchParams } from 'next/navigation';

import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { mostraConversaNoPainel } from '../conversa/conversa-no-painel';

import { descreveAcaoBruta, descreveLigar } from '../shell/acoes-rapidas';
import { BlocoDeComandos } from '../shell/bloco-de-comandos';
import { BlocoDeCota } from '../shell/bloco-de-cota';
import { BlocoDeMotor } from '../shell/bloco-de-motor';
import { FaixaDoPulso } from '../shell/faixa-do-pulso';
import { IconeBusca, IconeDescartar, IconeHistorico } from '../shell/icones';
import { alternaPesquisa, podePesquisar } from '../shell/pesquisa-canario';
import { usaPesquisaAtiva } from '../shell/usa-pesquisa';
import { VeuDeOperacao } from '../shell/veu-de-operacao';
import { LinkDaGaveta } from '../shell/vista-da-gaveta';
import { CartaoDaConversa } from './cartao-da-conversa';
import { Heroi } from './heroi';
import { Bloco, Cartao, Interruptor, Mais, Pilula } from './pecas';
import { usaVidaDoAgente } from './usa-vida-do-agente';

type Vida = ReturnType<typeof usaVidaDoAgente>;

function InterruptorDaSessao({ v }: { v: Vida }) {
  if (v.carga !== 'pronto') {
    return <Interruptor ligado={false} rotulo="…" descricao="Lendo o estado do agente" desabilitado aoAlternar={() => {}} />;
  }
  if (v.aplicandoMotor) {
    return <Interruptor ligado rotulo="Religando" descricao="Aplicando o motor — o agente está religando" ocupado desabilitado aoAlternar={() => {}} />;
  }
  if (v.dePe) {
    const rotulo =
      v.desligar === 'enviando' ? 'Desligando…' : v.desligar === 'concluido' ? 'Desligado' : 'Ativo';
    return (
      <Interruptor
        ligado={v.desligar !== 'concluido'}
        rotulo={rotulo}
        descricao={descreveAcaoBruta(v.desligar)}
        ocupado={v.desligar === 'enviando'}
        aoAlternar={() => void v.acionarDesligar()}
      />
    );
  }
  return (
    <Interruptor
      ligado={v.ligar === 'entregue'}
      rotulo={v.ligar === 'enviando' ? 'Ligando…' : v.ligar === 'entregue' ? 'Ligado' : 'Desligado'}
      descricao={descreveLigar(v.ligar)}
      ocupado={v.ligar === 'enviando'}
      aoAlternar={() => void v.acionarLigar()}
    />
  );
}

/** Linha de bloco com interruptor — a pesquisa do canário. */
function LinhaDaPesquisa({ agentSlug }: { agentSlug: string }) {
  const ativa = usaPesquisaAtiva(agentSlug);
  return (
    <Bloco style={{ padding: 'var(--ck-space-1) var(--ck-space-3) var(--ck-space-1) var(--ck-space-4)' }}>
      <div className="flex items-center justify-between" style={{ gap: 'var(--ck-space-2)' }}>
        <span className="flex items-center" style={{ gap: 'var(--ck-space-2)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>
          <IconeBusca tamanho={15} /> Pesquisa
        </span>
        <Interruptor
          ligado={ativa}
          rotulo={ativa ? 'Ligada' : 'Desligada'}
          descricao={ativa ? 'Pesquisa ligada — toque para desligar' : 'Ligar pesquisa'}
          aoAlternar={() => alternaPesquisa(agentSlug)}
        />
      </div>
    </Bloco>
  );
}

function Avisos({ v }: { v: Vida }) {
  return (
    <>
      {v.avisoConfirmacao ? (
        <p role="status" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}>
          {v.avisoConfirmacao}
        </p>
      ) : null}
      {v.falha ? (
        <div className="flex items-start justify-between" style={{ gap: 'var(--ck-space-3)' }} role="alert">
          <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}>
            {v.falha.resumo} — {v.falha.saida}
          </span>
          <button
            type="button"
            onClick={() => v.setFalha(null)}
            aria-label="Dispensar aviso"
            className="ck-veil flex shrink-0 items-center justify-center rounded-full"
            style={{ minHeight: 'var(--ck-touch-min)', minWidth: 'var(--ck-touch-min)', color: 'var(--ck-text-secondary)' }}
          >
            <IconeDescartar tamanho={13} />
          </button>
        </div>
      ) : null}
    </>
  );
}

/** A porta do Histórico, no lugar onde morava o Destravar. Pílula larga e não
 *  área tracejada: o tracejado é "abrir ou criar" (MCPs), e aqui é só abrir. */
function PortaDoHistorico({ fecharHref }: { fecharHref: string }) {
  return (
    <LinkDaGaveta
      href={`${fecharHref}?painel=conversas`}
      className="ck-gv-pilula ck-veil flex items-center justify-center"
      style={{
        gap: 'var(--ck-space-2)',
        minHeight: 'var(--ck-touch-min)',
        padding: '0 var(--ck-space-4)',
        borderRadius: 'var(--ck-radius-pill)',
        fontSize: 'var(--ck-text-sm)',
        color: 'var(--ck-text-primary)',
      }}
    >
      <IconeHistorico tamanho={16} />
      Histórico de conversas
    </LinkDaGaveta>
  );
}

function CartaoDaSessao({ v, agentSlug, fecharHref }: { v: Vida; agentSlug: string; fecharHref: string }) {
  const pronto = v.carga === 'pronto';
  return (
    <Cartao rotulo="Sessão">
      {v.carga === 'indisponivel' ? (
        <Bloco>
          <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
            não consegui ler os controles deste agente
          </span>
          <div className="flex">
            <Pilula aoTocar={() => v.buscar()}>Tentar de novo</Pilula>
          </div>
        </Bloco>
      ) : null}

      {/* Reserva enquanto o `/painel` não volta: sem ela o cartão cresce com o
          dedo no ar (o incidente de 09/08). */}
      {!pronto && v.carga !== 'indisponivel' ? <div aria-hidden style={{ height: '146px' }} /> : null}

      {pronto && v.aplicandoMotor ? (
        <Bloco>
          <p role="status" aria-live="polite" aria-busy style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)', textAlign: 'center' }}>
            {v.operacao.aviso}
          </p>
        </Bloco>
      ) : null}

      {pronto && !v.dePe && !v.aplicandoMotor ? (
        <Bloco>
          <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>Fora do ar</span>
          <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
            A conversa ficou guardada. Ligar retoma de onde parou.
          </span>
        </Bloco>
      ) : null}

      {pronto && v.dePe ? (
        <Bloco>
          {v.pulso.leitura ? (
            <FaixaDoPulso slug={agentSlug} leitura={v.pulso.leitura} alturas={v.pulso.alturas} />
          ) : (
            <div aria-hidden style={{ height: '98px' }} />
          )}
        </Bloco>
      ) : null}

      {pronto ? <PortaDoHistorico fecharHref={fecharHref} /> : null}

      {pronto && v.dePe && !v.aplicandoMotor && podePesquisar(agentSlug) ? <LinhaDaPesquisa agentSlug={agentSlug} /> : null}

      <Avisos v={v} />

      {pronto && v.dePe ? (
        <Bloco cru>
          <BlocoDeComandos agentSlug={agentSlug} aberto={v.aberto} />
        </Bloco>
      ) : null}
    </Cartao>
  );
}

export function GavetaNova({ agente, fecharHref, agora }: { agente: Agent; fecharHref: string; agora: number }) {
  const v = usaVidaDoAgente(agente.slug, false);
  const pronto = v.carga === 'pronto';
  const alerta = v.carga === 'indisponivel' || v.semSinal || v.falha !== null;
  const conversa = mostraConversaNoPainel(usePathname() ?? '', useSearchParams()?.toString() ?? '');

  return (
    <div
      className="ck-gv flex min-h-0 flex-auto flex-col overflow-y-auto"
      style={{ gap: 'var(--ck-space-2)', padding: 'var(--ck-space-3)' }}
    >
      {v.aplicandoMotor && v.operacao.aviso ? <VeuDeOperacao aviso={v.operacao.aviso} /> : null}

      <Heroi
        agente={agente}
        agora={agora}
        fecharHref={fecharHref}
        alerta={alerta}
        interruptor={<InterruptorDaSessao v={v} />}
      />

      {conversa ? <CartaoDaConversa /> : null}

      <CartaoDaSessao v={v} agentSlug={agente.slug} fecharHref={fecharHref} />

      {pronto ? (
        <Cartao titulo="Motor e conta">
          {v.painel?.motor ? (
            <Bloco cru>
              <BlocoDeMotor agentSlug={agente.slug} agentName={agente.name} motor={v.painel.motor} aoAtualizar={v.buscar} />
            </Bloco>
          ) : null}
          <Bloco cru style={{ paddingTop: 'var(--ck-space-2)' }}>
            <BlocoDeCota quotas={v.painel?.quotas} agentSlug={agente.slug} aoAtualizar={v.buscar} />
          </Bloco>
        </Cartao>
      ) : null}

      <Cartao rotulo="MCPs">
        <LinkDaGaveta
          href={`${fecharHref}?painel=mcps`}
          className="ck-gv-tracejado ck-veil flex items-center justify-center"
          style={{
            gap: 'var(--ck-space-3)',
            minHeight: '48px',
            borderRadius: 'var(--ck-gv-raio-bloco)',
            fontSize: 'var(--ck-text-sm)',
            fontWeight: 500,
            color: 'var(--ck-text-primary)',
          }}
        >
          <Mais />
          MCPs do agente
        </LinkDaGaveta>
      </Cartao>
    </div>
  );
}
