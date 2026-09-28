/**
 * Tropa — a lista de agentes.
 *
 * Mora aqui, e não dentro de `app/page.tsx`, porque aparece em DUAS superfícies:
 * é a rota `/` inteira no celular e é a coluna de navegação no desktop, inclusive
 * quando você já está dentro de um agente.
 *
 * Oito versões, cada uma com decisão ditada pelo Rica — o histórico inteiro, com
 * o que mudou e por quê, está em `docs/cockpit-v2-tropa-levantamento.md`
 * ("Histórico das versões da tropa"). O que vale hoje, e não se mexe sem ele:
 *
 * - A ordem é DELE, arrastada (`agent_state.ordem`); nenhum estado move linha e
 *   não há seções nem títulos de estado.
 * - O arrasto é pela LINHA INTEIRA: toque curto abre, segurar carrega. A alça
 *   só existe para teclado e leitor de tela (`arrasto-da-tropa.tsx`).
 * - O estado mora no ANEL do retrato (v8): trabalhando e aguardando têm anel;
 *   ocioso e offline, não. Nada de chip por linha repetindo estado.
 * - Quem dorme é linha rasa: nome e contexto, sem pasta, sem "há 20h".
 * - A pasta só aparece quando o agente está FORA de casa.
 * - A VPS fica no rodapé da tropa.
 *
 * O desenho de cada linha mora em `linha-da-tropa.tsx` e `miudezas-da-linha.tsx`.
 *
 * Dono: Daniel (pele). As medidas vêm do esqueleto.
 */
'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { patchOrdemDaTropa } from '@grupo_borges/cockpit-core/api';
import { deslizes } from '@/lib/desliza-tropa';
import { ordenaTropa } from '@/lib/ordena-tropa';
import {
  aplicaOrdem,
  mesmaOrdem,
  moveUmaCasa,
  novaOrdem,
  ordemJaChegou,
} from '@/lib/ordem-arrastada';
import { TIPO_ARRASTO } from './arrasto-da-tropa';
import { BlocoDaVps } from './bloco-da-vps';
import { estadoDe } from './estado';
import { CartaoVivo, LinhaDormindo, type EscolheAgente } from './linha-da-tropa';

export type { EscolheAgente };

