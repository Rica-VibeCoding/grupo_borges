/**
 * O miolo da tela Abertos para uma máquina: o cartão de desempenho (o mesmo
 * desenho do cartão da VPS, mais a temperatura), a linha "Tela" e a lista do
 * que está aberto.
 *
 * Ciclo próprio de 10 s, só com a tela aberta e a aba visível — o mesmo
 * `setInterval` + `visibilitychange` do `usa-recursos-locais`. Não usa o resumo
 * compartilhado de 30 s (`usa-resumo-da-maquina`): aqui o Rica está olhando e
 * acabou de fechar alguma coisa, 30 s seria velho.
 *
 * Leitura que falha DEPOIS da primeira mantém a última na tela, como no cartão
 * da VPS. Máquina fora do ar não inventa número: barras vazias e o motivo.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useEffect, useState } from 'react';

import { BarraDeMedida } from '@/components/shell/barra-de-medida';
import { IconeCursor } from '@/components/shell/icones';
import { emAlerta, formataTamanho, fracaoDaBarra } from '@/components/shell/recursos-da-vps';
import {
  fetchAbertos,
  fetchResumo,
  temperaturaEmAlerta,
  textoDaTela,
  type Abertos,
  type ItemAberto,
  type Resumo,
  type ResumoOnline,
} from '@/lib/maquinas';

import { ListaDeAbertos } from './lista-de-abertos';

const INTERVALO_MS = 10_000;
/** Quanto o "Liberou" fica: menos que um ciclo, então a linha sai no seguinte. */
const MOSTRA_LIBEROU_MS = 8_000;

export type Liberados = Record<string, { item: ItemAberto; mb: number; ate: number }>;

export type LeituraDosAbertos = { abertos: Abertos } | { falha: string } | null;

export function PainelDaMaquina({
  id,
  nome,
  nomeNoCartao,
}: {
  id: string;
  nome: string;
  /** Uma máquina só: sem trilho de abas, o nome vira o cabeçalho do cartão. */
  nomeNoCartao: boolean;
}) {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [abertos, setAbertos] = useState<LeituraDosAbertos>(null);
  // O que acabou de fechar fica na lista com o "Liberou" por um tempo fixo: a
  // releitura que chega logo depois (a do ciclo, ou a da aba voltando a ficar
  // visível) já não traz o item, e sem isto o recado sumiria no mesmo instante.
  const [liberados, setLiberados] = useState<Liberados>({});

  useEffect(() => {
    let vivo = true;
    let emVoo = false;
    const le = () => {
      if (document.hidden || emVoo) return;
      emVoo = true;
      Promise.allSettled([
        fetchResumo(id).then((novo) => vivo && setResumo(novo)),
        fetchAbertos(id).then(
          (novo) => vivo && setAbertos({ abertos: novo }),
          (erro: Error) => vivo && setAbertos({ falha: erro.message }),
        ),
      ]).finally(() => {
        emVoo = false;
      });
    };
    le();
    const ronda = window.setInterval(le, INTERVALO_MS);
    document.addEventListener('visibilitychange', le);
    return () => {
      vivo = false;
      window.clearInterval(ronda);
      document.removeEventListener('visibilitychange', le);
    };
  }, [id]);

  const online = resumo?.online ? resumo : null;
  const fora = resumo && !resumo.online ? resumo : null;

  return (
    <>
      <section
        aria-label={`Desempenho: ${nome}`}
        className="ck-vps ck-vps-tom flex flex-col"
        style={{ gap: 'var(--ck-space-3)', padding: 'var(--ck-space-3) var(--ck-space-4)' }}
      >
        {nomeNoCartao ? (
          <div className="flex items-baseline" style={{ gap: 'var(--ck-space-2)', minHeight: '24px' }}>
            <h2 style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>{nome}</h2>
            <span
              className="ck-tabular ml-auto min-w-0 truncate"
              style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
            >
              {online ? `${formataTamanho(online.ram.livre_mb)} de RAM livres` : '\u00a0'}
            </span>
          </div>
        ) : null}

        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--ck-space-3) var(--ck-space-4)' }}
        >
          <Medidas dados={online} />
        </div>

        <p
          role="status"
          className="flex items-center"
          style={{
            gap: 'var(--ck-space-2)',
            minHeight: '24px',
            fontSize: 'var(--ck-text-sm)',
            color: online?.tela.em_uso ? 'var(--ck-text-primary)' : 'var(--ck-text-secondary)',
          }}
        >
          {fora ? (
            `${nomeNoCartao ? 'Fora do ar' : `${nome} fora do ar`}: ${fora.motivo}. Tento de novo sozinho.`
          ) : online ? (
            <>
              <IconeCursor tamanho={16} className="shrink-0" />
              {textoDaTela(online.tela)}
            </>
          ) : (
            ' '
          )}
        </p>
      </section>

      {/* Fora do ar não há lista: o motivo já está no cartão de cima. */}
      {fora ? null : (
      <ListaDeAbertos
        maquina={id}
        leitura={abertos}
        liberados={liberados}
        aoFechar={(item, mb) =>
          setLiberados((antes) => ({ ...antes, [item.id]: { item, mb, ate: Date.now() + MOSTRA_LIBEROU_MS } }))
        }
      />
      )}
    </>
  );
}

function Medidas({ dados }: { dados: ResumoOnline | null }) {
  const temperatura = dados?.temperatura_c ?? null;
  const pct = (valor: number | null) => (valor === null ? null : `${Math.round(valor)}%`);
  return (
    <>
      <BarraDeMedida
        medida="cpu"
        rotulo="CPU"
        valor={pct(dados?.cpu_pct ?? null)}
        pct={dados?.cpu_pct ?? null}
        fracao={fracaoDaBarra(dados?.cpu_pct ?? null)}
        alerta={emAlerta('cpu', dados?.cpu_pct ?? null)}
        detalhe={dados ? 'uso do processador' : 'sem leitura ainda'}
      />
      <BarraDeMedida
        medida="ram"
        rotulo="RAM"
        valor={pct(dados?.ram.pct ?? null)}
        pct={dados?.ram.pct ?? null}
        fracao={fracaoDaBarra(dados?.ram.pct ?? null)}
        alerta={emAlerta('ram', dados?.ram.pct ?? null)}
        detalhe={
          dados ? `${formataTamanho(dados.ram.usado_mb)} de ${formataTamanho(dados.ram.total_mb)}` : 'sem leitura ainda'
        }
      />
      <BarraDeMedida
        medida="disco"
        rotulo="Disco"
        valor={pct(dados?.disco.pct ?? null)}
        pct={dados?.disco.pct ?? null}
        fracao={fracaoDaBarra(dados?.disco.pct ?? null)}
        alerta={emAlerta('disco', dados?.disco.pct ?? null)}
        detalhe={
          dados
            ? `${formataTamanho(dados.disco.livre_mb)} livres de ${formataTamanho(dados.disco.total_mb)}`
            : 'sem leitura ainda'
        }
      />
      {/* Barra de 0 a 100 °C: o pacote do processador desliga perto disso. */}
      <BarraDeMedida
        medida="temperatura"
        rotulo="Temperatura"
        valor={temperatura === null ? null : `${Math.round(temperatura)} °C`}
        textoAcessivel={temperatura === null ? undefined : `${Math.round(temperatura)} °C`}
        pct={temperatura}
        fracao={fracaoDaBarra(temperatura)}
        alerta={temperaturaEmAlerta(temperatura)}
        detalhe={dados ? (temperatura === null ? 'sem sensor' : 'processador') : 'sem leitura ainda'}
      />
    </>
  );
}
