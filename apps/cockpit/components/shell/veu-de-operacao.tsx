'use client';

/**
 * VeuDeOperacao — a trava de tela enquanto o cockpit desliga e religa o agente.
 *
 * O pedido do Rica era "o cockpit desliga, trava a tela para ninguém mexer,
 * mostra que está trabalhando e religa sozinho". A primeira versão travou só o
 * que o toque estraga: os botões de ação saíam do lugar e a gaveta de motor
 * ficava `disabled`. Ele testou em 09/09 e a leitura foi outra — "parece que eu
 * conseguia clicar em coisas ainda". Estava certo: o composer, a tropa e a
 * navegação seguiam vivos, e a tela não parecia parada.
 *
 * `position: fixed` mesmo nascendo dentro da gaveta: o véu cobre o viewport
 * inteiro venha de onde vier, e `--ck-z-modal` o põe acima da gaveta (20) e dos
 * menus (30) sem entrar no leilão de z-index solto.
 *
 * NÃO usa `inert`. O atributo não aparece na doc do React (conferido em
 * `react.dev/reference/react-dom/components/common` e no blog do 19, duas
 * vezes), e apostar numa prop desconhecida que "talvez passe" é o tipo de coisa
 * que some numa atualização menor. O que este componente trava é o CLIQUE; o
 * teclado continua travado pelo `disabled` dos controles por baixo, que é onde
 * um toque custa o boot inteiro.
 *
 * A respiração vem do `.ck-pulso` que a casa já usa para "trabalhando" — mesma
 * régua visual do card, e `prefers-reduced-motion` já respeitado lá.
 */

export function VeuDeOperacao({ aviso }: { aviso: string }) {
  return (
    <div
      role="alertdialog"
      aria-modal
      aria-busy
      aria-live="polite"
      aria-label={aviso}
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 'var(--ck-z-modal)',
        background: 'var(--ck-scrim)',
        backdropFilter: 'blur(var(--ck-veu-desfoque))',
        padding: 'var(--ck-space-4)',
      }}
    >
      <p
        className="ck-pulso"
        data-estado="trabalhando"
        style={{
          maxWidth: 'var(--ck-w-drawer)',
          textAlign: 'center',
          fontSize: 'var(--ck-text-sm)',
          color: 'var(--ck-text-primary)',
        }}
      >
        {aviso}
      </p>
    </div>
  );
}
