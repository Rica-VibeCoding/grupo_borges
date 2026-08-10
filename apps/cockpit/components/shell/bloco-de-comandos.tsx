'use client';

/**
 * BlocoDeComandos — a linha de comandos do painel, pedida pelo Rica em 10/08:
 * *"colocar um botão de compactar no painel mesmo (…) podemos colocar 3 botões,
 * compactar, clear, encerrar (comando) depois vou ver os outros"*.
 *
 * É o slot que ele mandou TIRAR em 09/08 até ter a lista — agora com a lista.
 *
 * **Região própria, não uma quarta cadeira na linha de cima.** As ações rápidas
 * mexem no PROCESSO (destravar o pane, relançar o CLI, desligar o cgroup); estes
 * botões mandam TEXTO pro agente, pela mesma porta do composer. São duas
 * naturezas, e empurrá-las para a mesma fileira daria seis botões de ~55px num
 * iPhone — abaixo do alvo mínimo de toque, e sem dizer qual grupo é qual.
 *
 * Fica DEPOIS das ações de propósito: quando o agente trava, o que salva o Rica
 * é o Destravar, e ele não pode descer na tela para dar lugar à rotina.
 *
 * O que não é óbvio e mora aqui:
 *
 * - **O `/compact` acende a máquina compartilhada ANTES do POST.** Quem manda
 *   `/compact` hoje é o composer, e é ele que trava o campo e desenha a barra
 *   (`lib/compact.ts`, uma máquina por slug, registry de módulo). Mandando daqui
 *   sem acender, o Rica veria o contexto encolher sem barra nenhuma — e poderia
 *   escrever no meio do resumo, que é o acidente de 05/08 que custou uma
 *   mensagem dele. Acende antes do POST pelo mesmo motivo que o composer:
 *   a barra nasce com o clique, não com o 200. Falhou o envio, apaga.
 * - **O painel não é buscado aqui.** `dePe` chega por prop do `BlocoDeAcoes`,
 *   que já leu o `/painel` — duas buscas do mesmo recurso divergiriam na tela.
 */
import { useEffect, useRef, useState } from 'react';
import { postAgentInput } from '@grupo_borges/cockpit-core/api';

import { CONFIRMA_ACAO_MS, RECIBO_MS, type Impedimento } from './acoes-rapidas';
import {
  COMANDOS,
  comandoInerte,
  descreveComando,
  diagnosticaComando,
  rotulaComando,
  type Comando,
  type ComandoId,
  type FaseComando,
} from './comandos-do-painel';
import { IconeDescartar } from './icones';
import { usaCompact } from '../../lib/compact';

export type BlocoDeComandosProps = {
  agentSlug: string;
  /** A gaveta está à vista. Fechou, a confirmação armada caduca — pergunta que
   *  saiu da tela não pode esperar um toque distraído meia hora depois. */
  aberto: boolean;
};

