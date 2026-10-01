'use client';

/**
 * O HISTÓRICO — terceira visão da gaveta (`?painel=conversas`, F9 das conversas).
 *
 * Direção A da F8, aprovada pelo Rica em 01/10, com o "Em uso agora" da C no
 * topo: a conversa de agora num cartão próprio, depois filtro, busca e a lista,
 * onde um toque abre a conversa ali mesmo. Na F9 é só leitura mais a ⭐; Nova
 * conversa, Retomar e 🗑 entram na F10.
 *
 * A lista chega numa ida só e o resto é local (`conversas.ts`). A ⭐ é otimista:
 * vira na hora e desvira se a API recusar, com o motivo no próprio bloco.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchConversas, postConversaEstrela, type ConversasResponse } from '@grupo_borges/cockpit-core/api';

import { usaFrota } from '../shell/frota-provider';
import { IconeBusca } from '../shell/icones';
import { LinkFechaPainel } from '../shell/superficie-otimista';
import { LinkDaGaveta } from '../shell/vista-da-gaveta';
import { contaTurnos, filtraConversas, listaVazia, sabePendencia, separaAtual, type FiltroDeConversa } from './conversas';
import { LinhaDeConversa } from './linha-de-conversa';
import { Bloco, Cartao, Pilula } from './pecas';

type Carga = { fase: 'carregando' } | { fase: 'falhou'; motivo: string } | { fase: 'pronto'; dados: ConversasResponse; lidaEm: number };

const ALVO_DO_CABECALHO = {
  minWidth: 'var(--ck-touch-min)',
  minHeight: 'var(--ck-touch-min)',
  borderRadius: 'var(--ck-radius-chip)',
  fontSize: 'var(--ck-text-lg)',
  color: 'var(--ck-text-secondary)',
} as const;

function Filtros({ filtro, escolhe, comPendencia }: { filtro: FiltroDeConversa; escolhe: (f: FiltroDeConversa) => void; comPendencia: boolean }) {
  const itens: { id: FiltroDeConversa; nome: string }[] = [
    { id: 'todas', nome: 'Todas' },
    { id: 'estrela', nome: 'Especiais' },
    ...(comPendencia ? [{ id: 'pendencia' as const, nome: '⚠︎ Pendentes' }] : []),
  ];
  return (
    <div role="radiogroup" aria-label="Filtro" className="ck-gv-segmento flex shrink-0" style={{ padding: '3px', borderRadius: 'var(--ck-radius-pill)' }}>
      {itens.map((f) => (
        <button
          key={f.id}
          type="button"
          role="radio"
          aria-checked={filtro === f.id}
          onClick={() => escolhe(f.id)}
          className="ck-gv-segmento-opcao flex flex-auto items-center justify-center"
          style={{ minHeight: '36px', padding: '0 var(--ck-space-3)', borderRadius: 'var(--ck-radius-pill)', fontSize: 'var(--ck-text-sm)', fontWeight: 500 }}
        >
          {f.nome}
        </button>
      ))}
    </div>
  );
}

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
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [filtro, setFiltro] = useState<FiltroDeConversa>('todas');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [falha, setFalha] = useState<{ id: string; texto: string } | null>(null);

  const ler = useCallback(
    (signal?: AbortSignal) => {
      setCarga({ fase: 'carregando' });
      fetchConversas(agentSlug, signal)
        .then((dados) => {
          if (!signal?.aborted) setCarga({ fase: 'pronto', dados, lidaEm: Date.now() });
        })
        .catch((e: unknown) => {
          if (!signal?.aborted) setCarga({ fase: 'falhou', motivo: e instanceof Error ? e.message : String(e) });
        });
    },
    [agentSlug],
  );

  useEffect(() => {
    const controlador = new AbortController();
    ler(controlador.signal);
    return () => controlador.abort();
  }, [ler]);

  const lista = carga.fase === 'pronto' ? carga.dados.conversas : [];
  const { atual, outras } = useMemo(() => separaAtual(lista), [lista]);
  const comPendencia = sabePendencia(lista);
  const filtroEmUso = filtro === 'pendencia' && !comPendencia ? 'todas' : filtro;
  const visiveis = useMemo(() => filtraConversas(outras, filtroEmUso, busca), [outras, filtroEmUso, busca]);

  function trocaEstrela(id: string, valor: boolean) {
    if (carga.fase !== 'pronto' || marcando) return;
    const vira = (v: boolean) =>
      setCarga((c) =>
        c.fase === 'pronto'
          ? { ...c, dados: { ...c.dados, conversas: c.dados.conversas.map((x) => (x.id === id ? { ...x, estrela: v } : x)) } }
          : c,
      );
    vira(valor);
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

      {carga.fase === 'pronto' && carga.dados.suportado ? (
        <>
          {atual ? (
            <Cartao titulo="Em uso agora">
              <Bloco>
                <span style={{ fontSize: 'var(--ck-text-base)', fontWeight: 500, color: 'var(--ck-text-primary)' }}>{atual.titulo}</span>
                {atual.nota ? (
                  <span style={{ fontSize: 'var(--ck-text-sm)', lineHeight: 'var(--ck-leading-body)', color: 'var(--ck-text-secondary)' }}>{atual.nota}</span>
                ) : null}
                <span className="ck-tabular" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
                  {contaTurnos(atual.turnos)}
                </span>
              </Bloco>
            </Cartao>
          ) : null}

          <Filtros filtro={filtroEmUso} escolhe={setFiltro} comPendencia={comPendencia} />

          <label className="flex shrink-0 items-center" style={{ gap: 'var(--ck-space-2)', minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-4)', borderRadius: 'var(--ck-radius-pill)', background: 'var(--ck-gv-bloco)', color: 'var(--ck-text-secondary)' }}>
            <IconeBusca tamanho={15} />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar no título ou na nota"
              aria-label="Buscar no título ou na nota"
              className="min-w-0 flex-1 bg-transparent outline-none"
              style={{ fontSize: 'var(--ck-text-md)', color: 'var(--ck-text-primary)' }}
            />
          </label>

          <Cartao rotulo="Conversas">
            {visiveis.length === 0 ? <Aviso>{listaVazia(filtroEmUso, busca)}</Aviso> : null}
            {visiveis.map((c) => (
              <LinhaDeConversa
                key={c.id}
                conversa={c}
                agora={agora}
                aberta={aberta === c.id}
                aoAlternar={() => setAberta((a) => (a === c.id ? null : c.id))}
                aoMarcarEstrela={() => trocaEstrela(c.id, !c.estrela)}
                marcando={marcando === c.id}
                falha={falha?.id === c.id ? falha.texto : null}
                nomeDoAgente={nomeDoAgente}
              />
            ))}
          </Cartao>
        </>
      ) : null}
    </div>
  );
}
