/**
 * O deslize da tropa no DOM: devolve cada linha que andou ao lugar velho e a
 * solta até zero. Saiu do `useLayoutEffect` de `tropa.tsx` (02/10) — lá ficam
 * as refs, a foto e a hora certa; a conta de quem andou é `lib/desliza-tropa.ts`.
 */
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { deslizes } from '@/lib/desliza-tropa';

export type FotoDoDeslize = { topos: Map<string, number>; soltada: string | null };

export function deslizaAsLinhas(
  ul: HTMLUListElement,
  agentesOrdenados: Agent[],
  foto: FotoDoDeslize,
) {
  const linhas = new Map<string, HTMLElement>();
  const depois = new Map<string, number>();
  agentesOrdenados.forEach((a, i) => {
    const li = ul.children[i] as HTMLElement | undefined;
    if (!li) return;
    linhas.set(a.slug, li);
    depois.set(a.slug, li.getBoundingClientRect().top);
  });
  const andaram = deslizes(foto.topos, depois, foto.soltada);
  for (const { slug, dy } of andaram) {
    const li = linhas.get(slug)!;
    li.style.transition = 'none';
    li.style.transform = `translateY(${dy}px)`;
  }
  if (andaram.length === 0) return;
  // Lê o layout para o navegador assentar o ponto de partida antes da
  // transição — sem isto ele junta as duas escritas e não anima nada.
  void ul.offsetHeight;
  // A linha soltada fica POR CIMA enquanto as outras deslizam. As `li` são
  // transparentes e quem ganha `transform` sobe de camada: sem isto a linha
  // que desce passa pintada por cima da que o dedo acabou de soltar. O fundo
  // opaco é o da faixa — a linha soltada tapa a que atravessa por baixo dela.
  // `position: relative` sem deslocamento só existe para o `z-index` valer.
  const solta = foto.soltada ? linhas.get(foto.soltada) : undefined;
  let faltam = andaram.length;
  let seguranca = 0;
  const desce = () => {
    if (!solta) return;
    window.clearTimeout(seguranca);
    solta.style.position = '';
    solta.style.zIndex = '';
    solta.style.background = '';
  };
  if (solta) {
    solta.style.position = 'relative';
    solta.style.zIndex = '1';
    solta.style.background = 'var(--ck-surface-nav)';
    // Rede para o `transitionend` que não vem — aba escondida no meio do
    // deslize, linha desmontada pelo poll. O deslize dura 320ms; o dobro basta.
    seguranca = window.setTimeout(desce, 640);
  }
  for (const { slug } of andaram) {
    const li = linhas.get(slug)!;
    li.style.transition = 'transform var(--ck-dur-calm, 320ms) var(--ck-ease)';
    li.style.transform = '';
    const limpa = (evento: TransitionEvent) => {
      if (evento.target !== li || evento.propertyName !== 'transform') return;
      li.style.transition = '';
      li.removeEventListener('transitionend', limpa);
      faltam -= 1;
      if (faltam === 0) desce();
    };
    li.addEventListener('transitionend', limpa);
  }
}
