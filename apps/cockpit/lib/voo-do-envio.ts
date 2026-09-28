import { flushSync } from 'react-dom';

/**
 * O VOO DO ENVIO (28/09, pedido do Rica). O texto sai do campo e vira a bolha
 * no feed num movimento só, em vez de sumir de um lado e surgir seco do outro.
 *
 * Por que a View Transition NATIVA e não o `<ViewTransition>` do React: o
 * React só anima atualização marcada como Transition, e a bolha otimista chega
 * ao feed por `useSyncExternalStore` (`eco-pendente.ts`), que é sempre síncrono
 * — dentro de `startTransition` ela sairia sem animar. Aqui o navegador
 * fotografa o campo, o `flushSync` pinta a bolha no mesmo quadro e o mesmo nome
 * nos dois lados faz o par. Nenhuma dependência nova (Motion custaria ~34 KB e
 * brigaria com o `translateY` do virtualizador).
 *
 * Sem a API (navegador antigo) ou com `prefers-reduced-motion`, a atualização
 * roda direto: o envio é o de sempre, só sem o voo.
 */

export const NOME_DO_VOO = 'ck-envio';

type ComVoo = Document & {
  startViewTransition?: (atualiza: () => void) => { updateCallbackDone: Promise<void>; finished: Promise<void> };
};

function podeVoar(campo: HTMLElement | null): campo is HTMLElement {
  if (campo === null || typeof document === 'undefined') return false;
  if (typeof (document as ComVoo).startViewTransition !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A bolha otimista se marca com `data-eco` (`corpo-do-item.tsx`); é o único
 *  jeito de achá-la sem atravessar o virtualizador. */
function achaBolha(idEco: string | null): HTMLElement | null {
  if (idEco === null) return null;
  return document.querySelector<HTMLElement>(`[data-eco="cc-otimista-${CSS.escape(idEco)}"]`);
}

/**
 * Roda `atualiza` (esvaziar o campo + registrar a bolha) dentro do voo e
 * devolve o id do eco que ela registrou.
 *
 * O callback da View Transition roda um quadro depois da foto do campo, então
 * o id só existe depois de `updateCallbackDone`. Um segundo Enter nesse quadro
 * (~16 ms) não passa: repetição de tecla leva 30 ms ou mais.
 *
 * Se a bolha não estiver montada (o virtualizador não a pintou), o campo faz só
 * a saída e o feed aparece como sempre apareceu.
 */
export async function voaParaBolha(
  campo: HTMLElement | null,
  atualiza: () => string | null,
): Promise<string | null> {
  if (!podeVoar(campo)) return atualiza();
  const raiz = document.documentElement;
  let idEco: string | null = null;
  let rodou = false;
  let bolha: HTMLElement | null = null;
  campo.style.viewTransitionName = NOME_DO_VOO;
  raiz.dataset.voo = 'envio';
  const transicao = (document as ComVoo).startViewTransition!(() => {
    campo.style.viewTransitionName = '';
    rodou = true;
    flushSync(() => {
      idEco = atualiza();
    });
    bolha = achaBolha(idEco);
    if (bolha) bolha.style.viewTransitionName = NOME_DO_VOO;
  });
  const limpa = () => {
    campo.style.viewTransitionName = '';
    if (bolha) bolha.style.viewTransitionName = '';
    delete raiz.dataset.voo;
  };
  transicao.finished.then(limpa, limpa);
  try {
    await transicao.updateCallbackDone;
  } catch {
    // Pela especificação o callback roda mesmo com o voo pulado; a rejeição
    // vem de exceção lá dentro. Se ela veio antes da atualização, o envio não
    // pode sumir por causa da animação: roda sem voo.
    if (!rodou) idEco = atualiza();
  }
  return idEco;
}
