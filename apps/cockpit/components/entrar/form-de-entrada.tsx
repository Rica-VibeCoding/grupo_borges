'use client';

/**
 * O login do painel do cliente — usuário, senha, Entrar. Na gramática da
 * gaveta (estética §8): cartão grafite sobre o palco, campos no preto do bloco,
 * a ação principal no azul do painel, como o "Voltar ao chat". Sem herói, sem
 * logo: quem chega aqui já sabe onde está.
 *
 * O POST vai pelo navegador (rewrite `/auth/*` do `next.config.ts`), e não
 * por Server Action: o portão confere o `Origin` e grava o cookie `HttpOnly`
 * na resposta — os dois só chegam certos no caminho do próprio navegador.
 *
 * Depois do login a ida ao agente é navegação CHEIA (`location.assign`), não
 * `router.push`: o layout raiz monta a frota da sessão no servidor e é
 * preservado entre navegações do cliente — ficaria com a frota vazia de quem
 * ainda não tinha entrado.
 */
import { useActionState } from 'react';

import { CARTAO_DO_PORTAO, Campo, ErroDoPortao, TITULO_DO_PORTAO, botaoDoPortao } from './campo';
import { ENTRADA_INICIAL, destinoDoLogin, recadoDaRecusa, type EstadoDaEntrada } from './entrada';

async function entrar(_anterior: EstadoDaEntrada, dados: FormData): Promise<EstadoDaEntrada> {
  const usuario = String(dados.get('usuario') ?? '').trim();
  const senha = String(dados.get('senha') ?? '');
  const recusa = (erro: string): EstadoDaEntrada => ({ erro, usuario });
  if (!usuario || !senha) return recusa('Preencha usuário e senha.');
  try {
    const login = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    if (!login.ok) return recusa(recadoDaRecusa(login.status));
    const eu = await fetch('/auth/me', { cache: 'no-store' });
    if (!eu.ok) return recusa(recadoDaRecusa(eu.status));
    const destino = destinoDoLogin(await eu.json());
    if (!destino) return recusa('Esta conta não tem um agente para abrir aqui.');
    window.location.assign(destino);
    // A página vai embora; até lá o botão segue em "Entrando…".
    await new Promise(() => {});
    return { erro: null, usuario };
  } catch {
    return recusa(recadoDaRecusa(null));
  }
}

export function FormDeEntrada() {
  const [estado, acao, enviando] = useActionState(entrar, ENTRADA_INICIAL);

  return (
    <form
      action={acao}
      className="ck-gv flex w-full flex-col"
      style={CARTAO_DO_PORTAO}
    >
      <h1 className="leading-hero" style={TITULO_DO_PORTAO}>
        Entre para falar com o seu agente
      </h1>

      <div className="flex flex-col" style={{ gap: 'var(--ck-space-3)' }}>
        <Campo nome="usuario" rotulo="Usuário" tipo="text" autoComplete="username" inicial={estado.usuario} />
        <Campo nome="senha" rotulo="Senha" tipo="password" autoComplete="current-password" />
      </div>

      <ErroDoPortao erro={estado.erro} />

      <button
        type="submit"
        disabled={enviando}
        aria-busy={enviando}
        className="flex items-center justify-center"
        style={botaoDoPortao(enviando)}
      >
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
