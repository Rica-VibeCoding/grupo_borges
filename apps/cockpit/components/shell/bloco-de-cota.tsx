'use client';

/**
 * BlocoDeCota — quanto da cota já foi gasto, janela por janela (5h e 7d em
 * todo mundo; mais a do mês em quem tem teto mensal).
 *
 * O dado já chegava: o `/painel` devolve `quotas` e o `BlocoDeAcoes` guardava a
 * resposta inteira sem ler esse campo. Até 07/08 só o v1 congelado desenhava
 * isso, então o painel novo mostrava controle e escondia consumo.
 *
 * Fica FORA do `<section aria-label="ações rápidas">`, como irmão: cota é
 * leitura, não ação, e um bloco de informação dentro de um grupo chamado
 * "ações" mente pra quem navega por região. Fica DEPOIS dos controles e ANTES
 * dos seis campos de detalhe — a ordem da gaveta é ação, estado, ficha.
 *
 * ## Por que `role="meter"` e não `progressbar`
 *
 * A APG diz que o `meter` **não** serve pra progresso ("The `meter` should not
 * be used to indicate progress, such as loading or percent completion of a
 * task") e que precisa de máximo com sentido ("should not be used to represent
 * a value like the current world population since it does not have a meaningful
 * maximum limit"). Cota usada é o caso bom: 100% é um teto real do plano, e o
 * número não é o andamento de tarefa nenhuma — é o mesmo caso da bateria, o
 * exemplo da própria página.
 *
 * **Onde o v1 está errado** (`apps/web/components/quotas-bloco.tsx:31-38`): ele
 * usa `role="meter"` com `aria-valuemin/max/now` e NENHUM nome acessível. O
 * `meter` é "name from author" — a APG exige `aria-labelledby` ou `aria-label`,
 * e o `<span>5h</span>` ao lado é irmão, não rótulo. Sem isso o leitor de tela
 * anuncia "71" sem dizer 71 do quê, duas vezes seguidas. O v1 também não põe
 * `aria-valuetext`, que a APG pede quando o percentual sozinho não é
 * compreensível — e "71" sozinho tanto pode ser o usado quanto o que sobra.
 * Aqui as duas coisas entram. O v1 está congelado; não corrigi lá.
 */
import { useState } from 'react';
import { postAgentQuotaRefresh } from '@grupo_borges/cockpit-core/api';
import type { PainelContexto, PainelQuotas } from '@grupo_borges/cockpit-core/cockpit-types';

import { leiaConta, leiaCota, leiaRodape, type JanelaDeCota, type RodapeDeCota } from './cota';
import { IconeReenviar } from './icones';
import { SeletorDeConta } from './seletor-conta';

