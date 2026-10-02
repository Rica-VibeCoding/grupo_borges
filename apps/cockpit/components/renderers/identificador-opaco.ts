/**
 * A régua do identificador cru (02/10). `file_id` do Telegram, UUID, hash,
 * token: é nome de máquina, não diz nada ao Rica — e era o alvo de 420 linhas
 * `Usou AwACAgEAAxkB…` no corpus (`docs/pesquisas/feed-do-turno-2026-10.md`,
 * Dedução 2). Identificador cru NUNCA vira alvo; a íntegra fica na expansão.
 *
 * Só olha valor de uma palavra só e comprido (≥ 16). Caminho (`/`, `~`, `.` no
 * começo) e qualquer coisa com espaço passam direto: comando e frase não são
 * identificador.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{16,}$/i;
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
const BASE64 = /^[A-Za-z0-9+/_=-]+$/;

export function ehIdentificadorOpaco(valor: string): boolean {
  const v = valor.trim();
  if (v.length < 16 || /\s/.test(v) || /^[/~.]/.test(v)) return false;
  if (UUID.test(v) || HEX.test(v) || JWT.test(v)) return true;
  if (!BASE64.test(v) || !/\d/.test(v)) return false;

  // Base64 sorteia maiúscula e minúscula meio a meio; camelCase (`useEstadoDaLinha2`)
  // tem uma maiúscula por palavra. Um quarto das letras em caixa alta separa os dois.
  const letras = v.replace(/[^A-Za-z]/g, '');
  const maiusculas = v.replace(/[^A-Z]/g, '').length;
  return /[a-z]/.test(v) && maiusculas >= letras.length / 4;
}
