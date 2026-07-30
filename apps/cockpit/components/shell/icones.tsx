/**
 * O vocabulário de ícone que o Rica apontou na referência do Codex (§10, depois
 * §12): traço fino, contorno ABERTO, nunca preenchido, peso constante. Ele
 * pediu vocabulário emprestado, não os SVGs dele — então são desenhados aqui,
 * do zero, na régua que ele descreveu: `strokeWidth 1.3`, `fill: none`,
 * `stroke: currentColor`, cantos suaves (`stroke-linecap/linejoin: round`).
 *
 * Um módulo só, porque a mesma régua se repete em `linha-execucao.tsx`
 * (controles de cópia) e agora no composer e na barra de telas. Duplicar o
 * `strokeWidth` em três arquivos é como um deles diverge sem ninguém perceber.
 *
 * Todo ícone nasce dentro de um alvo de toque — quem usa decide o tamanho do
 * alvo (44px onde é botão isolado, menor em fileira densa, é a mesma tensão
 * §7×§3 já documentada em `linha-execucao.tsx`).
 */
import type { SVGProps } from 'react';

type IconeProps = SVGProps<SVGSVGElement> & { tamanho?: number };

function Tracado({ tamanho = 16, children, ...props }: IconeProps) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconeAnexo(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M12 5v14M5 12h14" />
    </Tracado>
  );
}

export function IconeMicrofone(props: IconeProps) {
  return (
    <Tracado {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </Tracado>
  );
}

/** Único elemento sólido do composer — a referência isola o botão de envio
 *  do resto exatamente assim: tudo ao redor é traço, ele é massa. */
export function IconeEnviar({ tamanho = 15, ...props }: IconeProps) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 4 L20 12 L14.5 12 L14.5 20 L9.5 20 L9.5 12 L4 12 Z" />
    </svg>
  );
}

/** Três traços — não hambúrguer com moldura. Abre a tropa em overlay. */
export function IconeMenu(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Tracado>
  );
}

/** Retângulo com a faixa direita separada — o "painel" da referência, não um
 *  ícone de gaveta de arquivo. */
export function IconePainel(props: IconeProps) {
  return (
    <Tracado {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M15 4.5v15" />
    </Tracado>
  );
}

export function IconeReenviar(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M4 12a8 8 0 0 1 13.66-5.66M20 12a8 8 0 0 1-13.66 5.66" />
      <path d="M17 3v4h-4M7 21v-4h4" />
    </Tracado>
  );
}

export function IconeCopiar(props: IconeProps) {
  return (
    <Tracado {...props}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4.5 15.5H4a1.5 1.5 0 0 1-1.5-1.5V4a1.5 1.5 0 0 1 1.5-1.5h10A1.5 1.5 0 0 1 15.5 4v.5" />
    </Tracado>
  );
}
