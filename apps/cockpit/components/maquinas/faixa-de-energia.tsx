/**
 * A faixa de energia no topo da aba de uma máquina na tela Abertos (Rica, 05/11
 * 14:59): o estado (Ligado, Desligado, Ligando…, Desligando…) e UM botão —
 * Desligar ou Ligar. Ligar sem caminho fica desabilitado com o motivo escrito
 * ao lado, nunca escondido.
 *
 * O Desligar não age no primeiro toque: abre, na própria faixa, o que cai junto
 * (quantos agentes e Chromes, numa linha só); quem desliga é o "Desligar <nome>", em
 * `state-fail`, ao lado do Cancelar. Nada de botão perigoso solto.
 *
 * `AbaComEnergia` decide o resto da aba: desligada, a máquina não tem números
 * nem lista — a faixa diz "Desligado" e basta.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';

import {
  energiaDe,
  faixaDaEnergia,
  fetchImpacto,
  postDesligar,
  postLigar,
  textoDoImpacto,
  type EnergiaMaquina,
  type Impacto,
} from '@/lib/energia';

import { PilulaDaMaquina } from './linha-aberta';
import { releEnergia, usaEnergia } from './usa-energia';

const SECUNDARIO_XS = { fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' } as const;

export function AbaComEnergia({ id, nome, children }: { id: string; nome: string; children?: ReactNode }) {
  const energia = usaEnergia();
  const e = energiaDe({ id, nome }, energia);
  // Sem leitura ainda (ou API sem esta máquina): a aba segue como antes.
  // Desligando também esconde: os números de uma máquina caindo mentem.
  const desligada = e !== null && (!e.ligado || e.em_andamento === 'desligando');
  return (
    <>
      {energia === null ? <FaixaReservada /> : e ? <Faixa e={e} /> : null}
      {desligada ? null : children}
    </>
  );
}

function FaixaReservada() {
  return <div aria-hidden className="ck-vps" style={{ minHeight: 'calc(var(--ck-touch-min) + var(--ck-space-2) * 2)' }} />;
}

/** O ponto do estado: cheio e verde ligado, oco desligado, no tom de quem age em curso. */
function Ponto({ estado }: { estado: string }) {
  const cor =
    estado === 'Ligado' ? 'var(--ck-state-ok)' : estado === 'Desligado' ? 'var(--ck-text-secondary)' : 'var(--ck-state-running)';
  const cheio = estado !== 'Desligado';
  return (
    <span
      aria-hidden
      className="shrink-0 rounded-full"
      style={{
        width: '8px',
        height: '8px',
        background: cheio ? cor : 'transparent',
        border: cheio ? undefined : `1.5px solid ${cor}`,
      }}
    />
  );
}

