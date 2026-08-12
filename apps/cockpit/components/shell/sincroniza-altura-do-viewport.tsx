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

    // REVERTIDO em 12/08 (era `ff8cce5`): observar o `documentElement` para
    // pegar a janela que cresce calada realimenta a si mesmo — a altura sai
    // daqui e volta como mudança de layout do próprio elemento observado. No
    // iPhone do Rica deu tela piscando e remontagem: *"ele pisca, refaz a tela
    // [...] pus para compactar, a compactação sumiu"*. O composer nascer
    // deslocado continua aberto, e o conserto dele não passa por aqui.
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
