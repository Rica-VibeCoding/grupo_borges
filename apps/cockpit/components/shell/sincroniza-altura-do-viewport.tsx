'use client';

import { useEffect } from 'react';

import { alturaDoViewport } from './altura-do-viewport';

function modoAplicativoInstalado(): boolean {
  const navegador = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches || navegador.standalone === true
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

    // No aplicativo instalado a janela responde ao teclado sozinha — medido no
    // iPhone do Rica: 852 fechado, 655 aberto. O `visualViewport` continua
    // escutado porque é ele quem avisa primeiro que o teclado se mexeu.
    const visualViewport = window.visualViewport;

    const publicaAltura = () => {
      const altura = alturaDoViewport({ alturaDaJanela: window.innerHeight });
      if (altura > 0) {
        document.documentElement.style.setProperty('--ck-viewport-altura', `${altura}px`);
      }
    };

    publicaAltura();
    const frame = window.requestAnimationFrame(publicaAltura);

    // A janela do aplicativo termina de abrir DEPOIS da primeira medida e não
    // avisa: medido no iPhone do Rica em 12/08, a app nasce com 793 numa tela
    // de 852 e o composer fica 59px acima do lugar até ele puxar a tela com o
    // dedo — o gesto é que dispara o evento que ninguém mandou. Como o `html`
    // tem `height: 100%`, o elemento raiz acompanha o viewport, e observá-lo
    // pega a expansão como mudança de layout, que é o único sinal que ela dá.
    const observador = new ResizeObserver(publicaAltura);
    observador.observe(document.documentElement);

    visualViewport?.addEventListener('resize', publicaAltura);
    window.addEventListener('resize', publicaAltura);
    window.addEventListener('orientationchange', publicaAltura);
    window.addEventListener('focusin', publicaAltura);
    window.addEventListener('focusout', publicaAltura);

    return () => {
      window.cancelAnimationFrame(frame);
      observador.disconnect();
      visualViewport?.removeEventListener('resize', publicaAltura);
      window.removeEventListener('resize', publicaAltura);
      window.removeEventListener('orientationchange', publicaAltura);
      window.removeEventListener('focusin', publicaAltura);
      window.removeEventListener('focusout', publicaAltura);
    };
  }, []);

  return null;
}
