/**
 * Qual arquivo de foto a tela de voz carrega, e em que tamanho ela cabe.
 *
 * O caminho é o mesmo da cápsula do chat (`/avatars/<slug>.webp`, 128 px). O
 * núcleo da Eclipse pede foto grande: quem tem original em alta ganhou uma de
 * 512 px em `/avatars/512/`; quem não tem (canarinho, caseiro, fluytcom) fica na
 * de 128 e a foto encolhe até onde ela ainda aguenta, em vez de borrar.
 */

const COM_512 = new Set([
  'barsi',
  'daniel',
  'dimy',
  'felipe',
  'hiro',
  'lucas',
  'maestro',
  'marcio',
  'pavan',
  'tara',
  'vinicius',
]);

/** Acima disso a de 128 px pede a de 512. */
const LADO_DA_PEQUENA = 64;
/** O maior lado em que a de 128 px, escurecida e com as linhas por cima, ainda não borra feio. */
export const LADO_SEM_ALTA = 132;

export type Foto = { src: string; lado: number };

export function fotoDoAgente(slug: string, lado: number): Foto {
  if (lado <= LADO_DA_PEQUENA) return { src: `/avatars/${slug}.webp`, lado };
  if (COM_512.has(slug)) return { src: `/avatars/512/${slug}.webp`, lado };
  return { src: `/avatars/${slug}.webp`, lado: Math.min(lado, LADO_SEM_ALTA) };
}
