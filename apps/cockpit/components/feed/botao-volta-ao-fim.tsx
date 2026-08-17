'use client';

import type { CSSProperties } from 'react';

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

const BASE: CSSProperties = {
  position: 'absolute',
  left: '50%',
  // Sobe junto com o composer flutuante — senão este botão nasce atrás dele,
  // e um aviso escondido é pior que aviso nenhum.
  bottom: 'calc(var(--ck-composer-altura, 0px) + var(--ck-space-3))',
  transform: 'translateX(-50%)',
  border: '1px solid var(--ck-edge-functional)',
  background: 'var(--ck-surface-raised)',
  color: 'var(--ck-text-primary)',
};

export function BotaoVoltaAoFim({ temNovas, longe, onIrAoFim }: Props) {
  if (temNovas) {
    return (
      <button
        type="button"
        data-gate-new-messages=""
        onClick={onIrAoFim}
        style={{
          ...BASE,
          minHeight: 'var(--ck-touch-min)',
          padding: '0 var(--ck-space-4)',
          borderRadius: 'var(--ck-radius-pill)',
          fontSize: 'var(--ck-text-sm)',
        }}
      >
        mensagens novas ↓
      </button>
    );
  }
  if (!longe) return null;
  return (
    <button
      type="button"
      aria-label="Voltar ao fim da conversa"
      onClick={onIrAoFim}
      style={{
        ...BASE,
        minWidth: 'var(--ck-touch-min)',
        minHeight: 'var(--ck-touch-min)',
        borderRadius: 'var(--ck-radius-pill)',
        fontSize: 'var(--ck-text-md)',
      }}
    >
      ↓
    </button>
  );
}
