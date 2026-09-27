'use client';

import { useEffect, useRef, type RefObject } from 'react';

import {
  decideSemMovimento,
  decideSoltura,
  limitaAvanco,
  travaEixo,
  velocidadeFinal,
  type Amostra,
  type Soltura,
} from './deslize';
import { origemImpedeArrasto, type NoDaOrigem, type Ponto } from './gesto-de-arrasto';
import { acompanha, assenta, devolve } from './mola';
import { urlComTropa } from './rota-do-pager';
import { useMovimentoReduzido } from './use-movimento-reduzido';

const rolagemDeLado = (no: NoDaOrigem) => (no instanceof Element ? getComputedStyle(no).overflowX : 'visible');

/** Acima do `md` a tropa é fundo permanente (o `≡` some): não há gaveta para abrir. */
const DESKTOP = '(min-width: 48rem)';

/** O que a gaveta fechada esconde e o arrasto mostra; devolvido ao CSS quando assenta. */
const VISIVEL = ['visibility', 'opacity'] as const;

const CAMPO = 'input, textarea, select, [contenteditable="true"]';

type Sentido = 'abre' | 'fecha';
type Arrasto = {
  inicio: Ponto;
  amostras: Amostra[];
  sentido: Sentido;
  travado: boolean;
  gaveta: HTMLElement;
  largura: number;
  avanco: number;
  /** Anda com o dedo? Só não com movimento reduzido. */
  anima: boolean;
};

/**
 * Abre ou fecha a tropa trocando só o `?nav=aberto`: é a URL que a gaveta lê — o mesmo estado
 * otimista do `≡` —, e o `replaceState` não cria entrada no histórico nem pede nada ao
 * servidor. Gesto não empilha tela (adendo do Rica, 27/09).
 */
function marcaTropa(aberta: boolean) {
  window.history.replaceState(null, '', urlComTropa(window.location.pathname, window.location.search, aberta));
}

/**
 * A tropa pelo dedo, no celular: no chat, com o pager no começo, arrastar para a direita abre
 * a gaveta; com ela aberta, arrastar para a esquerda fecha e deixa no chat. A gaveta anda com o
 * dedo e assenta com a mola da folha de configurações (`deslize.ts`).
 *
 * A disputa com o pager não existe: no começo dele a direita não tem dono nativo (o pager não
 * anda antes do chat e o `overscroll-behavior-x: none` tira a mola da ponta), e a esquerda é
 * sempre dele — aqui ela só vale com a tropa aberta, quando o dedo está na gaveta ou no véu, fora
 * do pager. O eixo trava nos primeiros pixels: vertical é a rolagem do chat e da tropa.
 *
 * Os ouvintes são passivos, de propósito: nenhum `touchmove` bloqueante fica na frente da
 * rolagem do pager, que é o gesto principal. Não conta o que começou num campo; para abrir,
 * também não o que começou no composer, em gaveta ou folha, no que rola de lado nem com texto
 * selecionado.
 */
