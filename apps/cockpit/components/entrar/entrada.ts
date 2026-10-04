/**
 * A régua do login do painel do cliente, sem React: o que o portão responde
 * (`apps/api/painel_portao.py`, `POST /auth/login`) vira a frase que a tela
 * mostra. Erro diz o que houve e o que fazer — não pede desculpa.
 */
/** `usuario` volta no estado porque o React limpa o formulário depois de cada
 *  ação: errar a senha não pode apagar o usuário já digitado. */
export type EstadoDaEntrada = { erro: string | null; usuario: string };

export const ENTRADA_INICIAL: EstadoDaEntrada = { erro: null, usuario: '' };

export function recadoDaRecusa(status: number | null): string {
  if (status === null) return 'Sem resposta do servidor. Confira a conexão e tente de novo.';
  if (status === 401 || status === 422) return 'Usuário ou senha não conferem.';
  if (status === 429) return 'Muitas tentativas seguidas. Espere 15 minutos e tente de novo.';
  if (status === 403) return 'Este endereço não está autorizado a entrar. Abra o painel pelo link oficial.';
  return 'O servidor não conseguiu abrir a sessão agora. Tente de novo em instantes.';
}

/** Para onde ir depois do login: o agente do `GET /auth/me`, ou a tela de
 *  criar a senha quando a dele é provisória. Sem slug (admin, fase posterior)
 *  não há tela de cliente para abrir. */
export function destinoDoLogin(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== 'object') return null;
  if ((corpo as { trocar_senha?: unknown }).trocar_senha === true) return '/senha';
  const slug = (corpo as { slug?: unknown }).slug;
  return typeof slug === 'string' && /^[a-z0-9_-]+$/.test(slug) ? `/agente/${slug}` : null;
}
