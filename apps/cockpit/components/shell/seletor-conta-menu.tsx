'use client';

/**
 * As telas do seletor de conta — lista, confirmação, erro e sucesso dentro do
 * MESMO menu, como o `seletor-motor-menu` faz. Modal foi recusado de saída:
 * a pílula mora dentro da gaveta, e um véu sobre um véu empilha duas
 * superfícies.
 *
 * A cópia da confirmação é a parte sensível e tem dono (Daniel, 18/08):
 * "a conta é da máquina inteira, nunca deste agente" e "a troca não mexe em
 * quem já está rodando" — sem número e sem promessa, porque o restart é
 * manual e na hora que o Rica quiser. Não editar pra precisar sem perguntar.
 */
import type { CSSProperties } from 'react';

import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import type { ContaEmLista } from './conta-tropa';
import { ItemDaConta } from './item-da-conta';

export type TelaDaConta = 'inicio' | 'confirmacao' | 'aviso' | 'trocada';

const ROTULO: CSSProperties = {
  padding: 'var(--ck-space-2) var(--ck-space-3)',
  fontSize: 'var(--ck-text-xs)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--ck-track-overline)',
  color: 'var(--ck-text-secondary)',
};

const TEXTO: CSSProperties = {
  padding: 'var(--ck-space-2) var(--ck-space-3)',
  fontSize: 'var(--ck-text-base)',
  color: 'var(--ck-text-primary)',
};

const TEXTO_MIUDO: CSSProperties = {
  padding: '0 var(--ck-space-3) var(--ck-space-2)',
  fontSize: 'var(--ck-text-sm)',
  color: 'var(--ck-text-secondary)',
};

function estiloItem(selecionado = false): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--ck-space-3)',
    padding: 'var(--ck-space-2) var(--ck-space-3)',
    borderRadius: 'var(--ck-radius-chip)',
    color: 'var(--ck-text-primary)',
    fontSize: 'var(--ck-text-base)',
    textAlign: 'left',
    width: '100%',
    ...(selecionado
      ? { backgroundImage: 'linear-gradient(var(--ck-overlay-selected), var(--ck-overlay-selected))' }
      : {}),
  };
}

export function ConteudoDaConta({
  tela,
  contas,
  modelo = null,
  carregando,
  erroLeitura,
  pendente,
  trocando,
  aviso,
  nomeConfirmado,
  aoSelecionar,
  aoTentarDeNovo,
  aoVoltar,
  aoConfirmar,
  aoFechar,
}: {
  tela: TelaDaConta;
  contas: ContaEmLista[];
  modelo?: string | null;
  carregando: boolean;
  erroLeitura: string | null;
  pendente: ContaEmLista | null;
  trocando: boolean;
  aviso: string | null;
  nomeConfirmado: string | null;
  aoSelecionar: (conta: ContaEmLista) => void;
  aoTentarDeNovo: () => void;
  aoVoltar: () => void;
  aoConfirmar: () => void;
  aoFechar: () => void;
}) {
  if (tela === 'confirmacao' && pendente) {
    return (
      <>
        <p style={TEXTO}>Trocar para {pendente.nome}?</p>
        <p style={TEXTO_MIUDO}>
          A conta é da máquina inteira, não deste agente. A troca não mexe em quem já está rodando.
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={trocando}
          onSelect={(evento) => {
            evento.preventDefault();
            aoVoltar();
          }}
          style={estiloItem()}
        >
          Cancelar
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={trocando}
          aria-busy={trocando}
          onSelect={(evento) => {
            evento.preventDefault();
            aoConfirmar();
          }}
          style={estiloItem(true)}
        >
          {trocando ? 'Trocando…' : `Trocar para ${pendente.nome}`}
        </DropdownMenuItem>
      </>
    );
  }

  if (tela === 'aviso') {
    return (
      <>
        <p aria-live="polite" style={{ ...TEXTO, color: 'var(--ck-state-attention)' }}>
          {aviso}
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(evento) => {
            evento.preventDefault();
            aoVoltar();
          }}
          style={estiloItem()}
        >
          Voltar
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(evento) => {
            evento.preventDefault();
            aoFechar();
          }}
          style={estiloItem()}
        >
          Fechar
        </DropdownMenuItem>
      </>
    );
  }

  if (tela === 'trocada') {
    return (
      <>
        {/* `role="status"`: a confirmação chega sem toque do Rica — quem não
            vê a tela precisa ouvir qual conta ficou valendo. */}
        <p role="status" style={TEXTO}>
          ✓ {nomeConfirmado} é a conta ativa
        </p>
        <p style={TEXTO_MIUDO}>Quem já está rodando segue como estava.</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(evento) => {
            evento.preventDefault();
            aoFechar();
          }}
          style={estiloItem()}
        >
          Fechar
        </DropdownMenuItem>
      </>
    );
  }

  return (
    <>
      {/* O escopo vem ANTES da lista: a troca vale pra máquina inteira, e
          quem lê só o cabeçalho já não sai achando que é "deste agente". */}
      <p style={ROTULO}>Conta Claude — máquina inteira</p>
      {carregando ? (
        <p style={{ ...TEXTO_MIUDO, padding: 'var(--ck-space-2) var(--ck-space-3)' }}>
          Lendo as contas…
        </p>
      ) : erroLeitura ? (
        <>
          <p role="alert" style={{ ...TEXTO, color: 'var(--ck-state-attention)' }}>
            {erroLeitura}
          </p>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(evento) => {
              evento.preventDefault();
              aoTentarDeNovo();
            }}
            style={estiloItem()}
          >
            Tentar de novo
          </DropdownMenuItem>
        </>
      ) : contas.length === 0 ? (
        <p style={{ ...TEXTO_MIUDO, padding: 'var(--ck-space-2) var(--ck-space-3)' }}>
          Nenhuma conta configurada.
        </p>
      ) : (
        <div role="none" className="flex flex-col" style={{ gap: 'var(--ck-space-1)' }}>
          {contas.map((conta) => (
            <ItemDaConta
              key={conta.chave}
              conta={conta}
              modelo={modelo}
              desabilitado={trocando}
              aoSelecionar={() => aoSelecionar(conta)}
            />
          ))}
        </div>
      )}
    </>
  );
}
