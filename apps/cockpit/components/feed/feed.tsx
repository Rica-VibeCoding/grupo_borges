'use client';

// O feed do cockpit v2 — o esqueleto do G1 promovido a produto.
//
// Sem assistant-ui: o G1 mediu 33,4 ms sem a biblioteca contra 400–724,9 com
// ela, e a escala caiu de 1,81× para 1,00×. O que ficou dela foi o
// virtualizador (`@tanstack/react-virtual`), que nunca foi dela.
//
// Duas mudanças de fundo em relação ao esqueleto, e as duas são o G3:
//   1. `estimateSize` é CONSTANTE — nem a média móvel do esqueleto (que
//      deslocava tudo o que ainda não fora medido, por fora da compensação do
//      virtualizador), nem a função por item que a substituiu. Ver ALTURA_ITEM
//      (`medidas-do-feed.ts`).
//   2. quando o Rica está rolado para cima, o que se preserva é o ITEM sob o
//      olho dele, não o `scrollTop` (ver `ancora.ts`).

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { ScrollArea } from '@/components/ui/scroll-area';

import { capturaAncora, estaColado, longeDoFim, scrollTopParaAncora, type Ancora, type Faixa } from './ancora';
import { BotaoVoltaAoFim } from './botao-volta-ao-fim';
import { chaveDe } from './chave';
import { CorpoDoItem } from './corpo-do-item';
import { soPassoEmVoo } from './execucao-do-item';
import { indiceDoGrupoEmCurso, type ItemDoFeed } from './grupo-ferramentas.ts';
import { ALTURA_ITEM, SOBRA } from './medidas-do-feed';
import { useChegadas } from './use-chegadas';
import { useSeguirOFim } from './use-seguir-o-fim';

export type FeedProps = {
  itens: readonly ItemDoFeed[];
  lookup?: ToolResultLookup;
  /** O cartão do `/compact` lê a duração medida na máquina do agente — sem
   *  slug ele nasce estático (teste). */
  agentSlug?: string;
  estaRodando?: boolean;
  /** A linha do agora (`linha-do-agora.tsx`) — fora da lista virtualizada,
   *  para a esfera não reiniciar o giro a cada rolagem. */
  rodape?: ReactNode;
};

