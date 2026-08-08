'use client';

/**
 * BlocoDeCota — quanto da cota já foi gasto, nas duas janelas (5h e 7d).
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
import type { PainelQuotas } from '@grupo_borges/cockpit-core/cockpit-types';

import { leiaCota, type JanelaDeCota } from './cota';

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

export function BlocoDeCota({ quotas }: { quotas: PainelQuotas | null | undefined }) {
  const leitura = leiaCota(quotas);

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
          // `role="status"`: a leitura envelhece sozinha entre duas aberturas do
          // painel, e quem não vê a tela precisa ouvir que o número mudou de
          // valia sem ter tocado em nada.
          <span
            role="status"
            style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-attention)' }}
          >
            {leitura.aviso}
          </span>
        ) : null}
      </div>

      {leitura.estado === 'sem-dado' ? (
        <span style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>
          {leitura.recado}
        </span>
      ) : (
        leitura.janelas.map((janela) => <Barra key={janela.rotulo} janela={janela} />)
      )}
    </section>
  );
}
