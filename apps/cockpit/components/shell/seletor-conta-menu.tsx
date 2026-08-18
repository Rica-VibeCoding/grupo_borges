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

/** A barra miúda da janela dentro do item — o número é o dado (é com ele que
 *  o Rica escolhe), a barra é o resumo. Track um degrau ACIMA do vidro do
 *  menu, senão some nele. */
function JanelaMini({
  rotulo,
  nomeDaJanela,
  pct,
  nomeDaConta,
}: {
  rotulo: string;
  nomeDaJanela: string;
  pct: number | null;
  nomeDaConta: string;
}) {
  if (pct === null) {
    return (
      <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>
        {rotulo} sem leitura
      </span>
    );
  }
  return (
    <>
      <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>
        {rotulo}
      </span>
      <div
        role="meter"
        aria-label={`${nomeDaJanela} da conta ${nomeDaConta}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}% usada`}
        className="flex-1 overflow-hidden"
        style={{
          height: '3px',
          borderRadius: 'var(--ck-radius-pill)',
          background: 'var(--ck-surface-raised)',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ck-text-secondary)' }} />
      </div>
      <span
        style={{
          fontSize: 'var(--ck-text-xs)',
          color: 'var(--ck-text-primary)',
          fontVariantNumeric: 'tabular-nums',
          minWidth: '4ch',
        }}
      >
        {pct}%
      </span>
    </>
  );
}

function ItemDaConta({
  conta,
  desabilitado,
  aoSelecionar,
}: {
  conta: ContaEmLista;
  desabilitado: boolean;
  aoSelecionar: () => void;
}) {
  return (
    <DropdownMenuItem
      // A ativa fica desabilitada: escolher a conta que já está valendo não é
      // ação. `aria-disabled` mantém o item na árvore — a cota dela continua
      // legível pra quem navega ouvindo.
      disabled={desabilitado || conta.ativa}
      aria-label={conta.valorFalado}
      onSelect={(evento) => {
        evento.preventDefault();
        aoSelecionar();
      }}
      style={estiloItem()}
    >
      <span className="flex w-full min-w-0 flex-col" style={{ gap: 'var(--ck-space-1)' }}>
        <span className="flex items-center justify-between" style={{ gap: 'var(--ck-space-3)' }}>
          <span className="truncate">{conta.nome}</span>
          {conta.ativa ? (
            <span
              className="shrink-0"
              style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}
            >
              ✓ ativa
            </span>
          ) : null}
        </span>
        <span className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
          <JanelaMini rotulo="5h" nomeDaJanela="Cota de 5 horas" pct={conta.pct5h} nomeDaConta={conta.nome} />
          <JanelaMini rotulo="7d" nomeDaJanela="Cota de 7 dias" pct={conta.pct7d} nomeDaConta={conta.nome} />
        </span>
      </span>
    </DropdownMenuItem>
  );
}

export function ConteudoDaConta({
  tela,
  contas,
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
        contas.map((conta) => (
          <ItemDaConta
            key={conta.chave}
            conta={conta}
            desabilitado={trocando}
            aoSelecionar={() => aoSelecionar(conta)}
          />
        ))
      )}
    </>
  );
}
