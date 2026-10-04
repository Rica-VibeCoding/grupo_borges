/**
 * A régua da troca de senha do painel do cliente, sem React. O portão
 * (`POST /auth/senha`, `docs/produto-painel-cliente.md`) responde 204 na
 * troca, 401 com a atual errada e 422 com a nova fraca — mínimo de 8
 * caracteres, diferente da atual. A tela confere o mesmo antes de enviar, para
 * o erro aparecer sem ida ao servidor, e acrescenta a confirmação, que o
 * portão não recebe.
 */
export const SENHA_MINIMO = 8;

export type PedidoDeSenha = { atual: string; nova: string; confirmar: string };

/** `feito`: a troca passou (só a tela de Configurações fica para mostrar). */
export type EstadoDaSenha = { erro: string | null; feito: boolean };

export const SENHA_INICIAL: EstadoDaSenha = { erro: null, feito: false };

/** O que impede o envio, na ordem em que a pessoa preenche. `null` = pode ir. */
export function conferePedido({ atual, nova, confirmar }: PedidoDeSenha): string | null {
  if (!atual || !nova || !confirmar) return 'Preencha os três campos.';
  if (nova.length < SENHA_MINIMO) return `A nova senha precisa ter pelo menos ${SENHA_MINIMO} caracteres.`;
  if (nova === atual) return 'A nova senha precisa ser diferente da atual.';
  if (confirmar !== nova) return 'A confirmação não é igual à nova senha. Digite de novo.';
  return null;
}

export function recadoDaSenha(status: number | null): string {
  if (status === null) return 'Sem resposta do servidor. Confira a conexão e tente de novo.';
  if (status === 401) return 'A senha atual não confere.';
  if (status === 422) return `A nova senha precisa ter pelo menos ${SENHA_MINIMO} caracteres e ser diferente da atual.`;
  if (status === 429) return 'Muitas tentativas seguidas. Espere 15 minutos e tente de novo.';
  if (status === 403) return 'Este endereço não está autorizado. Abra o painel pelo link oficial.';
  return 'Não consegui trocar a senha agora. Tente de novo em instantes.';
}
