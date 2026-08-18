'use client';

/**
 * SeletorDeConta — a pílula da conta Claude vira o controle da troca.
 *
 * A conta é UMA por máquina (o `.credentials.json` é do usuário, não da
 * sessão — ver `_ler_conta_claude` no back), então este menu troca a conta da
 * frota inteira e a cópia nunca sugere "deste agente". Quem já está rodando
 * não é mexido: o restart é manual e escalonado, na mão do Rica, quando ele
 * quiser. A confirmação é o segundo toque, mesma régua do relançar — ação
 * sensível nunca dispara no primeiro.
 *
 * O gatilho guarda o desenho da pílula que já era exibição (o `ck-lit` e o
 * cinza neutro têm história — ver o comentário no `bloco-de-cota.tsx`); o que
 * muda é o `⌄` e o `ck-veil`, que avisam que agora dá pra tocar.
 */
import { useEffect, useState } from 'react';
import { fetchContas, postContaAtiva } from '@grupo_borges/cockpit-core/api';
import type { ContasResponse } from '@grupo_borges/cockpit-core/api';

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import {
  contaExibida,
  listaDeContas,
  mensagemDeErroTroca,
  nomeDaConfirmada,
  type ContaConfirmada,
  type ContaEmLista,
} from './conta-tropa';
import { ConteudoDaConta, type TelaDaConta } from './seletor-conta-menu';

export function SeletorDeConta({
  contaDoPainel,
  aoTrocou,
}: {
  /** O nome que a gaveta já exibia — o valor honesto até o back confirmar outro. */
  contaDoPainel: string;
  /** Rebusca o painel depois da troca, pra pílula convergir pelo canal normal. */
  aoTrocou?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [tela, setTela] = useState<TelaDaConta>('inicio');
  // `null` = sem leitura válida (ainda não voltou ou falhou). A lista só
  // renderiza com dado desta abertura — cota velha na hora da decisão é pior
  // que um "lendo…" de um instante.
  const [resposta, setResposta] = useState<ContasResponse | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [pendente, setPendente] = useState<ContaEmLista | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmada, setConfirmada] = useState<ContaConfirmada | null>(null);
  // Contador de re-tentativa: o efeito relê quando ele anda.
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!aberto) return;
    const controle = new AbortController();
    setResposta(null);
    setCarregando(true);
    setErroLeitura(null);
    fetchContas(controle.signal)
      .then((nova) => {
        setResposta(nova);
        setCarregando(false);
      })
      .catch(() => {
        if (controle.signal.aborted) return;
        setCarregando(false);
        setErroLeitura('Não consegui ler as contas agora.');
      });
    return () => controle.abort();
  }, [aberto, tentativa]);

  function alterarAbertura(proximo: boolean) {
    setAberto(proximo);
    if (!proximo) {
      setTela('inicio');
      setPendente(null);
      setAviso(null);
    }
  }

  async function trocar() {
    if (!pendente || trocando) return;
    setTrocando(true);
    try {
      const res = await postContaAtiva(pendente.chave);
      setConfirmada(res.ativa);
      setTela('trocada');
      setPendente(null);
      // A gaveta relê o painel pra convergir pelo canal normal; a pílula já
      // mostra a confirmada desde já (ver `contaExibida`).
      aoTrocou?.();
    } catch (erro) {
      setAviso(mensagemDeErroTroca(erro));
      setTela('aviso');
    } finally {
      setTrocando(false);
    }
  }

  const nome = contaExibida(confirmada, contaDoPainel);

  return (
    <DropdownMenu open={aberto} onOpenChange={alterarAbertura}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={aberto}
          aria-label={`Conta Claude ativa: ${nome}. Trocar a conta da máquina inteira`}
          title="Conta Claude da máquina inteira — tocar para trocar"
          className="ck-lit ck-veil ml-auto flex min-w-0 shrink-0 items-center"
          style={{
            fontSize: 'var(--ck-text-xs)',
            color: 'var(--ck-text-secondary)',
            background: 'var(--ck-surface-composer)',
            borderRadius: 'var(--ck-radius-pill)',
            padding: '2px var(--ck-space-2)',
            gap: '2px',
          }}
        >
          <span className="truncate">{nome}</span>
          <span aria-hidden className="shrink-0" style={{ color: 'var(--ck-text-tertiary)' }}>
            ⌄
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className={`ck-menu-surge ${aberto ? 'ck-menu-aberto' : 'ck-menu-fechado'}`}
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={8}
        // Quase a largura da gaveta: as duas barras por conta precisam de
        // respiro pra comparar de relance.
        style={{ width: 'calc(var(--ck-w-drawer) - 4 * var(--ck-space-2))' }}
      >
        <ConteudoDaConta
          tela={tela}
          contas={listaDeContas(resposta)}
          carregando={carregando}
          erroLeitura={erroLeitura}
          pendente={pendente}
          trocando={trocando}
          aviso={aviso}
          nomeConfirmado={confirmada ? nomeDaConfirmada(confirmada) : null}
          aoSelecionar={(conta) => {
            setPendente(conta);
            setTela('confirmacao');
          }}
          aoTentarDeNovo={() => setTentativa((atual) => atual + 1)}
          aoVoltar={() => {
            setPendente(null);
            setAviso(null);
            setTela('inicio');
          }}
          aoConfirmar={() => void trocar()}
          aoFechar={() => alterarAbertura(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
