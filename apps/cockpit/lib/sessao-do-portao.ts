/**
 * A SESSÃO DO PORTÃO, lida no servidor do Next — só no painel do cliente.
 *
 * O portão (`apps/api/painel_portao.py`) autentica por cookie `HttpOnly`. O
 * navegador o manda ao Next; o que o Next busca NO SERVIDOR (a página do
 * agente, a frota inicial do layout) sai de outro processo e não leva cookie
 * nenhum — por isso este módulo repassa o cabeçalho do pedido. Sem ele, todo
 * fetch do servidor voltaria 401 e a página quebraria antes de pintar.
 *
 * `cache` do React: layout e página leem a mesma sessão no mesmo pedido; a
 * segunda leitura não vai ao portão.
 */
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { fetchAgent } from '@grupo_borges/cockpit-core/api';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';

import { MODO_CLIENTE } from './modo';
import { precisaTrocarSenha } from './sessao-no-navegador';

const API_BASE = process.env.API_BACKEND_URL ?? 'http://127.0.0.1:8002';

export type SessaoDoPortao = {
  usuario: string;
  papel: 'client' | 'admin';
  slug: string | null;
  /** Senha provisória: o portão recusa tudo (403 `trocar_senha`) até a troca. */
  trocarSenha: boolean;
};

/** O cabeçalho `cookie` do pedido em curso, inteiro. */
export const cookieDoPedido = cache(async (): Promise<string | null> => (await headers()).get('cookie'));

/** `GET /auth/me` com o cookie do pedido. `null` = sem sessão válida. */
export const leSessao = cache(async (): Promise<SessaoDoPortao | null> => {
  const cookie = await cookieDoPedido();
  if (!cookie) return null;
  try {
    const resposta = await fetch(`${API_BASE}/auth/me`, { headers: { cookie }, cache: 'no-store' });
    if (!resposta.ok) return null;
    const corpo = (await resposta.json()) as { username?: unknown; role?: unknown; slug?: unknown };
    if (typeof corpo.username !== 'string') return null;
    if (corpo.role !== 'client' && corpo.role !== 'admin') return null;
    return {
      usuario: corpo.username,
      papel: corpo.role,
      slug: typeof corpo.slug === 'string' ? corpo.slug : null,
      trocarSenha: precisaTrocarSenha(corpo),
    };
  } catch {
    return null;
  }
});

/** Para onde a sessão leva quem chega sem destino (`/`, `/entrar` já logado).
 *  Senha provisória vence: até a troca, a única tela é a de criar a senha. */
export function destinoDa(sessao: SessaoDoPortao | null): string {
  if (sessao?.trocarSenha) return '/senha';
  return sessao?.slug ? `/agente/${encodeURIComponent(sessao.slug)}` : '/entrar';
}

/**
 * Porteiro das páginas em modo cliente. Sem sessão → `/entrar`. Cliente
 * pedindo o agente de outro → o dele (o portão já recusaria a API com 403; o
 * redirect só evita a tela quebrada). Senha provisória → `/senha`. Admin
 * passa: a UI dele é fase posterior.
 */
export async function exigeSessao(slugDaRota?: string): Promise<SessaoDoPortao> {
  const sessao = await leSessao();
  if (!sessao) redirect('/entrar');
  if (sessao.trocarSenha) redirect('/senha');
  if (slugDaRota !== undefined && sessao.papel === 'client' && sessao.slug !== slugDaRota) {
    redirect(destinoDa(sessao));
  }
  return sessao;
}

/** O agente da rota, buscado com o cookie quando o modo pede. */
export async function buscaAgente(slug: string): Promise<Agent | null> {
  if (!MODO_CLIENTE) return fetchAgent(slug);
  return fetchAgent(slug, { cookie: await cookieDoPedido() });
}