export function BlocoDeComandos({ agentSlug, aberto }: BlocoDeComandosProps) {
  const [estado, setEstado] = useState<{ id: ComandoId; fase: FaseComando } | null>(null);
  const [falha, setFalha] = useState<Impedimento | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { estado: estadoCompact, iniciar: iniciarCompact, cancelar: cancelarCompact } = usaCompact(agentSlug);

  // A espera do `/compact` vista de fora: enquanto ela corre, o botão dele não
  // volta a ser alvo. Vale para o compact mandado do composer também — as duas
  // peças leem a MESMA máquina.
  const compactEmVoo =
    estadoCompact.fase === 'compactando' || estadoCompact.fase === 'concluindo';

  useEffect(() => {
    if (aberto) return;
    setEstado((atual) => (atual?.fase === 'confirmando' ? null : atual));
    if (timer.current) clearTimeout(timer.current);
  }, [aberto]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function faseDe(comando: Comando): FaseComando {
    if (comando.id === 'compact' && compactEmVoo) return 'aguardando';
    return estado?.id === comando.id ? estado.fase : 'ocioso';
  }

  async function acionar(comando: Comando) {
    // Um envio em voo trava os TRÊS botões, não só o clicado: o back serializa
    // a colagem no tmux, e dois comandos disputando o mesmo pane chegariam
    // embaralhados no campo do agente.
    if (estado?.fase === 'enviando') return;
    if (comandoInerte(faseDe(comando))) return;

    // Primeiro toque ARMA quem precisa de confirmação. Tocar em outro comando
    // rearma para o novo — o dedo mudou de ideia, não precisa de um toque só
    // para cancelar.
    if (comando.confirma && (estado?.id !== comando.id || estado.fase !== 'confirmando')) {
      setFalha(null);
      setEstado({ id: comando.id, fase: 'confirmando' });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setEstado((atual) => (atual?.fase === 'confirmando' ? null : atual));
      }, CONFIRMA_ACAO_MS);
      return;
    }

    if (timer.current) clearTimeout(timer.current);
    setFalha(null);
    setEstado({ id: comando.id, fase: 'enviando' });
    // Antes do POST, e não depois: ver o cabeçalho.
    if (comando.id === 'compact') iniciarCompact();
    try {
      await postAgentInput(agentSlug, comando.comando);
      setEstado({ id: comando.id, fase: 'entregue' });
      timer.current = setTimeout(() => setEstado(null), RECIBO_MS);
    } catch (erro) {
      // O POST não foi aceito: o compact não existe e a espera morre junto —
      // deixá-la de pé travaria o composer por seis minutos por causa de um
      // comando que nunca saiu.
      if (comando.id === 'compact') cancelarCompact();
      setEstado(null);
      setFalha(diagnosticaComando(erro, comando));
    }
  }

  const armado = estado?.fase === 'confirmando' ? COMANDOS.find((c) => c.id === estado.id) : null;

  return (
    <section
      aria-label="comandos"
      className="flex shrink-0 flex-col border-b"
      style={{
        gap: 'var(--ck-space-2)',
        padding: 'var(--ck-space-4)',
        // O mesmo fio de luz que separa as ações rápidas da cota — separador
        // dentro de superfície flutuante é `edge-light`, nunca o hairline (§17).
        borderColor: 'var(--ck-edge-light)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--ck-text-xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--ck-track-overline)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        Comandos
      </span>

      <div className="flex" style={{ gap: 'var(--ck-space-2)' }}>
        {COMANDOS.map((comando) => {
          const fase = faseDe(comando);
          const inerte = comandoInerte(fase);
          return (
            <button
              key={comando.id}
              type="button"
              onClick={() => void acionar(comando)}
              aria-busy={fase === 'enviando'}
              aria-disabled={inerte}
              // Fora do ocioso o rótulo já é a frase inteira — ver
              // `descreveComando`. Estático aqui esconderia "Confirmar?" e
              // "Compactando…" de quem não vê a tela (WCAG 2.5.3).
              aria-label={descreveComando(comando, fase)}
              title={comando.descricao}
              className="ck-veil flex flex-1 items-center justify-center overflow-hidden border"
              style={{
                minHeight: 'var(--ck-touch-min)',
                padding: '0 var(--ck-space-2)',
                borderRadius: 'var(--ck-radius-frame)',
                borderColor: 'var(--ck-edge-functional)',
                fontSize: 'var(--ck-text-sm)',
                whiteSpace: 'nowrap',
                // A PALAVRA muda junto com a cor, nunca a cor sozinha (§3/§9.7).
                color:
                  fase === 'confirmando'
                    ? 'var(--ck-state-attention)'
                    : fase === 'entregue'
                      ? 'var(--ck-state-ok)'
                      : inerte
                        ? 'var(--ck-text-secondary)'
                        : 'var(--ck-text-primary)',
                transition: 'color var(--ck-dur-fast) var(--ck-ease)',
              }}
            >
              {rotulaComando(comando, fase)}
            </button>
          );
        })}
      </div>

      {armado?.aviso ? (
        // Largura cheia da gaveta: a frase que diz o que se perde não cabe nos
        // ~110px do botão, e o rótulo lá dentro é sempre o curto "Confirmar?".
        <p role="status" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}>
          {armado.aviso}
        </p>
      ) : null}

      {falha ? (
        <div className="flex items-start justify-between" style={{ gap: 'var(--ck-space-3)' }} role="alert">
          <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}>
            {falha.resumo} — {falha.saida}
          </span>
          <button
            type="button"
            onClick={() => setFalha(null)}
            aria-label="Dispensar aviso"
            className="ck-veil flex shrink-0 items-center justify-center"
            style={{
              minHeight: 'var(--ck-touch-min)',
              minWidth: 'var(--ck-touch-min)',
              borderRadius: 'var(--ck-radius-chip)',
              color: 'var(--ck-text-secondary)',
            }}
          >
            <IconeDescartar tamanho={13} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
