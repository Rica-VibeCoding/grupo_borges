'use client';

import { useEffect } from 'react';

import { alturaDoViewport } from './altura-do-viewport';

function modoAplicativoInstalado(): boolean {
  const navegador = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches || navegador.standalone === true
  );
}

function campoEmFoco(): boolean {
  const ativo = document.activeElement;
  return (
    ativo instanceof HTMLInputElement ||
    ativo instanceof HTMLTextAreaElement ||
    ativo?.getAttribute('contenteditable') === 'true'
  );
}

export function SincronizaAlturaDoViewport() {
  useEffect(() => {
    const visualViewport = window.visualViewport;
    const modoAplicativo = modoAplicativoInstalado();

    const publicaAltura = () => {
      const altura = alturaDoViewport({
        alturaVisual: visualViewport?.height,
        alturaDaJanela: window.innerHeight,
        modoAplicativo,
        tecladoAberto: campoEmFoco(),
      });
      if (altura > 0) {
        document.documentElement.style.setProperty('--ck-viewport-altura', `${altura}px`);
      }
    };

    publicaAltura();
    const frame = window.requestAnimationFrame(publicaAltura);
    visualViewport?.addEventListener('resize', publicaAltura);
    window.addEventListener('resize', publicaAltura);
    window.addEventListener('orientationchange', publicaAltura);
    window.addEventListener('focusin', publicaAltura);
    window.addEventListener('focusout', publicaAltura);

    return () => {
      window.cancelAnimationFrame(frame);
      visualViewport?.removeEventListener('resize', publicaAltura);
      window.removeEventListener('resize', publicaAltura);
      window.removeEventListener('orientationchange', publicaAltura);
      window.removeEventListener('focusin', publicaAltura);
      window.removeEventListener('focusout', publicaAltura);
    };
  }, []);

  return null;
}
