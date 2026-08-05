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

/* Os três da gaveta do anexo. Mesmo vocabulário do resto — contorno aberto,
   nada preenchido — e desenhados na mesma caixa de 24 para que os três fiquem
   com o mesmo peso óptico numa fileira vertical, que é onde eles vivem. */

export function IconeFoto(props: IconeProps) {
  return (
    <Tracado {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      {/* A montanha entra pela borda direita em vez de fechar dentro do quadro:
          fechada, a 16px ela vira um borrão colado na moldura. */}
      <path d="M4.5 17.5 9.5 12.5l4 4 2.5-2.5 3.5 3.5" />
    </Tracado>
  );
}

export function IconeVideo(props: IconeProps) {
  return (
    <Tracado {...props}>
      <rect x="3" y="6" width="12.5" height="12" rx="2.5" />
      <path d="M15.5 11.5 21 8.5v7l-5.5-3z" />
    </Tracado>
  );
}

export function IconeDocumento(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
      <path d="M14 3v4h4" />
      {/* Duas linhas de texto, não três: a terceira encosta na dobra da folha
          e o ícone perde a leitura no tamanho em que ele é usado. */}
      <path d="M9 12.5h6M9 16h4" />
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

/** Forma de onda — o segundo ícone SÓLIDO, e a referência é a razão.
 *
 * Na tela do Codex que o Rica mandou, com o composer VAZIO, o botão sólido da
 * direita não é a seta de enviar: é a onda. Faz sentido literal — sem texto não
 * há o que enviar, e o alvo de massa é o único que serve pra alguma coisa. Nós
 * herdamos essa gramática (ver o comentário do botão no composer), então a onda
 * precisa ter o mesmo peso visual da seta, não o traço fino dos secundários. */
export function IconeOnda({ tamanho = 15, ...props }: IconeProps) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <rect x="3" y="10" width="2.2" height="4" rx="1.1" />
      <rect x="7.4" y="7" width="2.2" height="10" rx="1.1" />
      <rect x="11.8" y="4" width="2.2" height="16" rx="1.1" />
      <rect x="16.2" y="8" width="2.2" height="8" rx="1.1" />
      <rect x="20.6" y="11" width="2.2" height="2" rx="1.1" />
    </svg>
  );
}

/** Quadrado cheio: parar e mandar o que já foi falado. Sólido pelo mesmo
 *  motivo da onda — é o botão que conclui a ação. */
export function IconeParar({ tamanho = 13, ...props }: IconeProps) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

/** Descartar. Traço, nunca sólido: jogar fora não é a ação que a tela promove. */
export function IconeDescartar(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Tracado>
  );
}

/** Cadeado do alvo de trava. Aparece durante o gesto, some depois. */
export function IconeCadeado(props: IconeProps) {
  return (
    <Tracado {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5" />
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