export function Tropa({
  agents,
  slugSelecionado,
  agora,
  compacta = false,
  aoEscolher,
}: {
  agents: Agent[];
  slugSelecionado?: string;
  agora: number;
  /** `true` na coluna de navegação do desktop (260px), `false` na rota `/` do
   *  celular, que é tela cheia. Não é o mesmo layout em duas larguras — são dois
   *  layouts, e fingir o contrário foi o que cortou nome e modelo. */
  compacta?: boolean;
  aoEscolher?: EscolheAgente;
}) {
  // A posição carrega identidade, não estado (11/08): nenhum flip
  // trabalhando↔ocioso move linha nenhuma — a "dança" que o Rica reprovou.
  // Desde 17/08 a sequência vem do banco quando ele já arrastou; a lista ditada
  // em `lib/ordena-tropa.ts` virou a ordem de fábrica.
  const doServidor = useMemo(() => ordenaTropa(agents), [agents]);

  // A ordem que a tela mostra enquanto o servidor não confirma. O `/api/fleet`
  // só é relido no poll seguinte (5s), e sem isto a linha voltaria pro lugar
  // antigo assim que o dedo saísse da tela.
  const [ordemOtimista, setOrdemOtimista] = useState<string[] | null>(null);

  // Mover pela seta não muda nada que um leitor de tela perceba sozinho: o
  // foco fica no mesmo botão, com o mesmo rótulo, e a lista se reordena em
  // silêncio. A região viva é o que transforma o movimento em confirmação —
  // mesmo par `role="status"` + `aria-live` que o resto do shell já usa.
  const [recadoDoMovimento, setRecadoDoMovimento] = useState('');
  const agentesOrdenados = useMemo(
    () => aplicaOrdem(doServidor, ordemOtimista),
    [doServidor, ordemOtimista],
  );

  // Chegou a confirmação: a ordem otimista cumpriu o papel e sai de cena. Sem
  // isto ela seguiria mandando e a coluna pararia de refletir o banco.
  useEffect(() => {
    if (ordemJaChegou(doServidor, ordemOtimista)) setOrdemOtimista(null);
  }, [doServidor, ordemOtimista]);

  // Segurar a seta dispara uma tecla a cada ~30ms, e cada uma virava um PATCH
  // solto. Nada garantia que o último a sair fosse o último a gravar: bastava
  // uma resposta antiga vencer pro banco ficar com ordem mais velha que a tela,
  // sem se corrigir sozinho. A sequência descarta o que já foi ultrapassado —
  // é a mesma proteção que a LEITURA já tem em `usa-frota-ao-vivo.ts`.
  const sequenciaDaGravacao = useRef(0);

  // O deslize depois do arrasto (`lib/desliza-tropa.ts`). A foto sai do DOM
  // ANTES da ordem otimista: é a única hora em que as linhas ainda estão no
  // lugar velho. `ul.children[i]` é a linha de `agentesOrdenados[i]` — cada
  // item da lista é um `<li>` com `key` pelo slug, e o React move o nó junto.
  const listaRef = useRef<HTMLUListElement | null>(null);
  const ordemNaTela = useRef<string[]>([]);
  const fotoDoDeslize = useRef<{ topos: Map<string, number>; soltada: string | null } | null>(null);

  const gravaOrdem = useCallback((nova: string[], soltada: string | null) => {
    const ul = listaRef.current;
    if (ul && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const topos = new Map<string, number>();
      ordemNaTela.current.forEach((slug, i) => {
        const li = ul.children[i];
        if (li) topos.set(slug, li.getBoundingClientRect().top);
      });
      fotoDoDeslize.current = { topos, soltada };
    }
    setOrdemOtimista(nova);
    const minhaVez = ++sequenciaDaGravacao.current;
    patchOrdemDaTropa(nova).catch(() => {
      // Falhou a gravação: devolve a ordem do servidor em vez de deixar a tela
      // mentindo uma posição que o banco não tem. Só que a requisição vencida
      // não manda mais em nada — limpar aqui apagaria a ordem de um PATCH
      // POSTERIOR que ainda está no ar.
      if (minhaVez === sequenciaDaGravacao.current) setOrdemOtimista(null);
    });
  }, []);

  // Pintou a ordem nova: cada linha que andou volta ao lugar velho por
  // `transform`, sem transição, e no quadro seguinte desliza até zero. Efeito
  // de LAYOUT, antes da pintura — num efeito comum o Rica veria um quadro com
  // tudo já no lugar novo, e o deslize viraria o salto duplo.
  useLayoutEffect(() => {
    ordemNaTela.current = agentesOrdenados.map((a) => a.slug);
    const foto = fotoDoDeslize.current;
    const ul = listaRef.current;
    if (!foto || !ul) return;
    fotoDoDeslize.current = null;
    const linhas = new Map<string, HTMLElement>();
    const depois = new Map<string, number>();
    agentesOrdenados.forEach((a, i) => {
      const li = ul.children[i] as HTMLElement | undefined;
      if (!li) return;
      linhas.set(a.slug, li);
      depois.set(a.slug, li.getBoundingClientRect().top);
    });
    const andaram = deslizes(foto.topos, depois, foto.soltada);
    for (const { slug, dy } of andaram) {
      const li = linhas.get(slug)!;
      li.style.transition = 'none';
      li.style.transform = `translateY(${dy}px)`;
    }
    if (andaram.length === 0) return;
    // Lê o layout para o navegador assentar o ponto de partida antes da
    // transição — sem isto ele junta as duas escritas e não anima nada.
    void ul.offsetHeight;
    // A linha soltada fica POR CIMA enquanto as outras deslizam. As `li` são
    // transparentes e quem ganha `transform` sobe de camada: sem isto a linha
    // que desce passa pintada por cima da que o dedo acabou de soltar. O fundo
    // opaco é o da faixa — a linha soltada tapa a que atravessa por baixo dela.
    // `position: relative` sem deslocamento só existe para o `z-index` valer.
    const solta = foto.soltada ? linhas.get(foto.soltada) : undefined;
    let faltam = andaram.length;
    let seguranca = 0;
    const desce = () => {
      if (!solta) return;
      window.clearTimeout(seguranca);
      solta.style.position = '';
      solta.style.zIndex = '';
      solta.style.background = '';
    };
    if (solta) {
      solta.style.position = 'relative';
      solta.style.zIndex = '1';
      solta.style.background = 'var(--ck-surface-nav)';
      // Rede para o `transitionend` que não vem — aba escondida no meio do
      // deslize, linha desmontada pelo poll. O deslize dura 320ms; o dobro basta.
      seguranca = window.setTimeout(desce, 640);
    }
    for (const { slug } of andaram) {
      const li = linhas.get(slug)!;
      li.style.transition = 'transform var(--ck-dur-calm, 320ms) var(--ck-ease)';
      li.style.transform = '';
      const limpa = (evento: TransitionEvent) => {
        if (evento.target !== li || evento.propertyName !== 'transform') return;
        li.style.transition = '';
        li.removeEventListener('transitionend', limpa);
        faltam -= 1;
        if (faltam === 0) desce();
      };
      li.addEventListener('transitionend', limpa);
    }
  }, [agentesOrdenados]);

  const move = useCallback(
    (slug: string, direcao: -1 | 1) => {
      const slugs = agentesOrdenados.map((a) => a.slug);
      const movida = moveUmaCasa(slugs, slug, direcao);
      if (movida === slugs) return;
      gravaOrdem(movida, null);
      const posicao = movida.indexOf(slug) + 1;
      setRecadoDoMovimento(
        `${agentesOrdenados.find((a) => a.slug === slug)?.name ?? slug}, posição ${posicao} de ${movida.length}`,
      );
    },
    [agentesOrdenados, gravaOrdem],
  );

  // Um monitor pra lista inteira, não um por linha: quem sabe a ordem completa
  // é a lista, e o alvo de soltura só sabe de si mesmo.
  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => source.data.tipo === TIPO_ARRASTO,
        onDrop: ({ source, location }) => {
          const alvo = location.current.dropTargets[0];
          if (!alvo) return;
          const slugs = agentesOrdenados.map((a) => a.slug);
          const reordenada = novaOrdem(
            slugs,
            String(source.data.slug),
            String(alvo.data.slug),
            extractClosestEdge(alvo.data) as 'top' | 'bottom' | null,
          );
          // Soltou onde já estava: não gasta requisição nem pisca a lista.
          // Compara CONTEÚDO, não referência — soltar na borda de cima do
          // vizinho de baixo devolve a mesma sequência num array novo, e a
          // comparação por referência deixava esse caso passar batido.
          if (mesmaOrdem(reordenada, slugs)) return;
          gravaOrdem(reordenada, String(source.data.slug));
        },
      }),
    [agentesOrdenados, gravaOrdem],
  );

  // Frota vazia: o backend responde, só não há ninguém. Diferente de erro, e a
  // tela precisa dizer qual dos dois é — lista vazia e sem palavra nenhuma lê
  // como falha de carregamento.
  if (agents.length === 0) {
    return (
      <nav
        aria-label="Tropa"
        className="flex flex-col justify-center"
        style={{ gap: 'var(--ck-space-1)', padding: 'var(--ck-space-5) var(--ck-space-4)' }}
      >
        <p style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-primary)' }}>
          Nenhum agente na frota
        </p>
        <p style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
          O cockpit respondeu, mas não há sessão registrada.
        </p>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Tropa"
      // `flex-1`: a nav enche a faixa pra que o bloco da VPS, com `margin-top:
      // auto`, pouse no pé da coluna quando a lista é curta — e role junto com
      // ela quando não é. Na rota `/` o pai não tem altura fixa e o `flex-1`
      // não muda nada.
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      style={{ padding: '0 var(--ck-space-2) var(--ck-space-4)' }}
    >
      {/* Só quem move pela seta enche isto — o arrasto por ponteiro já se
          explica na tela. Fora da vista, mas na árvore de acessibilidade: a
          região precisa existir ANTES do recado pra que o leitor de tela a
          observe; criada junto com o texto, ela costuma não ser anunciada. */}
      <span role="status" aria-live="polite" className="sr-only">
        {recadoDoMovimento}
      </span>

      {/* Lista única, ordem ditada (11/08). O overline "Tropa" não
          existe desde a v3 e os títulos de estado morreram na v5 — a lista é a
          lista. A escolha de cartão ou linha rasa é POR LINHA, pelo estado
          resolvido (`estadoDe`): status desconhecido dorme como o offline, como
          a v3 já fazia. */}
      <ul ref={listaRef}>
        {agentesOrdenados.map((a) =>
          estadoDe(a.status).ordem === 3 ? (
            <LinhaDormindo
              key={a.slug}
              agente={a}
              selecionado={a.slug === slugSelecionado}
              compacta={compacta}
              aoEscolher={aoEscolher}
              aoMover={(direcao) => move(a.slug, direcao)}
            />
          ) : (
            <CartaoVivo
              key={a.slug}
              agente={a}
              selecionado={a.slug === slugSelecionado}
              agora={agora}
              compacta={compacta}
              aoEscolher={aoEscolher}
              aoMover={(direcao) => move(a.slug, direcao)}
            />
          ),
        )}
      </ul>

      {/* Ordem do Rica (07/09): o consumo da máquina na sidebar. Rodapé, e
          não cabeçalho: a tropa é o que ele abre pra ver; a máquina é o que
          ele confere de relance. */}
      <BlocoDaVps />
    </nav>
  );
}
