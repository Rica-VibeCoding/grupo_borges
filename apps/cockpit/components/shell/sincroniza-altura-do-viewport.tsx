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
    let ultima = 0;

    const publicaAltura = () => {
      const altura = alturaDoViewport({ alturaDaJanela: window.innerHeight });
      // Só escreve quando o número muda. É o que permite reler a janela sessenta
      // vezes sem custo e sem risco: escrita repetida seria trabalho de layout à
      // toa, e foi escrita em laço que fez o `ff8cce5` piscar a tela.
      if (altura > 0 && altura !== ultima) {
        ultima = altura;
        document.documentElement.style.setProperty('--ck-viewport-altura', `${altura}px`);
      }
    };

    // A JANELA CRESCE CALADA — medido no iPhone do Rica em 12/08 (iOS 18.7), na
    // tela `/diagnostico`, com o teclado JÁ fechado: `innerHeight` de volta em
    // 852 e `--ck-viewport-altura` presa em 793. A altura volta; o último evento
    // é que chega antes dela e nada mais avisa. Os 59px de diferença são o
    // composer subindo — o defeito que o Rica relatou hoje.
    //
    // Em vez de observar o elemento raiz (`ff8cce5`, revertido no mesmo dia
    // porque a escrita voltava como mudança de layout do elemento observado),
    // relemos a janela por ~1s depois de cada evento. Ler `innerHeight` não
    // realimenta nada.
    //
    // ⚠️ SÓ ISSO NÃO BASTA — o `61d9846` apostou que sempre existe um evento por
    // perto, e o vídeo do Rica (IMG_7701, 13/08) mostra que não: o composer fica
    // 60pt acima do fundo por segundos a fio e só volta quando ele ARRASTA a
    // tela. O arraste é o evento; parado, nada avisa e a releitura já expirou.
    // Por isso a verificação periódica lá embaixo, que é a única que não depende
    // de o WebKit ter avisado.
    let frame = 0;
    let restantes = 0;
    const relePorUmSegundo = () => {
      restantes = 60;
      if (frame) return;
      const passo = () => {
        publicaAltura();
        frame = --restantes > 0 ? window.requestAnimationFrame(passo) : 0;
      };
      frame = window.requestAnimationFrame(passo);
    };

    publicaAltura();
    relePorUmSegundo();

    // Cada evento abre uma janela de releitura em vez de publicar uma vez: o
    // evento diz que ALGO se mexeu, não que a janela parou de se mexer.
    visualViewport?.addEventListener('resize', relePorUmSegundo);
    window.addEventListener('resize', relePorUmSegundo);
    window.addEventListener('orientationchange', relePorUmSegundo);
    window.addEventListener('focusin', relePorUmSegundo);
    window.addEventListener('focusout', relePorUmSegundo);
    // Voltar do segundo plano é o outro jeito de a altura mudar sem `resize`:
    // o iOS congela a página e a devolve já com outro tamanho.
    window.addEventListener('pageshow', relePorUmSegundo);
    document.addEventListener('visibilitychange', relePorUmSegundo);

    // A rede embaixo de tudo. Duas leituras por segundo de `window.innerHeight`,
    // e escrita só quando o número muda — nenhum evento precisa ter acontecido.
    // É o que separa "a app conserta quando você encosta nela" de "a app está
    // certa". O laço de ~1s acima continua para a animação do teclado, onde meio
    // segundo de atraso seria um pulo visível.
    const ronda = window.setInterval(publicaAltura, 500);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearInterval(ronda);
      visualViewport?.removeEventListener('resize', relePorUmSegundo);
      window.removeEventListener('resize', relePorUmSegundo);
      window.removeEventListener('orientationchange', relePorUmSegundo);
      window.removeEventListener('focusin', relePorUmSegundo);
      window.removeEventListener('focusout', relePorUmSegundo);
      window.removeEventListener('pageshow', relePorUmSegundo);
      document.removeEventListener('visibilitychange', relePorUmSegundo);
    };
  }, []);

  return null;
}
