export const CONSULTA_COMPUTADOR_MUDO = '(min-width: 768px) and (hover: hover) and (pointer: fine)';

type Tecla = Pick<KeyboardEvent,
  'key' | 'repeat' | 'isComposing' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'defaultPrevented' | 'composedPath'
>;

export function aceitaAtalhoDoMudo(evento: Tecla, ativo: boolean, computador: boolean) {
  if (!ativo || !computador || evento.defaultPrevented || evento.repeat || evento.isComposing) return false;
  if (evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.key.toLowerCase() !== 'm') return false;
  return !evento.composedPath().some((alvo) => {
    const elemento = alvo as HTMLElement;
    return elemento.isContentEditable || elemento.closest?.('input, textarea, select, [role="textbox"], [role="combobox"]');
  });
}
