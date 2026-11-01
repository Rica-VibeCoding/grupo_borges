/**
 * Os comandos de barra do cockpit — os únicos que a bolha mostra. Ordem do Rica
 * (01/11): "prefiro colocar os slashes conforme a demanda vier"; a lista do
 * Claude Code saiu porque a maioria precisa de tela que não abre aqui. Comando
 * novo é uma linha nesta lista mais o `case` em `campo-do-composer.tsx`.
 */
export const COMANDOS_DO_COCKPIT = ['/voltar'] as const;

export type ComandoDoCockpit = (typeof COMANDOS_DO_COCKPIT)[number];

/** O texto do campo é um comando do cockpit digitado inteiro (`/voltar` + Enter). */
export function comandoDigitado(texto: string): ComandoDoCockpit | null {
  const limpo = texto.trim();
  return (COMANDOS_DO_COCKPIT as readonly string[]).includes(limpo) ? (limpo as ComandoDoCockpit) : null;
}

/** A bolha abre com uma barra sozinha no campo, até ser dispensada à mão. */
export function bolhaAberta(texto: string, dispensada: boolean): boolean {
  return texto === '/' && !dispensada;
}

/**
 * O véu do composer cobre a bolha e o modal que ela abre. É UM elemento só,
 * vivo enquanto qualquer um dos dois estiver na tela: da bolha pro modal ele
 * não desmonta, então não pisca.
 */
export function veuDoComposer(bolha: boolean, modal: boolean): boolean {
  return bolha || modal;
}
