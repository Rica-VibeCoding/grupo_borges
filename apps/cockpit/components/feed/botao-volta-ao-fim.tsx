'use client';

import { useState, type CSSProperties } from 'react';

// Botão flutuante de retorno ao fim do feed.
//
// Nasceu em 03/08 como "mensagens novas ↓" — só aparecia quando chegava item
// com o Rica descolado. No facelift do texto (17/08) ganhou a segunda forma,
// da pergunta "onde está a setinha do ChatGPT?": longe do fim (além de 1
// viewport, `longeDoFim` em `ancora.ts`) ela aparece mesmo sem mensagem nova.
//
// Duas formas, um lugar só — logo acima do composer, como na referência:
//   - pílula com texto quando há mensagens NOVAS (o texto é a informação);
//   - botão redondo com a seta quando é só distância (a ação é óbvia e o
//     círculo pesa menos na tela parada).

type Props = {
  temNovas: boolean;
  longe: boolean;
  onIrAoFim: () => void;
};

// Montado SEMPRE (28/09), como a gaveta: é o que dá SAÍDA ao botão — cresce de
// 0,9 e acende ao aparecer, encolhe e apaga ao sumir (`.ck-volta-ao-fim` em
// `globals.css`, que também segura o `translateX(-50%)` da centralização).
// Durante a saída ele mantém a forma que tinha: se o "mensagens novas" virasse
// seta no meio do fade, o Rica veria a pílula trocar de forma enquanto some.

const BASE: CSSProperties = {
  position: 'absolute',
  left: '50%',
  // Sobe junto com o composer flutuante — senão este botão nasce atrás dele,
  // e um aviso escondido é pior que aviso nenhum.
  bottom: 'calc(var(--ck-composer-altura, 0px) + var(--ck-space-3))',
  border: '1px solid var(--ck-edge-functional)',
  background: 'var(--ck-surface-raised)',
  color: 'var(--ck-text-primary)',
  minHeight: 'var(--ck-touch-min)',
  borderRadius: 'var(--ck-radius-pill)',
};

export function BotaoVoltaAoFim({ temNovas, longe, onIrAoFim }: Props) {
  const visivel = temNovas || longe;
  // A forma em cena. Só muda com o botão visível; escondido, fica a última.
  // Ajuste de estado no render, o padrão do react.dev para "lembrar o valor
  // anterior" — ref escrita no render é o que a doc manda não fazer.
  const agora = temNovas ? 'novas' : 'seta';
  const [ultima, setUltima] = useState<'novas' | 'seta'>('seta');
  if (visivel && ultima !== agora) setUltima(agora);
  const novas = (visivel ? agora : ultima) === 'novas';

  return (
    <button
      type="button"
      className="ck-volta-ao-fim"
      data-visivel={visivel ? 'true' : 'false'}
      // O gate procura a pílula de mensagens novas VISÍVEL — escondida, ela
      // não pode responder por ele.
      data-gate-new-messages={visivel && novas ? '' : undefined}
      aria-label={novas ? undefined : 'Voltar ao fim da conversa'}
      // `visibility: hidden` já tira do Tab; o `tabIndex` é cinto para os
      // 200ms da saída, em que ele ainda está visível.
      tabIndex={visivel ? undefined : -1}
      onClick={onIrAoFim}
      style={
        novas
          ? { ...BASE, padding: '0 var(--ck-space-4)', fontSize: 'var(--ck-text-sm)' }
          : { ...BASE, minWidth: 'var(--ck-touch-min)', fontSize: 'var(--ck-text-md)' }
      }
    >
      {novas ? 'mensagens novas ↓' : '↓'}
    </button>
  );
}
