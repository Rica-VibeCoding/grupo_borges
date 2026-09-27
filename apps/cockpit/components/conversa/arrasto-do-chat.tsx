'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { usaNavegacaoDaTropa } from '@/components/shell/superficie-otimista';

import { gestoDoChat, origemImpedeArrasto, type NoDaOrigem, type Ponto } from './gesto-de-arrasto';

const rolagemDeLado = (no: NoDaOrigem) => (no instanceof Element ? getComputedStyle(no).overflowX : 'visible');

/** Acima do `md` a tropa é fundo permanente (o `≡` some): não há gaveta para abrir. */
const DESKTOP = '(min-width: 48rem)';

/**
 * No chat, arrastar para a esquerda abre a conversa por voz do mesmo agente e arrastar para
 * a direita abre a tropa — o destino do `≡`, pelo mesmo caminho otimista dele. O chat rola,
 * então o dedo é do navegador: aqui só se escuta (Touch Events passivos, que seguem chegando
 * durante a rolagem) e se decide ao soltar. Não conta o que começou no composer, em gaveta
 * aberta, no que rola de lado nem com texto selecionado.
 */
export function ArrastoDoChat({ slug }: { slug: string }) {
  const router = useRouter();
  const tropa = usaNavegacaoDaTropa();
  const tropaRef = useRef(tropa);
  tropaRef.current = tropa;

  useEffect(() => {
    let inicio: Ponto | null = null;

    const comeca = (evento: TouchEvent) => {
      inicio = null;
      if (evento.touches.length !== 1) return;
      if (document.querySelector('[data-aberto="true"]') !== null) return;
      const origem = evento.target instanceof Element ? evento.target : null;
      if (origemImpedeArrasto(origem, rolagemDeLado)) return;
      const dedo = evento.touches[0];
      inicio = { x: dedo.clientX, y: dedo.clientY };
    };
    const move = (evento: TouchEvent) => {
      if (evento.touches.length > 1) inicio = null;
    };
    const cancela = () => {
      inicio = null;
    };
    const termina = (evento: TouchEvent) => {
      const de = inicio;
      inicio = null;
      if (de === null || evento.touches.length > 0) return;
      const dedo = evento.changedTouches[0];
      const gesto = gestoDoChat(de, { x: dedo.clientX, y: dedo.clientY }, window.innerWidth);
      if (gesto === 'nada' || window.getSelection()?.isCollapsed === false) return;
      if (gesto === 'conversa') {
        router.push(`/conversa/${slug}`);
        return;
      }
      if (window.matchMedia(DESKTOP).matches) return;
      const abrir = `/agente/${slug}?nav=aberto`;
      if (tropaRef.current) tropaRef.current.ir(abrir, true);
      else router.push(abrir);
    };

    // No Chrome, o arrasto lateral que passa do fim da rolagem é o "voltar" do histórico —
    // seriam dois destinos para um gesto só. O Safari só volta pela borda; lá não muda nada.
    const raiz = document.documentElement;
    const antes = raiz.style.overscrollBehaviorX;
    raiz.style.overscrollBehaviorX = 'none';
    const passivo = { passive: true } as const;
    document.addEventListener('touchstart', comeca, passivo);
    document.addEventListener('touchmove', move, passivo);
    document.addEventListener('touchend', termina, passivo);
    document.addEventListener('touchcancel', cancela, passivo);
    return () => {
      raiz.style.overscrollBehaviorX = antes;
      document.removeEventListener('touchstart', comeca);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', termina);
      document.removeEventListener('touchcancel', cancela);
    };
  }, [router, slug]);

  return null;
}
