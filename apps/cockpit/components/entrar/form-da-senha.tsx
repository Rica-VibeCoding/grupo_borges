'use client';

/**
 * A troca de senha do painel do cliente, em dois papéis:
 *
 * - PRIMEIRO ACESSO ("Crie sua senha"): a senha recebida é provisória e o
 *   portão recusa tudo com 403 `trocar_senha` até a troca. É a única tela; o
 *   Sair fica embaixo para quem entrou na conta errada. Trocou, vai ao agente
 *   por navegação CHEIA — o layout raiz monta a frota no servidor, e montou
 *   vazia enquanto o portão recusava.
 * - CONFIGURAÇÕES ("Trocar senha"), vinda da gaveta: troca e fica, com o
 *   aviso de que as outras sessões caíram; o Voltar leva ao chat.
 *
 * O POST vai pelo navegador (rewrite `/auth/*`), como o login: o portão
 * confere o `Origin`. 401 é "senha atual errada" — ou sessão expirada no meio
 * do formulário; o `/auth/me` separa as duas antes de culpar a senha.
 */
import { useActionState } from 'react';

import { confereSessao } from '@/lib/sessao-no-navegador';

import { CARTAO_DO_PORTAO, Campo, ErroDoPortao, TITULO_DO_PORTAO, botaoDoPortao } from './campo';
import { SENHA_INICIAL, SENHA_MINIMO, conferePedido, recadoDaSenha, type EstadoDaSenha } from './senha';

const TEXTO = { fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' } as const;

export function FormDaSenha({
  primeiroAcesso,
  usuario,
  destino,
}: {
  primeiroAcesso: boolean;
  usuario: string;
  /** O chat do agente: para onde o primeiro acesso segue e o Voltar leva. */
  destino: string;
}) {
  async function trocar(_anterior: EstadoDaSenha, dados: FormData): Promise<EstadoDaSenha> {
    const pedido = {
      atual: String(dados.get('atual') ?? ''),
      nova: String(dados.get('nova') ?? ''),
      confirmar: String(dados.get('confirmar') ?? ''),
    };
    const recusa = conferePedido(pedido);
    if (recusa) return { erro: recusa, feito: false };
    try {
      const resposta = await fetch('/auth/senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atual: pedido.atual, nova: pedido.nova }),
      });
      if (resposta.status === 401 && (await confereSessao()) === '/entrar') {
        window.location.assign('/entrar');
        await new Promise(() => {});
      }
      if (!resposta.ok) return { erro: recadoDaSenha(resposta.status), feito: false };
      if (primeiroAcesso) {
        window.location.assign(destino);
        // A página vai embora; até lá o botão segue em "Salvando…".
        await new Promise(() => {});
      }
      return { erro: null, feito: true };
    } catch {
      return { erro: recadoDaSenha(null), feito: false };
    }
  }

  const [estado, acao, enviando] = useActionState(trocar, SENHA_INICIAL);

  return (
    <form action={acao} className="ck-gv flex w-full flex-col" style={CARTAO_DO_PORTAO}>
      <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
        <h1 className="leading-hero" style={TITULO_DO_PORTAO}>
          {primeiroAcesso ? 'Crie sua senha' : 'Trocar senha'}
        </h1>
        <p style={TEXTO}>
          {primeiroAcesso
            ? 'A senha que você recebeu é provisória. Crie uma só sua para continuar.'
            : 'Ao trocar, as outras sessões abertas com a sua conta são encerradas. Esta continua.'}
        </p>
      </div>

      {/* O gerenciador de senhas guarda a nova junto do usuário certo. */}
      <input type="text" name="usuario" autoComplete="username" value={usuario} readOnly hidden />

      <div className="flex flex-col" style={{ gap: 'var(--ck-space-3)' }}>
        <Campo
          nome="atual"
          rotulo={primeiroAcesso ? 'Senha que você recebeu' : 'Senha atual'}
          tipo="password"
          autoComplete="current-password"
        />
        <Campo
          nome="nova"
          rotulo="Nova senha"
          tipo="password"
          autoComplete="new-password"
          dica={`Pelo menos ${SENHA_MINIMO} caracteres, diferente da atual.`}
        />
        <Campo nome="confirmar" rotulo="Repita a nova senha" tipo="password" autoComplete="new-password" />
      </div>

      <ErroDoPortao erro={estado.erro} />
      {estado.feito && !estado.erro ? (
        <p role="status" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-ok)' }}>
          Senha trocada. As outras sessões foram encerradas.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        aria-busy={enviando}
        className="flex items-center justify-center"
        style={botaoDoPortao(enviando)}
      >
        {enviando ? 'Salvando…' : primeiroAcesso ? 'Criar senha e entrar' : 'Trocar senha'}
      </button>

      {primeiroAcesso ? null : (
        <a
          href={destino}
          className="ck-veil flex items-center justify-center self-center rounded-full"
          style={{ minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-4)', ...TEXTO }}
        >
          Voltar ao chat
        </a>
      )}
    </form>
  );
}
