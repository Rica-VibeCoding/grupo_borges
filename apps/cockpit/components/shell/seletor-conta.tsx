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
import { useEffect, useRef, useState } from 'react';
import { fetchContas, postContaAtiva } from '@grupo_borges/cockpit-core/api';
import type { ContasResponse } from '@grupo_borges/cockpit-core/api';

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import {
  comAtivaTrocada,
  contaExibida,
  contasGuardadas,
  guardarContas,
  listaDeContas,
  mensagemDeErroTroca,
  nomeDaConfirmada,
  RELEITURA_APOS_REVALIDAR_MS,
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
  // `null` = sem leitura nenhuma nesta página. Com leitura anterior o menu
  // abre com ela NA HORA e relê por baixo: o back agora responde do cache
  // (vencido ou não) em milissegundos, então o número anterior fica na tela só
  // o tempo da ida e volta — e, se o back avisar que a sonda ainda está em voo,
  // o menu relê de novo em seguida. Releitura que falha derruba a lista e
  // mostra o erro: número sem confirmação não fica parado como se valesse.
  const [resposta, setResposta] = useState<ContasResponse | null>(contasGuardadas);
  const [carregando, setCarregando] = useState(false);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [pendente, setPendente] = useState<ContaEmLista | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmada, setConfirmada] = useState<ContaConfirmada | null>(null);
  // Contador de re-tentativa: o efeito relê quando ele anda.
  const [tentativa, setTentativa] = useState(0);
  // Anda no início e no fim de cada troca: leitura que saiu antes dela ou
  // durante ela é descartada ao voltar — um GET cruzando o POST traria a conta
  // de antes como ativa. (Se voltar antes do POST, a troca a sobrescreve.)
  const geracao = useRef(0);

  useEffect(() => {
    if (!aberto) return;
    const controle = new AbortController();
    let releitura: ReturnType<typeof setTimeout> | undefined;
    const guardada = contasGuardadas();
    setResposta(guardada);
    setCarregando(guardada === null);
    setErroLeitura(null);
    const ler = (repetir: boolean) => {
      const saiuEm = geracao.current;
      return fetchContas(controle.signal)
        .then((nova) => {
          if (controle.signal.aborted || saiuEm !== geracao.current) return;
          guardarContas(nova);
          setResposta(nova);
          setCarregando(false);
          if (repetir && nova.revalidando) {
            releitura = setTimeout(() => void ler(false), RELEITURA_APOS_REVALIDAR_MS);
          }
        })
        .catch(() => {
          if (controle.signal.aborted || saiuEm !== geracao.current) return;
          setResposta(null);
          setCarregando(false);
          setErroLeitura('Não consegui ler as contas agora.');
        });
    };
    void ler(true);
    return () => {
      controle.abort();
      clearTimeout(releitura);
    };
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
    geracao.current += 1;
    try {
      const res = await postContaAtiva(pendente.chave);
      setConfirmada(res.ativa);
      // A lista guardada passa a marcar a confirmada como ativa: a próxima
      // abertura não pode mostrar o ✓ na conta de antes da troca.
      const atualizada = comAtivaTrocada(contasGuardadas(), res.ativa);
      guardarContas(atualizada);
      setResposta(atualizada);
      setTela('trocada');
      setPendente(null);
      // A gaveta relê o painel pra convergir pelo canal normal; a pílula já
      // mostra a confirmada desde já (ver `contaExibida`).
      aoTrocou?.();
    } catch (erro) {
      setAviso(mensagemDeErroTroca(erro));
      setTela('aviso');
    } finally {
      geracao.current += 1;
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
        // respiro pra comparar de relance. Sem teto de altura: com ele, o menu no
        // pé da gaveta do celular encolhe e rola em vez de virar pra cima.
        style={{ width: 'calc(var(--ck-w-drawer) - 4 * var(--ck-space-2))', maxHeight: 'none' }}
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
