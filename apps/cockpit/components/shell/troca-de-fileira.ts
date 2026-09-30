/**
 * O ritmo da troca de fileira do composer (vazio ↔ com texto), animada pela
 * Motion. Espelha `--ck-dur-enter` e `--ck-ease` do globals.css: anda junto do
 * fade dos botões, e a Motion quer número, não token.
 */
export const TROCA_DE_FILEIRA = { duration: 0.2, ease: [0.2, 0, 0.2, 1] } as const;
