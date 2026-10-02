'use client';

/**
 * O teclado é de toque? Saiu de `composer.tsx` (02/10) inteiro: quem pergunta é
 * o campo, para decidir se o Enter envia ou quebra linha.
 */
import { useEffect, useState } from 'react';

// Teclado físico tem Shift previsível; teclado virtual (touch) não — o Enter dele é
// a única tecla de "concluir campo", então usá-la pra enviar rouba a quebra de
// linha. `pointer: coarse` é o sinal recomendado pela doc do MDN pra detectar touch,
// mais confiável que sniffar user-agent (ex: iPad com teclado físico continua coarse,
// mas aí o Shift+Enter já resolve).
export function usaTecladoTouch(): boolean {
  const [touch, setTouch] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const consulta = window.matchMedia('(pointer: coarse)');
    const aoMudar = () => setTouch(consulta.matches);
    consulta.addEventListener('change', aoMudar);
    return () => consulta.removeEventListener('change', aoMudar);
  }, []);

  return touch;
}
