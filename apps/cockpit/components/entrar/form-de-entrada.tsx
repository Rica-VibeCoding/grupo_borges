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

const CAMPO = {
  minHeight: 'var(--ck-touch-min)',
  padding: '0 var(--ck-space-3)',
  borderRadius: 'var(--ck-gv-raio-bloco)',
  border: '1px solid var(--ck-edge-functional)',
  background: 'var(--ck-gv-bloco)',
  color: 'var(--ck-text-primary)',
  fontSize: 'var(--ck-text-md)', // 16px: piso do Safari contra o zoom no foco
} as const;

const ROTULO = { fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' } as const;

function Campo({
  nome,
  rotulo,
  tipo,
  autoComplete,
  inicial = '',
}: {
  nome: string;
  rotulo: string;
  tipo: string;
  autoComplete: string;
  inicial?: string;
}) {
  return (
    <label className="flex flex-col" style={{ gap: 'var(--ck-space-1)' }}>
      <span style={ROTULO}>{rotulo}</span>
      <input
        name={nome}
        type={tipo}
        defaultValue={inicial}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        // Foco sem anel colorido (estética §9.17): a própria borda clareia.
        className="ck-campo outline-none focus-visible:[border-color:var(--ck-edge-composer-foco)]"
        style={CAMPO}
      />
    </label>
  );
}

export function FormDeEntrada() {
  const [estado, acao, enviando] = useActionState(entrar, ENTRADA_INICIAL);

  return (
    <form
      action={acao}
      className="ck-gv flex w-full flex-col"
      style={{
        maxWidth: '380px',
        gap: 'var(--ck-space-4)',
        padding: 'var(--ck-space-5) var(--ck-space-4) var(--ck-space-4)',
        borderRadius: 'var(--ck-gv-raio-cartao)',
        background: 'var(--ck-gv-camada)',
      }}
    >
      <h1 className="leading-hero" style={{ fontSize: 'var(--ck-text-lg)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>
        Entre para falar com o seu agente
      </h1>

      <div className="flex flex-col" style={{ gap: 'var(--ck-space-3)' }}>
        <Campo nome="usuario" rotulo="Usuário" tipo="text" autoComplete="username" inicial={estado.usuario} />
        <Campo nome="senha" rotulo="Senha" tipo="password" autoComplete="current-password" />
      </div>

      {estado.erro ? (
        <p role="alert" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)' }}>
          {estado.erro}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        aria-busy={enviando}
        className="flex items-center justify-center"
        style={{
          minHeight: '48px',
          borderRadius: 'var(--ck-gv-raio-bloco)',
          fontSize: 'var(--ck-text-sm)',
          fontWeight: 600,
          background: 'var(--ck-gv-ativo)',
          color: 'var(--ck-text-primary)',
          opacity: enviando ? 0.7 : 1,
          transition: 'opacity var(--ck-dur-fast) var(--ck-ease)',
        }}
      >
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
