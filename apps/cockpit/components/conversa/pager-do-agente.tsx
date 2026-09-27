'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { ArrastoDoChat } from './arrasto-do-chat';
import styles from './pager-do-agente.module.css';
import { painelAssentado, painelDaUrl, urlDoPainel, type Painel } from './rota-do-pager';
import { useMovimentoReduzido } from './use-movimento-reduzido';

// A voz não pesa na primeira pintura do chat: chunk à parte, pré-carregado em ocioso.
const carregaVoz = () => import('./tela-conversa');
const TelaConversa = dynamic(() => carregaVoz().then((modulo) => modulo.TelaConversa));

/** Ocioso no Chrome; o Safari não tem `requestIdleCallback`, então vai por relógio. */
function quandoOcioso(tarefa: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(tarefa, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const relogio = setTimeout(tarefa, 1500);
  return () => clearTimeout(relogio);
}

/** A voz aparece com 1% do painel à vista. Sem `scrollend` (iOS antes do 26.2), assentou a 99%. */
const APARECE = 0.01;
const INTEIRO = 0.99;

/**
 * Chat e voz na mesma tela (fase 3, briefing do pager): dois painéis montados lado a lado, o
 * chat à esquerda e a voz à direita. Quem segue o dedo e assenta é a rolagem nativa do
 * navegador (scroll-snap) — nenhuma troca de rota no gesto. A URL acompanha o painel
 * assentado por `replaceState`: `/agente/{slug}` no chat, `/conversa/{slug}` na voz, sem
 * entrada nova no histórico. `/conversa/{slug}` é a mesma página, com a voz primeiro.
 *
 * A voz monta na primeira vez que aparece e fica montada, uma instância só. Fora da tela ela
 * é `inert`, não tem WebGL e não liga microfone nem wake lock; quem liga é o painel ativo.
 *
 * A direita no chat abre a tropa e a esquerda a fecha (`arrasto-do-chat.tsx`): no começo do
 * pager a direita não tem dono nativo, então não disputa com a rolagem.
 */
export function PagerDoAgente({
  slug,
  nome,
  inicial,
  children,
}: {
  slug: string;
  nome: string;
  /** O painel que o servidor viu na URL: a voz na entrada direta (`?tela=voz`). */
  inicial: Painel;
  /** O chat — barra e palco, montados no servidor. */
  children: ReactNode;
}) {
  const pagerRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLElement>(null);
  const vozRef = useRef<HTMLElement>(null);
  const inicialRef = useRef(inicial);
  const urlProntaRef = useRef(false);
  const [ativo, setAtivo] = useState<Painel>(inicial);
  const [vozVisivel, setVozVisivel] = useState(inicial === 'voz');
  const [montaVoz, setMontaVoz] = useState(inicial === 'voz');
  const reduzido = useMovimentoReduzido();

  // A URL acompanha o painel sem navegar: o `replaceState` que o Next escuta copia a árvore
  // do roteador e atualiza o `usePathname`, sem pedir nada ao servidor.
  const mostraNaUrl = useCallback(
    (painel: Painel) => {
      if (!urlProntaRef.current) return;
      const alvo = urlDoPainel(painel, slug, window.location.search);
      if (`${window.location.pathname}${window.location.search}` !== alvo) window.history.replaceState(null, '', alvo);
    },
    [slug],
  );

  const assenta = useCallback(() => {
    const pager = pagerRef.current;
    if (!pager) return;
    const painel = painelAssentado(pager.scrollLeft, pager.clientWidth);
    if (painel === null) return;
    setAtivo(painel);
    mostraNaUrl(painel);
  }, [mostraNaUrl]);

  const vaiPara = useCallback(
    (painel: Painel, suave = !reduzido) => {
      const pager = pagerRef.current;
      if (!pager) return;
      if (painel === 'voz') setMontaVoz(true);
      pager.scrollTo({ left: painel === 'voz' ? pager.clientWidth : 0, behavior: suave ? 'smooth' : 'instant' });
    },
    [reduzido],
  );
  const irAoChat = useCallback(() => vaiPara('chat'), [vaiPara]);

  // Na hidratação: tira a marca da entrada direta e põe o pager no painel da URL do
  // navegador — que, voltando pelo histórico, pode não ser a que o servidor viu.
  useLayoutEffect(() => {
    const pager = pagerRef.current;
    if (!pager) return;
    const painel = painelDaUrl(window.location.pathname, window.location.search, slug) ?? inicialRef.current;
    pager.dataset.montado = '';
    pager.scrollTo({ left: painel === 'voz' ? pager.clientWidth : 0, behavior: 'instant' });
    if (painel !== inicialRef.current) {
      setAtivo(painel);
      setVozVisivel(painel === 'voz');
      if (painel === 'voz') setMontaVoz(true);
    }
    // O `replaceState` que o Next escuta só existe depois do efeito do roteador, que roda
    // depois deste; chamado antes, o nativo apagaria o estado dele no histórico. A URL espera.
    const relogio = window.setTimeout(() => {
      urlProntaRef.current = true;
      mostraNaUrl(painelAssentado(pager.scrollLeft, pager.clientWidth) ?? painel);
    }, 0);
    return () => {
      window.clearTimeout(relogio);
      urlProntaRef.current = false;
    };
  }, [mostraNaUrl, slug]);

  useEffect(() => quandoOcioso(() => void carregaVoz()), []);

  useEffect(() => {
    const pager = pagerRef.current;
    const chat = chatRef.current;
    const voz = vozRef.current;
    if (!pager || !chat || !voz) return;
    const temFim = 'onscrollend' in window;
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const entrada of entradas) {
          if (entrada.target === voz) {
            const aparece = entrada.intersectionRatio >= APARECE;
            setVozVisivel(aparece);
            if (aparece) setMontaVoz(true);
          }
          if (!temFim && entrada.intersectionRatio >= INTEIRO) assenta();
        }
      },
      { root: pager, threshold: [APARECE, INTEIRO] },
    );
    observador.observe(chat);
    observador.observe(voz);
    if (temFim) pager.addEventListener('scrollend', assenta);
    // Voltar e avançar do navegador: o pager vai ao painel da URL, sem animar.
    const aoVoltar = () => {
      const painel = painelDaUrl(window.location.pathname, window.location.search, slug);
      if (painel !== null) vaiPara(painel, false);
    };
    window.addEventListener('popstate', aoVoltar);
    return () => {
      observador.disconnect();
      pager.removeEventListener('scrollend', assenta);
      window.removeEventListener('popstate', aoVoltar);
    };
  }, [assenta, slug, vaiPara]);

  // O link da voz na barra do chat (teclado e leitor de tela) leva o pager, sem navegar. Na
  // captura: o `Link` do Next desiste quando o clique chega a ele já com `preventDefault`.
  const aoClicar = (evento: MouseEvent<HTMLDivElement>) => {
    if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    const link = evento.target instanceof Element ? evento.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.origin !== window.location.origin || link.pathname !== `/conversa/${slug}`) return;
    evento.preventDefault();
    vaiPara('voz');
  };

  return (
    <div ref={pagerRef} className={styles.pager} data-inicial={inicial} data-painel-ativo={ativo} onClickCapture={aoClicar}>
      <section ref={chatRef} className={styles.painel} data-painel="chat" aria-label="Chat" inert={ativo !== 'chat'}>
        {children}
      </section>
      <section ref={vozRef} className={styles.painel} data-painel="voz" aria-label="Conversa por voz" inert={ativo !== 'voz'}>
        {montaVoz ? (
          <TelaConversa key={slug} slug={slug} nome={nome} ativa={ativo === 'voz'} visivel={vozVisivel} aoIrAoChat={irAoChat} />
        ) : null}
      </section>
      <ArrastoDoChat pagerRef={pagerRef} chatRef={chatRef} />
    </div>
  );
}
