'use client';

/**
 * A pele da captura — o que ocupa o composer enquanto o Rica fala.
 *
 * O campo de texto SAI e a captura entra no lugar. Não é economia de espaço: é
 * que durante a fala o teclado não tem nada a fazer ali, e deixar o campo
 * visível convida a tocar nele no meio do gesto. Quem está falando precisa de
 * três coisas na tela e nenhuma outra — quanto tempo já falou, que o microfone
 * está captando de fato, e como sair sem enviar.
 */
import { duracaoLegivel, type AparenciaVoz, type FaseVoz } from './voz';
import { IconeCadeado } from './icones';

/** A onda é o único elemento da tela que prova que o microfone está VIVO.
 *
 * Sem ela, "gravando" é uma palavra — e uma palavra não distingue microfone
 * captando de microfone mudo por permissão parcial, hardware ocupado ou fone
 * desconectado no meio. É a mesma régua do `aceito` × `confirmado`: o estado
 * tem que se ver sem ler.
 *
 * Não tem guarda de `prefers-reduced-motion`, e isso é deliberado. A guarda
 * existe pra movimento DECORATIVO; aqui o movimento é o dado. Congelar a onda
 * deixaria a tela mentindo pra exatamente quem pediu menos animação. */
function Onda({ niveis, tinta }: { niveis: number[]; tinta: string }) {
  return (
    <div
      aria-hidden
      className="flex min-w-0 flex-1 items-center justify-end"
      style={{ gap: '2px', height: '28px' }}
    >
      {niveis.map((nivel, i) => (
        <span
          key={i}
          style={{
            width: '2px',
            // Piso de 3px: barra de altura zero some e a onda vira um buraco.
            // O piso mantém a linha de base legível no silêncio entre frases.
            height: `${Math.max(3, Math.round((nivel / 100) * 28))}px`,
            borderRadius: '1px',
            background: tinta,
            // Só a altura muda, e ela muda 60× por segundo: transition aqui
            // atrasaria o dado em vez de suavizá-lo.
            opacity: 0.55 + (nivel / 100) * 0.45,
          }}
        />
      ))}
    </div>
  );
}

/** O alvo de trava. Mora acima do botão de voz, aparece só durante o gesto e
 *  ACENDE progressivamente conforme o dedo sobe — um alvo que só reage no
 *  instante do limiar não ensina onde ele fica, e a segunda vez seria tão às
 *  cegas quanto a primeira. */
export function AlvoDeTrava({ progresso, armado }: { progresso: number; armado: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute flex items-center justify-center"
      style={{
        right: 'var(--ck-space-3)',
        bottom: 'calc(var(--ck-touch-min) + var(--ck-space-3))',
        width: '34px',
        height: '34px',
        borderRadius: 'var(--ck-radius-pill)',
        background: armado ? 'var(--ck-state-running)' : 'var(--ck-surface-raised)',
        color: armado ? 'var(--ck-surface-canvas)' : 'var(--ck-text-secondary)',
        border: `1px solid ${armado ? 'var(--ck-state-running)' : 'var(--ck-edge-hairline)'}`,
        // Opacidade e deslocamento seguem o dedo: o alvo sobe ao encontro dele.
        opacity: 0.35 + progresso * 0.65,
        transform: `translateY(${(1 - progresso) * 8}px)`,
        transition: 'background var(--ck-dur-fast) var(--ck-ease), color var(--ck-dur-fast) var(--ck-ease)',
        zIndex: 'var(--ck-z-sticky)' as unknown as number,
      }}
    >
      <IconeCadeado tamanho={16} />
    </div>
  );
}

export function PainelDeCaptura({
  fase,
  aparencia,
  segundos,
  niveis,
}: {
  fase: FaseVoz;
  aparencia: AparenciaVoz;
  segundos: number;
  niveis: number[];
}) {
  const tinta = aparencia.tinta ?? 'var(--ck-state-running)';
  return (
    <div className="flex min-w-0 items-center" style={{ gap: 'var(--ck-space-3)', minHeight: '48px' }}>
      <span
        className="ck-tabular shrink-0"
        style={{
          fontSize: 'var(--ck-text-md)',
          // A duração usa a tinta do estado: em `cancelando` ela fica vermelha
          // junto com tudo, e em áudio longo vira âmbar. Um número que muda de
          // cor é aviso que não precisa de frase.
          color: aparencia.longa || fase === 'cancelando' ? tinta : 'var(--ck-text-primary)',
        }}
      >
        {duracaoLegivel(segundos)}
      </span>
      {aparencia.mostraOnda ? <Onda niveis={niveis} tinta={tinta} /> : null}
    </div>
  );
}
