'use client';

import { useEffect } from 'react';

import { alturaDoViewport } from './altura-do-viewport';

function modoAplicativoInstalado(): boolean {
  const navegador = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches || navegador.standalone === true
  );
}

/** Teclado virtual só existe com um campo de texto focado — o foco é o único
 *  sinal que não depende das medidas de janela, que são justamente o que o
 *  WebKit reporta errado depois do teclado. */
function campoDeTextoFocado(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || (el as HTMLElement).isContentEditable
  );
}

export function SincronizaAlturaDoViewport() {
  useEffect(() => {
    // No navegador a altura certa é o `100dvh` do CSS, e ele é o único que a
    // mantém certa sozinha: a barra do Safari cresce e encolhe sem disparar
    // `resize` confiável, então qualquer número medido aqui envelhece calado.
    if (!modoAplicativoInstalado()) return;

    // NO APLICATIVO INSTALADO O JS SÓ MANDA ENQUANTO O TECLADO ESTÁ EM CENA.
    //
    // A régua do que aconteceu em quatro rodadas (9e522ab → dd23112 → 61d9846 →
    // 6f0fd4c): antes da variável existir, o layout era `100dvh` puro e o
    // composer NUNCA subia em repouso — o defeito de então era só o teclado
    // aberto, onde o dvh fica em 793 e enfia o composer atrás do teclado. A
    // variável consertou o teclado aberto copiando `window.innerHeight`, e
    // IMPORTOU um defeito novo: depois que o teclado fecha, o WebKit deixa o
    // `innerHeight` preso em 793 (852 − 59, exatamente a faixa da status bar
    // com `black-translucent`) até o próximo GESTO na tela. Nenhum evento
    // avisa quando ele volta — releitura por 1s (61d9846) e ronda de 500ms
    // (6f0fd4c) só copiavam o número mentiroso mais depressa. O vídeo do Rica
    // (IMG_7701, 13/08): composer 60pt acima do fundo em repouso, e voltando
    // no instante em que ele ARRASTA a tela.
    //
    // Então cada regime fica com o motor que comprovadamente acerta nele:
    // - campo focado (teclado em cena) → variável = viewport visual + o seu
    //   deslocamento, os dois números que o COMPOSITOR atualiza na hora;
    // - sem foco (repouso) → variável REMOVIDA, e o `height` cai no fallback
    //   `100dvh` do CSS — o motor que o histórico prova que se corrige sozinho.
    //
    // POR QUE NÃO `innerHeight` NO TECLADO: ele é atrasado nas DUAS direções.
    // A prova está no min/max da `/diagnostico` filmada no IMG_7704: com o
    // teclado tendo aberto na sessão, o `innerHeight` "viu 793–852" — o 655
    // NUNCA apareceu. A escrita firmava 852, a app não encolhia e o composer
    // ficava atrás do teclado (IMG_7705, 11s sem aparecer). Já o par
    // `visualViewport.height + offsetTop` mediu 449 + 216 = 665 no aparelho
    // (12/08): "fundo da app = fundo da área visível", com o "role para
    // revelar" do WebKit já compensado por construção — panorâmica de 216 ou
    // de 0, a soma aponta o topo do teclado.
    const visualViewport = window.visualViewport;
    const raiz = document.documentElement;
    let ultima = 0;
    let candidata = 0;
    let firmeHa = 0;

    const publicaAltura = () => {
      if (!campoDeTextoFocado()) {
        candidata = 0;
        firmeHa = 0;
        if (ultima === 0) return;
        ultima = 0;
        raiz.style.removeProperty('--ck-viewport-altura');
        // O gesto sintético. O WebKit destrava as medidas no primeiro arraste
        // (o vídeo prova); zerar a rolagem do documento é o arraste que dá
        // para fazer por código — e neste app a página inteira nunca rola
        // (overflow-hidden, cada superfície rola por dentro), então zerar uma
        // rolagem fantasma nunca desloca nada que o Rica esteja vendo.
        window.requestAnimationFrame(() => window.scrollTo(0, 0));
        return;
      }
      const altura = alturaDoViewport({
        alturaVisual: visualViewport?.height,
        deslocamentoVisual: visualViewport?.offsetTop,
        alturaDaJanela: window.innerHeight,
      });
      if (altura <= 0 || altura === ultima) return;
      // Escrita só depois de o número FIRMAR (mesmo valor por alguns quadros):
      // um re-layout só, quando o teclado assenta — escrever 60×/s durante a
      // animação re-layouta a app sob os pés do "revelar" do WebKit.
      if (altura !== candidata) {
        candidata = altura;
        firmeHa = 0;
        return;
      }
      if (++firmeHa < 5) return;
      ultima = altura;
      raiz.style.setProperty('--ck-viewport-altura', `${altura}px`);
    };

    // Cada evento abre ~1s de releitura em `requestAnimationFrame`: o evento
    // diz que ALGO se mexeu, não que a janela parou de se mexer, e a animação
    // do teclado muda o número no meio do caminho. Ler não realimenta.
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

    visualViewport?.addEventListener('resize', relePorUmSegundo);
    // O "role para revelar o campo" é panorâmica, não redimensionamento: muda
    // o `offsetTop` e só avisa por aqui.
    visualViewport?.addEventListener('scroll', relePorUmSegundo);
    window.addEventListener('resize', relePorUmSegundo);
    window.addEventListener('orientationchange', relePorUmSegundo);
    window.addEventListener('focusin', relePorUmSegundo);
    window.addEventListener('focusout', relePorUmSegundo);
    // Voltar do segundo plano muda a altura sem `resize` — o iOS congela a
    // página e a devolve já com outro tamanho.
    window.addEventListener('pageshow', relePorUmSegundo);
    document.addEventListener('visibilitychange', relePorUmSegundo);

    // A rede embaixo dos eventos, para o teclado que fecha sem tirar o foco
    // (arraste que o iOS usa para recolher o teclado): duas verificações por
    // segundo, escrita só na mudança.
    const ronda = window.setInterval(publicaAltura, 500);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearInterval(ronda);
      raiz.style.removeProperty('--ck-viewport-altura');
      visualViewport?.removeEventListener('resize', relePorUmSegundo);
      visualViewport?.removeEventListener('scroll', relePorUmSegundo);
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