function Barra({ janela }: { janela: JanelaDeCota }) {
  return (
    <div className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
      <span
        style={{
          fontSize: 'var(--ck-text-xs)',
          color: 'var(--ck-text-secondary)',
          minWidth: '2ch',
        }}
      >
        {janela.rotulo}
      </span>

      {janela.pct === null ? (
        <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>
          {janela.reset}
        </span>
      ) : (
        <>
          <div
            role="meter"
            aria-label={janela.nome}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={janela.pct}
            aria-valuetext={janela.valorFalado}
            className="flex-1 overflow-hidden"
            style={{
              height: '4px',
              borderRadius: 'var(--ck-radius-pill)',
              background: 'var(--ck-surface-composer)',
            }}
          >
            <div
              style={{
                width: `${janela.pct}%`,
                height: '100%',
                background: 'var(--ck-text-secondary)',
              }}
            />
          </div>
          {/* O número é o dado; a barra é o resumo. Se a barra sumisse (cor
              perdida, tela ruim), o percentual sozinho ainda responde. */}
          <span
            style={{
              fontSize: 'var(--ck-text-xs)',
              color: 'var(--ck-text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {janela.pct}%
          </span>
          <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>
            · {janela.reset}
          </span>
        </>
      )}
    </div>
  );
}

type FaseRefresh = 'ocioso' | 'enviando' | 'falhou';

/**
 * Força o CC a reconsultar a cota — mesmo `/usage` + `r` que o Rica aciona à
 * mão (ver `postAgentQuotaRefresh`). Só aparece junto do aviso "dados
 * antigos": não há o que atualizar numa leitura que já está viva.
 *
 * A tela só reflete o valor novo na PRÓXIMA vez que a statusline do CC
 * escrever o arquivo — não é instantâneo mesmo quando o back confirma
 * `refreshed: true`. As duas rebuscas escalonadas depois do sucesso dão mais
 * chance de pegar essa escrita sem o Rica precisar reabrir a gaveta; nenhuma
 * delas bloqueia o botão, que já volta ao normal.
 */
function BotaoAtualizarCota({
  agentSlug,
  aoAtualizar,
}: {
  agentSlug: string;
  aoAtualizar?: () => void;
}) {
  const [fase, setFase] = useState<FaseRefresh>('ocioso');

  async function atualizar() {
    if (fase === 'enviando') return;
    setFase('enviando');
    try {
      const resposta = await postAgentQuotaRefresh(agentSlug);
      setFase(resposta.refreshed ? 'ocioso' : 'falhou');
      if (resposta.refreshed) {
        aoAtualizar?.();
        window.setTimeout(() => aoAtualizar?.(), 1_500);
        window.setTimeout(() => aoAtualizar?.(), 3_500);
      }
    } catch {
      setFase('falhou');
    }
  }

  return (
    <button
      type="button"
      onClick={() => void atualizar()}
      disabled={fase === 'enviando'}
      aria-busy={fase === 'enviando'}
      aria-label="Forçar atualização da cota"
      title={
        fase === 'falhou'
          ? 'não consegui atualizar — tente de novo'
          : 'Forçar atualização da cota'
      }
      className="ck-veil flex shrink-0 items-center justify-center"
      style={{
        width: '18px',
        height: '18px',
        borderRadius: '9999px',
        color: fase === 'falhou' ? 'var(--ck-state-attention)' : 'var(--ck-text-tertiary)',
      }}
    >
      <IconeReenviar tamanho={11} />
    </button>
  );
}

/**
 * A linha de baixo: quem é a sessão e quanto está dentro da janela.
 *
 * Fica no card da cota porque responde a mesma pergunta por outro ângulo — a
 * cota diz quanto do plano foi gasto, o rodapé diz o que está custando agora.
 */
function Rodape({ rodape }: { rodape: RodapeDeCota }) {
  return (
    <div
      className="flex items-center justify-between border-t"
      style={{
        gap: 'var(--ck-space-2)',
        paddingTop: 'var(--ck-space-2)',
        marginTop: 'var(--ck-space-1)',
        borderColor: 'var(--ck-edge-light)',
        fontSize: 'var(--ck-text-xs)',
      }}
    >
      <span className="truncate" style={{ color: 'var(--ck-text-secondary)' }}>
        {rodape.sessao ?? 'sessão sem nome'}
        {rodape.cruzou200k ? (
          // A PALAVRA carrega o estado, não a cor. Passar de 200k não encarece
          // nada na assinatura — o que muda é a variante de modelo que o CC
          // resolve, e é isso que a marca avisa.
          <span style={{ color: 'var(--ck-text-tertiary)' }}> · 200k+</span>
        ) : null}
      </span>
      {rodape.entrada !== null && rodape.saida !== null ? (
        <span
          className="shrink-0"
          style={{ color: 'var(--ck-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}
        >
          <span aria-hidden="true">{rodape.entrada} ↑</span>
          <span className="sr-only">{rodape.entrada} de entrada</span>
          {'  '}
          <span aria-hidden="true">{rodape.saida} ↓</span>
          <span className="sr-only">, {rodape.saida} de saída</span>
        </span>
      ) : null}
    </div>
  );
}

export function BlocoDeCota({
  quotas,
  contexto,
  agentSlug,
  aoAtualizar,
}: {
  quotas: PainelQuotas | null | undefined;
  contexto?: PainelContexto | null;
  agentSlug: string;
  aoAtualizar?: () => void;
}) {
  const leitura = leiaCota(quotas);
  const conta = leiaConta(quotas);
  const rodape = leiaRodape(contexto);

  return (
    <section
      aria-label="Cota usada"
      className="flex shrink-0 flex-col border-b"
      style={{
        gap: 'var(--ck-space-2)',
        padding: 'var(--ck-space-4)',
        borderColor: 'var(--ck-edge-light)',
      }}
    >
      <div className="flex items-center" style={{ gap: 'var(--ck-space-2)' }}>
        <span
          style={{
            fontSize: 'var(--ck-text-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ck-track-overline)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          Cota usada
        </span>
        {leitura.estado === 'velha' ? (
          <>
            {/* `role="status"`: a leitura envelhece sozinha entre duas
                aberturas do painel, e quem não vê a tela precisa ouvir que o
                número mudou de valia sem ter tocado em nada. */}
            <span
              role="status"
              style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}
            >
              {leitura.aviso}
            </span>
            <BotaoAtualizarCota agentSlug={agentSlug} aoAtualizar={aoAtualizar} />
          </>
        ) : null}

        {conta ? (
          // Encostada à direita, longe do título: é a ficha de quem paga, não
          // um estado do agente. O `ml-auto` come a folga que sobrar.
          //
          // Desde 18/08 a pílula é o SELETOR: tocar abre a troca da conta da
          // máquina inteira (nunca "deste agente"). O desenho da pílula —
          // cinza neutro um degrau acima da gaveta, `ck-lit` no topo — mora no
          // gatilho do seletor e não mudou.
          <SeletorDeConta contaDoPainel={conta} aoTrocou={aoAtualizar} />
        ) : null}
      </div>

      {leitura.estado === 'sem-dado' ? (
        <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>
          {leitura.recado}
        </span>
      ) : (
        leitura.janelas.map((janela) => <Barra key={janela.rotulo} janela={janela} />)
      )}

      {rodape ? <Rodape rodape={rodape} /> : null}
    </section>
  );
}