function Feed({ itens, lookup, agentSlug, estaRodando = false, rodape }: FeedProps) {
  const chaves = useMemo(() => itens.map(chaveDe), [itens]);
  const ultimoTextoDoAssistente = useMemo(() => {
    for (let indice = itens.length - 1; indice >= 0; indice--) {
      const item = itens[indice];
      if (item?.kind === 'assistant' && item.parts.some((parte) => parte.type === 'text' && /\S/.test(parte.text))) {
        return indice;
      }
    }
    return -1;
  }, [itens]);

  // O grupo no fim do feed com a corrida de pé segue girando entre um passo e
  // o próximo; o anel só fecha quando vem fala depois ou a corrida para.
  const grupoEmCurso = useMemo(() => indiceDoGrupoEmCurso(itens), [itens]);

  const { chegadas, agoraMs } = useChegadas(itens, chaves, lookup);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const coladoRef = useRef(true);
  const ancoraRef = useRef<Ancora | null>(null);
  const contagemRef = useRef(0);
  const [temNovas, setTemNovas] = useState(false);
  // Facelift do texto, 17/08: o "voltar ao fim" não depende mais de mensagem
  // nova — longe do fim (além de 1 viewport, `longeDoFim`) a setinha aparece
  // mesmo com o feed parado, como na referência do ChatGPT.
  const [longe, setLonge] = useState(false);

  // Colado no fim, o que chega sobe numa mola em vez de saltar (`use-seguir-o-fim.ts`).
  const { seguidor, seguirOFim, maos } = useSeguirOFim(scrollerRef, coladoRef);

  // A doc pede `getItemKey` memoizado ("to avoid unnecessary recalculations"),
  // e o motivo está em virtual-core 3.17.7: ele é dependência do memo de
  // `getMeasurementOptions`, e uma arrow nova a cada render força a varredura
  // completa das medições. Ler as chaves por ref mantém a identidade fixa para
  // sempre, sem prender a função à lista.
  //
  // Ressalva honesta: durante streaming isso NÃO economiza nada, porque `count`
  // também é dependência e cresce a cada flush. O ganho é quando o Rica só rola
  // e nada chega — que é a maior parte do tempo dele olhando a tela.
  const chavesRef = useRef(chaves);
  chavesRef.current = chaves;
  const chaveDoItem = useCallback((indice: number) => chavesRef.current[indice] ?? indice, []);

  const virtualizer = useVirtualizer({
    count: itens.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ALTURA_ITEM,
    overscan: SOBRA,
    getItemKey: chaveDoItem,
    // O ajuste de scroll de quem chega colado no fim mede dentro do commit; com flushSync o React 19 acusa erro.
    useFlushSync: false,
  });

  const virtuais = virtualizer.getVirtualItems();

  const faixas = useCallback(
    (): Faixa[] =>
      virtualizer
        .getVirtualItems()
        .map((virtual) => ({ chave: String(virtual.key), start: virtual.start, end: virtual.end })),
    [virtualizer],
  );

  const aoRolar = useCallback(() => {
    const elemento = scrollerRef.current;
    if (!elemento) return;
    // A subida da mola, lida como rolagem, descolaria o feed no meio dela.
    if (seguidor.eco(elemento.scrollTop)) return;
    const metrica = {
      scrollTop: elemento.scrollTop,
      scrollHeight: elemento.scrollHeight,
      clientHeight: elemento.clientHeight,
    };
    const colado = estaColado(metrica);
    coladoRef.current = colado;
    if (colado) {
      ancoraRef.current = null;
      setTemNovas(false);
      setLonge(false);
      return;
    }
    setLonge(longeDoFim(metrica));
    // Re-capturar a cada rolagem é de propósito: a âncora tem de ser o item que
    // o olho está usando AGORA, não o de quando ele saiu do fim.
    ancoraRef.current = capturaAncora(faixas(), elemento.scrollTop);
  }, [faixas, seguidor]);

  const irAoFim = useCallback(() => {
    const elemento = scrollerRef.current;
    if (!elemento) return;
    seguidor.para();
    coladoRef.current = true;
    ancoraRef.current = null;
    setTemNovas(false);
    setLonge(false);
    elemento.scrollTop = elemento.scrollHeight;
  }, [seguidor]);

  // Sem lista de dependências, de propósito: roda em TODO commit. O caso que
  // reprovou no iPhone é o texto do último item crescendo por streaming, que
  // não mexe em `itens.length` — um efeito preso ao tamanho da lista não vê
  // essa mudança e o feed descola sozinho.
  useLayoutEffect(() => {
    const elemento = scrollerRef.current;
    if (!elemento || itens.length === 0) return;

    if (itens.length > contagemRef.current && !coladoRef.current) setTemNovas(true);
    contagemRef.current = itens.length;

    if (coladoRef.current) {
      seguirOFim();
      return;
    }
    const ancora = ancoraRef.current;
    if (!ancora) return;
    const alvo = scrollTopParaAncora(ancora, faixas(), elemento.scrollTop);
    if (alvo !== null) elemento.scrollTop = alvo;
  });

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }} {...maos}>
      {/* ScrollArea do shadcn (Radix) — 03/08, ordem do Rica: a barra sai da
          borda da COLUNA e vai para a borda da TELA. Quem rola é o viewport do
          Radix (`viewportRef`), que é onde o virtualizador, o `onScroll` e o
          `data-gate-messages` ficam pendurados. `type="always"`: a barra não
          se esconde, mas é um fio quase apagado (a cor mora no globals.css,
          `--ck-scrollbar-thumb`). Sendo overlay, ela não paga largura: nada no
          layout desloca quando ela aparece — e a gaveta, que é `fixed`, nem
          sente. */}
      <ScrollArea
        type="always"
        style={{ height: '100%' }}
        viewportRef={scrollerRef}
        viewportProps={{
          // Espalhado, não literal: o TS barra `data-*` em props de componente
          // tipadas, mas o Radix repassa ao div do viewport — e os gates de
          // teste procuram o atributo lá.
          ...{ 'data-gate-messages': '' },
          onScroll: aoRolar,
          style: {
            // O ancoramento nativo do browser não enxerga itens em `position:
            // absolute` — quem ancora aqui é `ancora.ts`, e os dois brigando
            // produzem exatamente o tranco que estamos removendo.
            overflowAnchor: 'none',
            // O respiro do composer flutuante (08/08). O padding vai no ELEMENTO
            // QUE ROLA, não num wrapper de fora: fora, ele encolheria o feed e a
            // rolagem terminaria acima do composer — que é justamente o oposto
            // do pedido, porque não sobraria conteúdo passando por baixo para
            // desfocar. Aqui ele só estica o fim do conteúdo rolável, e "ir ao
            // fim" passa a parar com a última mensagem logo acima do composer.
            // Quem mede e publica a variável é `app/agente/[slug]/palco-da-conversa.tsx`;
            // o piso de `0px` mantém esta rota igual onde o palco não existe.
            paddingBottom: 'var(--ck-composer-altura, 0px)',
          },
        }}
      >
        {/* A coluna de leitura desceu pra DENTRO da rolagem: é ela que segura
            o `max-width` e centraliza, então o trilho da barra pode encostar
            na borda da tela sem arrastar o texto junto.

            O padding horizontal MOROU AQUI e não fazia nada — 08/08. Os itens
            virtualizados são `position: absolute` e este trilho é o ancestral
            posicionado deles, então o containing block é o PADDING BOX: `left:
            0` cola na borda de fora do padding e `width: 100%` mede a caixa
            inteira. Resultado medido na produção, viewport de 390: mensagens
            de 0 a 390, caixa do composer de 16 a 374. O Rica viu de olho —
            *"o nosso tá rente à borda do aplicativo… o certo era alinhar os
            textos com a caixa de texto"*. O recuo foi para o item, onde os
            absolutos não conseguem ignorá-lo. */}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            width: '100%',
            maxWidth: 'var(--ck-read-wide)',
            margin: '0 auto',
            boxSizing: 'border-box',
          }}
        >
          {virtuais.map((virtual) => {
            const item = itens[virtual.index];
            const chave = String(virtual.key);
            const chega = chegadas.chegando(chave, agoraMs);
            // Só o passo em voo, que mora na linha do agora: o envelope fica
            // sem padding (altura 0) em vez de o item sair da lista — filtrar
            // mexeria em índice, contagem e chegada, e o item nasceria de novo
            // ao terminar. Aqui a chave e a montagem seguem as mesmas.
            const oco = item ? soPassoEmVoo(item, lookup) : false;
            return (
              <div
                key={virtual.key}
                data-gate-message=""
                data-index={virtual.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtual.start}px)`,
                }}
              >
                {/* O gesto de chegada mora AQUI, na div de dentro: o envelope
                    carrega o `translateY` do virtualizador, e um `transform`
                    de animação nele apagaria a posição do item. */}
                <div
                  className={chega ? 'ck-chega' : undefined}
                  onAnimationEnd={
                    chega
                      ? (evento) => {
                          // `animationend` borbulha: a animação de um filho
                          // (ferramenta abrindo, pulso) não encerra a chegada.
                          if (evento.target === evento.currentTarget) chegadas.terminou(chave);
                        }
                      : undefined
                  }
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--ck-space-1)',
                    // O recuo lateral é `--ck-space-4` porque é o MESMO do
                    // wrapper do composer: é o que põe a primeira letra do
                    // feed na mesma vertical da borda da caixa de escrever.
                    // Mudou um, muda o outro.
                    padding: oco ? 0 : 'var(--ck-space-2) var(--ck-space-4)',
                    // Borda de conteúdo gigante: uma linha de 200 mil caracteres
                    // sem espaço estoura a largura e leva a rolagem horizontal
                    // junto. Os renderers truncam a ALTURA; a largura é daqui.
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {item ? <CorpoDoItem item={item} lookup={lookup} agentSlug={agentSlug} estaRodando={estaRodando && (virtual.index === ultimoTextoDoAssistente || virtual.index === grupoEmCurso)} /> : null}
                </div>
              </div>
            );
          })}
        </div>
        {rodape ? (
          <div style={{ width: '100%', maxWidth: 'var(--ck-read-wide)', margin: '0 auto' }}>{rodape}</div>
        ) : null}
      </ScrollArea>

      <BotaoVoltaAoFim temNovas={temNovas} longe={longe} onIrAoFim={irAoFim} />
    </div>
  );
}

// Quem monta o feed re-renderiza por coisa que não é dele (compact, eco,
// linha viva). Com os mesmos props, o feed não tem o que redesenhar.
const FeedMemo = memo(Feed);
export { FeedMemo as Feed };
