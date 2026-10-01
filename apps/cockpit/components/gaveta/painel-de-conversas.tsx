'use client';

/**
 * O HISTÓRICO — terceira visão da gaveta (`?painel=conversas`, F9 e F10 das conversas).
 *
 * Direção A da F8, aprovada pelo Rica em 01/10, com o "Em uso agora" da C no
 * topo: a conversa de agora num cartão próprio (com a Nova conversa), depois
 * filtro, busca e a lista, onde um toque abre a conversa ali mesmo com
 * Retomar, ⭐ e 🗑. Confirmação, espera e erro abrem no próprio bloco.
 *
 * A lista chega numa ida só e o resto é local (`conversas.ts`). A ⭐ é otimista:
 * vira na hora e desvira se a API recusar, com o motivo no próprio bloco.
 * Ocupado vem da frota ao vivo; desligado e motor religando, do `usaVidaDoAgente`.
 * A API é a palavra final: um 409 `ocupado` reabre a confirmação de interromper.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchConversas, postConversaEstrela, type ConversasResponse } from '@grupo_borges/cockpit-core/api';

import { usaFrota } from '../shell/frota-provider';
import { LinkFechaPainel } from '../shell/superficie-otimista';
import { LinkDaGaveta } from '../shell/vista-da-gaveta';
import { AcaoDeConversa } from './acao-de-conversa';
import { ATUAL, ondeMostra, trocaEmCurso } from './acoes-de-conversa';
import { CartaoEmUso } from './cartao-em-uso';
import { filtraConversas, listaVazia, sabePendencia, separaAtual, type FiltroDeConversa } from './conversas';
import { Busca, Filtros } from './filtros-de-conversa';
import { LinhaDeConversa } from './linha-de-conversa';
import { Bloco, Cartao, Pilula } from './pecas';
import { usaAcoesDeConversa } from './usa-acoes-de-conversa';
import { usaVidaDoAgente } from './usa-vida-do-agente';

type Carga = { fase: 'carregando' } | { fase: 'falhou'; motivo: string } | { fase: 'pronto'; dados: ConversasResponse; lidaEm: number };

const ALVO_DO_CABECALHO = {
  minWidth: 'var(--ck-touch-min)',
  minHeight: 'var(--ck-touch-min)',
  borderRadius: 'var(--ck-radius-chip)',
  fontSize: 'var(--ck-text-lg)',
  color: 'var(--ck-text-secondary)',
} as const;

function Aviso({ children }: { children: string }) {
  return (
    <Bloco>
      <p role="status" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
        {children}
      </p>
    </Bloco>
  );
}

export function PainelDeConversas({ agentSlug, fecharHref }: { agentSlug: string; fecharHref: string }) {
  const { agents } = usaFrota();
  const nomeDoAgente = useCallback((slug: string) => agents.find((a) => a.slug === slug)?.name ?? slug, [agents]);
  const nome = nomeDoAgente(agentSlug);
  const ocupado = agents.find((a) => a.slug === agentSlug)?.status === 'trabalhando';
  const vida = usaVidaDoAgente(agentSlug, false);
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [filtro, setFiltro] = useState<FiltroDeConversa>('todas');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [falha, setFalha] = useState<{ id: string; texto: string } | null>(null);
  const [seguradas, setSeguradas] = useState<ReadonlySet<string>>(() => new Set());

  /** `quieto`: relê sem trocar a lista por "Lendo…" (depois de uma troca). */
  const ler = useCallback(
    (signal?: AbortSignal, quieto = false) => {
      if (!quieto) setCarga({ fase: 'carregando' });
      fetchConversas(agentSlug, signal)
        .then((dados) => {
          if (!signal?.aborted) setCarga({ fase: 'pronto', dados, lidaEm: Date.now() });
        })
        .catch((e: unknown) => {
          if (signal?.aborted || quieto) return;
          setCarga({ fase: 'falhou', motivo: e instanceof Error ? e.message : String(e) });
        });
    },
    [agentSlug],
  );

  useEffect(() => {
    const controlador = new AbortController();
    ler(controlador.signal);
    return () => controlador.abort();
  }, [ler]);

  const { buscar: relePainel } = vida;
  const acoes = usaAcoesDeConversa({
    agentSlug,
    nome,
    aoMudarLinha: () => {
      ler(undefined, true);
      relePainel();
    },
    aoExcluir: (id) => {
      setAberta(null);
      setCarga((c) =>
        c.fase === 'pronto' ? { ...c, dados: { ...c.dados, conversas: c.dados.conversas.filter((x) => x.id !== id) } } : c,
      );
    },
  });

  const lista = carga.fase === 'pronto' ? carga.dados.conversas : [];
  const { atual, outras } = useMemo(() => separaAtual(lista), [lista]);
  const comPendencia = sabePendencia(lista);
  const filtroEmUso = filtro === 'pendencia' && !comPendencia ? 'todas' : filtro;
  const visiveis = useMemo(() => filtraConversas(outras, filtroEmUso, busca, seguradas), [outras, filtroEmUso, busca, seguradas]);

  // Onde a ação aparece: na linha dela, ou no topo quando é a Nova, quando a
  // tela recarregou sem saber o alvo, ou quando o filtro esconde a linha.
  const onde = ondeMostra(acoes.estado);
  const noTopo = onde !== null && (onde === ATUAL || !visiveis.some((c) => c.id === onde));
  const emTroca = trocaEmCurso(acoes.estado);
  const podeTrocar = !emTroca && !vida.aplicandoMotor && acoes.estado.fase !== 'excluindo';
  const porQueNao = vida.aplicandoMotor
    ? 'O motor está sendo trocado. Retomar e excluir voltam quando ele religar.'
    : emTroca
      ? 'Há uma troca de conversa em andamento.'
      : null;
  const acaoEm = (lugar: string) => (
    <AcaoDeConversa estado={acoes.estado} onde={lugar} nome={nome} agora={acoes.agora} aoConfirmar={acoes.confirma} aoLargar={acoes.larga} />
  );

  function escolheFiltro(f: FiltroDeConversa) {
    setSeguradas(new Set());
    setFiltro(f);
  }

  function trocaEstrela(id: string, valor: boolean) {
    if (carga.fase !== 'pronto' || marcando) return;
    const vira = (v: boolean) =>
      setCarga((c) =>
        c.fase === 'pronto'
          ? { ...c, dados: { ...c.dados, conversas: c.dados.conversas.map((x) => (x.id === id ? { ...x, estrela: v } : x)) } }
          : c,
      );
    vira(valor);
    if (!valor && filtroEmUso === 'estrela') setSeguradas((s) => new Set(s).add(id));
    setMarcando(id);
    setFalha(null);
    postConversaEstrela(agentSlug, id, valor)
      .catch((e: unknown) => {
        vira(!valor);
        setFalha({ id, texto: `A estrela não ficou: ${e instanceof Error ? e.message : String(e)}` });
      })
      .finally(() => setMarcando(null));
  }

  const agora = carga.fase === 'pronto' ? carga.lidaEm : 0;
  const dePe = vida.carga === 'pronto' ? vida.dePe : true;
  const suportado = carga.fase === 'pronto' && carga.dados.suportado;

  return (
    <div className="ck-gv flex min-h-0 flex-auto flex-col overflow-y-auto" style={{ gap: 'var(--ck-space-2)', padding: 'var(--ck-space-3)' }}>
      <header className="flex shrink-0 items-center" style={{ gap: 'var(--ck-space-1)', minHeight: '48px' }}>
        <LinkDaGaveta href={`${fecharHref}?painel=detalhes`} aria-label="Voltar para a gaveta do agente" className="ck-veil flex items-center justify-center" style={ALVO_DO_CABECALHO}>
          ‹
        </LinkDaGaveta>
        <h2 className="min-w-0 flex-1 truncate" style={{ fontSize: 'var(--ck-text-md)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>
          Histórico
        </h2>
        <LinkFechaPainel href={fecharHref} rotulo="detalhes do agente" className="ck-veil flex items-center justify-center" style={ALVO_DO_CABECALHO}>
          ×
        </LinkFechaPainel>
      </header>

      {carga.fase === 'carregando' ? <Aviso>Lendo as conversas…</Aviso> : null}

      {carga.fase === 'falhou' ? (
        <Bloco>
          <p role="alert" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)' }}>
            Não consegui ler as conversas: {carga.motivo}
          </p>
          <div className="flex">
            <Pilula aoTocar={() => ler()}>Tentar de novo</Pilula>
          </div>
        </Bloco>
      ) : null}

      {carga.fase === 'pronto' && !carga.dados.suportado ? (
        <Aviso>O motor deste agente não guarda conversas que o cockpit saiba ler.</Aviso>
      ) : null}

      {/* A troca que voltou de um recarregar aparece mesmo antes da lista chegar. */}
      {suportado || (noTopo && carga.fase !== 'pronto') ? (
        <CartaoEmUso
          atual={atual}
          dePe={dePe}
          podeTrocar={podeTrocar}
          acao={noTopo && onde ? acaoEm(onde) : null}
          aoNova={() => acoes.pedeNova(ocupado)}
        />
      ) : null}

      {suportado ? (
        <>
          <Filtros filtro={filtroEmUso} escolhe={escolheFiltro} comPendencia={comPendencia} />
          <Busca valor={busca} muda={setBusca} />

          <Cartao rotulo="Conversas">
            {visiveis.length === 0 ? <Aviso>{listaVazia(filtroEmUso, busca)}</Aviso> : null}
            {visiveis.map((c) => (
              <LinhaDeConversa
                key={c.id}
                conversa={c}
                agora={agora}
                aberta={aberta === c.id || (onde === c.id && !noTopo)}
                aoAlternar={() => {
                  acoes.larga();
                  setAberta((a) => (a === c.id ? null : c.id));
                }}
                aoMarcarEstrela={() => trocaEstrela(c.id, !c.estrela)}
                marcando={marcando === c.id}
                falha={falha?.id === c.id ? falha.texto : null}
                nomeDoAgente={nomeDoAgente}
                acao={onde === c.id && !noTopo ? acaoEm(c.id) : null}
                podeTrocar={podeTrocar}
                porQueNao={porQueNao}
                aoRetomar={() => acoes.pedeRetomar(c.id, { ocupado, desligado: !dePe })}
                aoExcluir={() => acoes.pedeExclusao(c.id)}
              />
            ))}
          </Cartao>
        </>
      ) : null}
    </div>
  );
}