export function ArrastoDoChat({
  pagerRef,
  chatRef,
}: {
  pagerRef: RefObject<HTMLElement | null>;
  chatRef: RefObject<HTMLElement | null>;
}) {
  const reduzido = useMovimentoReduzido();
  const reduzidoRef = useRef(reduzido);
  reduzidoRef.current = reduzido;

  useEffect(() => {
    let arrasto: Arrasto | null = null;
    let quadro = 0;

    const pinta = () => {
      quadro = 0;
      const a = arrasto;
      if (a === null || !a.anima) return;
      acompanha(a.gaveta, a.sentido === 'abre' ? a.avanco - a.largura : -a.avanco);
    };
    const agenda = () => {
      if (quadro === 0) quadro = requestAnimationFrame(pinta);
    };

    const comeca = (evento: TouchEvent) => {
      arrasto = null;
      if (evento.touches.length !== 1 || window.matchMedia(DESKTOP).matches) return;
      const gaveta = document.querySelector<HTMLElement>('aside.ck-surge-lado');
      const origem = evento.target instanceof Element ? evento.target : null;
      if (gaveta === null || origem === null || origem.closest(CAMPO) !== null) return;
      let sentido: Sentido = 'fecha';
      if (gaveta.dataset.aberto !== 'true') {
        const pager = pagerRef.current;
        if (!pager || !chatRef.current?.contains(origem) || pager.scrollLeft > 1) return;
        if (document.querySelector('[data-aberto="true"]') !== null) return;
        // O pager rola de lado, mas é ele que está no começo: só o que rola de lado dentro do chat
        // (bloco de código, tabela) fica com o dedo.
        if (origemImpedeArrasto(origem, (no) => (no === pager ? 'visible' : rolagemDeLado(no)))) return;
        sentido = 'abre';
      }
      const dedo = evento.touches[0];
      arrasto = {
        inicio: { x: dedo.clientX, y: dedo.clientY },
        amostras: [{ t: evento.timeStamp, x: dedo.clientX }],
        sentido,
        travado: false,
        gaveta,
        largura: gaveta.offsetWidth,
        avanco: 0,
        anima: false,
      };
    };

    const trava = (a: Arrasto) => {
      a.travado = true;
      a.anima = !reduzidoRef.current;
      if (!a.anima) return;
      // No lugar de partida ANTES de aparecer: a gaveta fechada mora a 8 px do lugar, e um
      // quadro visível lá seria a tropa inteira piscando.
      acompanha(a.gaveta, a.sentido === 'abre' ? -a.largura : 0);
      a.gaveta.style.visibility = 'visible';
      a.gaveta.style.opacity = '1';
    };

    const move = (evento: TouchEvent) => {
      const a = arrasto;
      if (a === null) return;
      if (evento.touches.length > 1) {
        solta(a, 'volta');
        return;
      }
      const dedo = evento.touches[0];
      a.amostras.push({ t: evento.timeStamp, x: dedo.clientX });
      if (a.amostras.length > 12) a.amostras.shift();
      const dx = dedo.clientX - a.inicio.x;
      if (!a.travado) {
        const eixo = travaEixo(a.inicio, { x: dedo.clientX, y: dedo.clientY });
        if (eixo === null) return;
        const noRumo = a.sentido === 'abre' ? dx > 0 : dx < 0;
        // Vertical é rolagem; de lado no outro rumo é do pager.
        if (eixo === 'vertical' || !noRumo || window.getSelection()?.isCollapsed === false) {
          arrasto = null;
          return;
        }
        trava(a);
      }
      a.avanco = limitaAvanco(a.sentido === 'abre' ? dx : -dx, a.largura);
      agenda();
    };

    const termina = (evento: TouchEvent) => {
      const a = arrasto;
      if (a === null || evento.touches.length > 0) return;
      if (!a.travado) {
        arrasto = null;
        return;
      }
      const dedo = evento.changedTouches[0];
      a.amostras.push({ t: evento.timeStamp, x: dedo.clientX });
      const rumo = a.sentido === 'abre' ? 1 : -1;
      a.avanco = limitaAvanco(rumo * (dedo.clientX - a.inicio.x), a.largura);
      const velocidade = rumo * velocidadeFinal(a.amostras);
      solta(a, a.anima ? decideSoltura(a.avanco, a.largura, velocidade) : decideSemMovimento(a.avanco));
    };

    const cancela = () => {
      if (arrasto?.travado) solta(arrasto, 'volta');
      arrasto = null;
    };

    const solta = (a: Arrasto, decisao: Soltura) => {
      arrasto = null;
      if (quadro !== 0) cancelAnimationFrame(quadro);
      quadro = 0;
      const abre = a.sentido === 'abre';
      if (decisao === 'vai') marcaTropa(abre);
      if (!a.anima) return;
      // A mola termina o movimento; o CSS reassume onde ela deixou, já com o `data-aberto` novo.
      const terminaAberta = abre === (decisao === 'vai');
      const gaveta = a.gaveta;
      assenta(gaveta, terminaAberta ? 0 : -a.largura, () => devolve(gaveta, VISIVEL));
    };

    const passivo = { passive: true } as const;
    document.addEventListener('touchstart', comeca, passivo);
    document.addEventListener('touchmove', move, passivo);
    document.addEventListener('touchend', termina, passivo);
    document.addEventListener('touchcancel', cancela, passivo);
    return () => {
      if (quadro !== 0) cancelAnimationFrame(quadro);
      document.removeEventListener('touchstart', comeca);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', termina);
      document.removeEventListener('touchcancel', cancela);
    };
  }, [chatRef, pagerRef]);

  return null;
}
