/**
 * Os comandos de barra do cockpit — os únicos que a bolha mostra. Ordem do Rica
 * (01/11): "prefiro colocar os slashes conforme a demanda vier"; a lista do
 * Claude Code saiu porque a maioria precisa de tela que não abre aqui. Comando
 * novo é uma linha nesta lista mais o `case` em `campo-do-composer.tsx`.
 *
 * Comando de UM agente (01/11, `/lead` do Vinicius) não mora aqui: é o
 * `.claude/commands/<nome>.md` do workspace dele com `cockpit: true` no
 * frontmatter. A bolha do card dele mostra, e escolher só escreve no campo.
 */
export const COMANDOS_DO_COCKPIT = ['/voltar'] as const;

export type ComandoDoCockpit = (typeof COMANDOS_DO_COCKPIT)[number];

/** O texto do campo é um comando do cockpit digitado inteiro (`/voltar` + Enter). */
export function comandoDigitado(texto: string): ComandoDoCockpit | null {
  const limpo = texto.trim();
  return (COMANDOS_DO_COCKPIT as readonly string[]).includes(limpo) ? (limpo as ComandoDoCockpit) : null;
}

/** Os comandos próprios do agente que pediram lugar no menu (`cockpit: true`). */
export function comandosDoAgente(
  lista: readonly { comando: string; origem: string; cockpit?: boolean }[],
): string[] {
  const doCockpit = COMANDOS_DO_COCKPIT as readonly string[];
  return lista
    .filter((c) => c.origem === 'project' && c.cockpit === true && !doCockpit.includes(c.comando))
    .map((c) => c.comando);
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
