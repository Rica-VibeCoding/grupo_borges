/**
 * A aba da máquina local na tela Abertos — a que o próprio cockpit mede (a VPS
 * no cockpit da VPS). Os quatro números do antigo cartão da tropa e quem mais
 * consome, que antes ficava atrás da pílula "processos".
 *
 * SÓ LEITURA: nenhum Fechar, nada que pareça fechar. Nesta máquina rodam os
 * agentes e o próprio cockpit (decisão do Pavan, 05/11).
 *
 * Lê o `/api/vps` compartilhado com a linha da tropa (`usa-recursos-locais`).
 *
 * Dono: Daniel (pele).
 */
'use client';

import { BarraDeMedida } from '@/components/shell/barra-de-medida';
import { usaFrota } from '@/components/shell/frota-provider';
import {
  descreve,
  emAlerta,
  formataCarga,
  formataNoAr,
  formataTamanho,
  fracaoDaBarra,
  linhasDeVilao,
  linhasDoCartao,
  nomeLegivel,
  swapEmTroca,
  type Medida,
  type RecursosDaVps,
} from '@/components/shell/recursos-da-vps';
import { temperaturaEmAlerta } from '@/lib/maquinas';

import { usaRecursosLocais } from './usa-recursos-locais';

const SECUNDARIO_XS = { fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' } as const;

function pctDe(medida: Medida, dados: RecursosDaVps): number | null {
  switch (medida) {
    case 'cpu':
      return dados.cpu_pct;
    case 'ram':
      return dados.ram.pct;
    case 'swap':
      return dados.swap?.pct ?? null;
    case 'disco':
      return dados.disco.pct;
    case 'temperatura':
      return dados.temperatura_c;
  }
}

/** Uma medida; a swap acende pela troca, a temperatura pelo teto dela, o resto pelo `TETO_PCT`. */
function Medidor({ medida, rotulo, dados }: { medida: Medida; rotulo: string; dados: RecursosDaVps }) {
  const pct = pctDe(medida, dados);
  const graus = medida === 'temperatura';
  const alerta =
    medida === 'swap' ? swapEmTroca(dados) : medida === 'temperatura' ? temperaturaEmAlerta(pct) : emAlerta(medida, pct);
  return (
    <BarraDeMedida
      medida={medida}
      rotulo={rotulo}
      valor={pct === null ? null : `${Math.round(pct)}${graus ? ' °C' : '%'}`}
      textoAcessivel={graus && pct !== null ? `${Math.round(pct)} °C` : undefined}
      pct={pct}
      fracao={fracaoDaBarra(pct)}
      alerta={alerta}
      detalhe={descreve(medida, dados)}
    />
  );
}

export function PainelLocal({ nome, nomeNoCartao }: { nome: string; nomeNoCartao: boolean }) {
  const local = usaRecursosLocais();
  const { agents } = usaFrota();
  const dados = local?.dados ?? null;
  const processos = dados ? linhasDeVilao(dados) : [];

  return (
    <>
      <section
        aria-label={`Desempenho: ${nome}`}
        className="ck-vps flex flex-col"
        style={{ gap: 'var(--ck-space-3)', padding: 'var(--ck-space-3) var(--ck-space-4)' }}
      >
        {/* Com abas, o nome já está na aba: o cartão começa direto nas barras. */}
        {nomeNoCartao ? (
          <h2 style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600, color: 'var(--ck-text-primary)', minHeight: '24px' }}>
            {nome}
          </h2>
        ) : null}

        {/* Antes da 1ª leitura, traços sem rótulo na altura da grade: montar
            a Swap e trocar pela Temperatura piscaria um rótulo. */}
        <div
          className="grid"
          aria-hidden={dados ? undefined : true}
          style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--ck-space-3) var(--ck-space-4)' }}
        >
          {dados && local
            ? linhasDoCartao(local.comSensor).map((l) => (
                <Medidor key={l.medida} medida={l.medida} rotulo={l.rotulo} dados={dados} />
              ))
            : Array.from({ length: 4 }, (_, i) => (
                <BarraDeMedida
                  key={i}
                  medida="reservada"
                  rotulo={'\u00a0'}
                  valor={null}
                  pct={null}
                  fracao={0}
                  alerta={false}
                  detalhe="sem leitura ainda"
                />
              ))}
        </div>

        <p className="ck-tabular" style={{ ...SECUNDARIO_XS, minHeight: '24px' }}>
          {dados
            ? `no ar ${formataNoAr(dados.no_ar_segundos)} · carga ${formataCarga(dados.carga_1m)} · ${formataTamanho(dados.disco.livre_mb)} livres`
            : '\u00a0'}
        </p>
      </section>

      <section
        className="ck-vps flex flex-col"
        style={{ gap: 'var(--ck-space-2)', padding: 'var(--ck-space-3) var(--ck-space-4)', minHeight: '160px' }}
      >
        {processos.length > 0 ? (
          <div
            role="table"
            aria-label="Quem mais consome"
            className="ck-tabular grid items-baseline"
            style={{
              gridTemplateColumns: 'minmax(0, 1fr) auto auto',
              gap: 'var(--ck-space-2) var(--ck-space-4)',
              fontSize: 'var(--ck-text-sm)',
              color: 'var(--ck-text-secondary)',
            }}
          >
            <div role="row" className="contents">
              <span role="columnheader" style={{ fontSize: 'var(--ck-text-xs)' }}>Quem mais consome</span>
              <span role="columnheader" style={{ fontSize: 'var(--ck-text-xs)', textAlign: 'right' }}>CPU</span>
              <span role="columnheader" style={{ fontSize: 'var(--ck-text-xs)', textAlign: 'right' }}>RAM</span>
            </div>
            {processos.map((p) => (
              <div key={p.nome} role="row" className="contents">
                <span role="cell" style={{ color: 'var(--ck-text-primary)', overflowWrap: 'anywhere' }} title={p.nome}>
                  {nomeLegivel(p.nome, agents)}
                </span>
                <span role="cell" style={{ textAlign: 'right' }}>{p.cpu ?? '—'}</span>
                <span role="cell" style={{ textAlign: 'right' }}>{p.ram ?? '—'}</span>
              </div>
            ))}
          </div>
        ) : null}
        {/* Só leitura, e a tela diz por quê: aqui não há Fechar. */}
        <p style={{ ...SECUNDARIO_XS, marginTop: 'auto', paddingTop: 'var(--ck-space-1)' }}>
          Daqui só se olha: é a máquina onde este cockpit roda.
        </p>
      </section>
    </>
  );
}
