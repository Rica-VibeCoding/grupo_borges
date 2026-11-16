// Ícones da tela Aprendizado, na régua de `shell/icones.tsx` (o `Tracado`).
// Moram aqui porque aquele módulo bateu o teto de 300 linhas.
import { Tracado, type IconeProps } from '@/components/shell/icones';

/** Broto — o atalho Aprendizado da raiz: o que cresceu na frota. */
export function IconeBroto(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M12 20v-8" />
      <path d="M12 12c0-3.5-2.5-6-6.5-6 0 3.5 2.5 6 6.5 6z" />
      <path d="M12 14.5c0-3 2.2-5.5 6.5-5.5 0 3-2.2 5.5-6.5 5.5z" />
    </Tracado>
  );
}

/** Página com a dobra — uma memória na linha do tempo do Aprendizado. */
export function IconeMemoria(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M6.5 3.5h7.5l4 4v13h-11.5z" />
      <path d="M14 3.5v4h4" />
      <path d="M9.5 12.5h5M9.5 16h3.5" />
    </Tracado>
  );
}

/** Duas páginas — memória compartilhada da frota. */
export function IconeMemoriaCompartilhada(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M8.5 6.5V3.5h7l3.5 3.5v10.5h-3" />
      <path d="M5 6.5h7.5l3.5 3.5v10.5H5z" />
    </Tracado>
  );
}

/** Chave inglesa — uma skill na linha do tempo do Aprendizado. */
export function IconeSkill(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M14.5 4.5a4.5 4.5 0 0 0-4.2 6.1L4.5 16.4a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4.5 4.5 0 0 0 6.1-4.2l-2.7 2.7-2.6-.5-.5-2.6z" />
    </Tracado>
  );
}

/** Lua — o selo do que o Sonho mudou sozinho. */
export function IconeLua(props: IconeProps) {
  return (
    <Tracado {...props}>
      <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" />
    </Tracado>
  );
}
