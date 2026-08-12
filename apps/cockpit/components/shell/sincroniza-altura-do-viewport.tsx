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
    // No navegador a altura certa é o `100dvh` do CSS, e ele é o único que a
    // mantém certa sozinha: a barra do Safari cresce e encolhe sem disparar
    // `resize` confiável, então qualquer número medido aqui envelhece calado.
    // A app fica mais alta que a área visível, o documento ganha rolagem, e o
    // Safari usa essa rolagem para abrir espaço ao teclado — levando o composer
    // junto para fora da tela. É o que o Rica via ao voltar de outro agente,
    // sem que nada tivesse remontado: só o número era velho.
    if (!modoAplicativoInstalado()) return;

    const visualViewport = window.visualViewport;

    const publicaAltura = () => {
      const altura = alturaDoViewport({
        alturaVisual: visualViewport?.height,
        alturaDaJanela: window.innerHeight,
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