function Faixa({ e }: { e: EnergiaMaquina }) {
  // Pedido aceito e a leitura ainda sem `em_andamento`: a faixa já diz o que
  // vem e esconde o botão, para não dar um segundo toque no Desligar.
  const [pedido, setPedido] = useState<'desligar' | 'ligar' | null>(null);
  useEffect(() => setPedido(null), [e.ligado, e.em_andamento]);
  const faixa =
    pedido === null
      ? faixaDaEnergia(e)
      : faixaDaEnergia({ ...e, em_andamento: pedido === 'desligar' ? 'desligando' : 'ligando' });
  const [confirmando, setConfirmando] = useState(false);
  const [impacto, setImpacto] = useState<Impacto | 'lendo' | { falha: string }>('lendo');
  const [pedindo, setPedindo] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  async function abreConfirmacao() {
    setConfirmando(true);
    setFalha(null);
    setImpacto('lendo');
    try {
      setImpacto(await fetchImpacto(e.id));
    } catch (erro) {
      setImpacto({ falha: (erro as Error).message });
    }
  }

  async function age(acao: 'desligar' | 'ligar') {
    setPedindo(true);
    setFalha(null);
    try {
      await (acao === 'desligar' ? postDesligar(e.id) : postLigar(e.id));
      setConfirmando(false);
      setPedido(acao);
      releEnergia();
    } catch (erro) {
      setFalha(`${acao === 'desligar' ? 'Não desligou' : 'Não ligou'}: ${(erro as Error).message}`);
    } finally {
      setPedindo(false);
    }
  }

  return (
    <section
      aria-label={`Energia: ${e.nome}`}
      className="ck-vps flex flex-col"
      style={{ padding: 'var(--ck-space-2) var(--ck-space-4)' }}
    >
      <div className="flex items-center" style={{ gap: 'var(--ck-space-2)', minHeight: 'var(--ck-touch-min)' }}>
        <Ponto estado={faixa.estado} />
        <span role="status" style={{ fontSize: 'var(--ck-text-base)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>
          {faixa.estado}
        </span>
        <span className="ml-auto flex min-w-0 items-center" style={{ gap: 'var(--ck-space-2)' }}>
          {faixa.acao === 'ligar' && faixa.motivo ? (
            <span className="min-w-0 truncate" style={SECUNDARIO_XS}>
              {faixa.motivo}
            </span>
          ) : null}
          {faixa.acao === 'ligar' ? (
            <PilulaDaMaquina
              aria-label={faixa.motivo ? `Ligar ${e.nome}: ${faixa.motivo}` : `Ligar ${e.nome}`}
              disabled={faixa.motivo !== null || pedindo}
              aria-busy={pedindo}
              aoTocar={() => void age('ligar')}
            >
              {pedindo ? 'Ligando…' : 'Ligar'}
            </PilulaDaMaquina>
          ) : faixa.acao === 'desligar' && !confirmando ? (
            <PilulaDaMaquina aria-label={`Desligar ${e.nome}`} aoTocar={() => void abreConfirmacao()}>
              Desligar
            </PilulaDaMaquina>
          ) : null}
        </span>
      </div>

      {confirmando && faixa.acao === 'desligar' ? (
        <Confirmacao
          nome={e.nome}
          impacto={impacto}
          pedindo={pedindo}
          aoConfirmar={() => void age('desligar')}
          aoCancelar={() => setConfirmando(false)}
        />
      ) : null}

      {falha ? (
        <p role="alert" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-state-fail)', paddingBottom: 'var(--ck-space-2)' }}>
          {falha}
        </p>
      ) : null}
    </section>
  );
}

function Confirmacao({
  nome,
  impacto,
  pedindo,
  aoConfirmar,
  aoCancelar,
}: {
  nome: string;
  impacto: Impacto | 'lendo' | { falha: string };
  pedindo: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  const linhas = impacto !== 'lendo' && !('falha' in impacto) ? textoDoImpacto(impacto) : [];
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 'var(--ck-space-2)',
        padding: 'var(--ck-space-3) 0 var(--ck-space-1)',
        borderTop: '1px solid var(--ck-edge-hairline)',
      }}
    >
      <p style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>
        {impacto === 'lendo'
          ? 'Vendo o que cai junto…'
          : 'falha' in impacto
            ? `Não consegui ver o que cai junto: ${impacto.falha}.`
            : linhas.length > 0
              ? `Cai junto: ${linhas.join(' · ')}`
              : 'Nada roda nela agora.'}
      </p>
      <div className="flex flex-wrap items-center justify-end" style={{ gap: 'var(--ck-space-1)' }}>
        <button
          type="button"
          onClick={aoCancelar}
          className="ck-veil"
          style={{
            minHeight: 'var(--ck-touch-min)',
            padding: '0 var(--ck-space-3)',
            borderRadius: 'var(--ck-radius-pill)',
            fontSize: 'var(--ck-text-sm)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          Cancelar
        </button>
        <PilulaDaMaquina perigo disabled={pedindo || impacto === 'lendo'} aria-busy={pedindo} aoTocar={aoConfirmar}>
          {pedindo ? 'Desligando…' : `Desligar ${nome}`}
        </PilulaDaMaquina>
      </div>
    </div>
  );
}
