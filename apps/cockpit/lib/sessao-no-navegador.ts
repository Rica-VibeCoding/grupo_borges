/**
 * A SESSÃO DO PORTÃO, conferida pelo navegador — o par de
 * `sessao-do-portao.ts`, que lê no servidor.
 *
 * Quem toma uma recusa no meio do uso (o `/events` fechado, um 403) não sabe
 * se a sessão expirou, se a senha precisa ser trocada ou se o portão só caiu.
 * O `GET /auth/me` separa os três: 401 é sessão morta; `trocar_senha` é o
 * portão segurando tudo até a senha nova (ele responde 403 `trocar_senha` em
 * qualquer outra rota); o resto é queda, e quem chamou tenta de novo.
 */

/** Para onde a tela tem de ir, dado o que o `/auth/me` respondeu. `null` = fica. */
export function rumoDaSessao(status: number | null, corpo: unknown): string | null {
  if (status === 401) return '/entrar';
  if (status !== null && status >= 200 && status < 300 && precisaTrocarSenha(corpo)) return '/senha';
  return null;
}

/** O `trocar_senha` do `/auth/me`. Ausente (portão mais velho) é falso. */
export function precisaTrocarSenha(corpo: unknown): boolean {
  return !!corpo && typeof corpo === 'object' && (corpo as { trocar_senha?: unknown }).trocar_senha === true;
}

export async function confereSessao(): Promise<string | null> {
  try {
    const resposta = await fetch('/auth/me', { cache: 'no-store' });
    const corpo: unknown = resposta.ok ? await resposta.json().catch(() => null) : null;
    return rumoDaSessao(resposta.status, corpo);
  } catch {
    return null;
  }
}
