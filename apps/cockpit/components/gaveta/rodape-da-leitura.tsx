'use client';

/**
 * O rodapé da leitura (rodada 2): ⭐, Concluída, Renomear e 🗑 numa fileira sem
 * moldura, em cinza; embaixo, o Continuar esta — claro parado, âmbar com a
 * linha "fulano está trabalhando" quando vai interromper. Um toque age.
 *
 * No lugar da fileira entram, um por vez: a barra da espera, a confirmação de
 * uma linha do 🗑, o erro e o campo de renomear. O estado da troca vem da
 * máquina (`acoes-de-conversa.ts`) e só aparece aqui quando é desta conversa.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { motion } from 'motion/react';

import type { Conversa } from '@grupo_borges/cockpit-core/api';

import { IconeEstrela, IconeLixeira } from '../shell/icones';
import { AvisoDeFalha, BotaoDeTroca, ConfirmaExclusao } from './acao-de-conversa';
import { ondeMostra, textoDaEspera, textoDaTroca, type EstadoDaAcao } from './acoes-de-conversa';
import { Pilula } from './pecas';
import { COM_MOLA } from './ritmo-do-historico';

function AcaoDiscreta({ children, rotulo, pressionada, cor, aoTocar }: { children: ReactNode; rotulo: string; pressionada?: boolean; cor?: string; aoTocar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoTocar}
      aria-label={rotulo}
      aria-pressed={pressionada}
      className="ck-veil flex flex-1 items-center justify-center"
      style={{ gap: '6px', minHeight: 'var(--ck-touch-min)', borderRadius: 'var(--ck-radius-pill)', fontSize: 'var(--ck-text-sm)', color: cor ?? 'var(--ck-text-secondary)', whiteSpace: 'nowrap' }}
    >
      {children}
    </button>
  );
}

function Renomear({ inicial, aoSalvar, aoCancelar }: { inicial: string; aoSalvar: (titulo: string) => Promise<void>; aoCancelar: () => void }) {
  const [titulo, setTitulo] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salva = () => {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    aoSalvar(titulo.trim()).catch((e: unknown) => {
      setErro(`O nome não ficou: ${e instanceof Error ? e.message : String(e)}`);
      setSalvando(false);
    });
  };
  return (
    <form
      className="flex flex-col"
      style={{ gap: 'var(--ck-space-2)' }}
      onSubmit={(e) => {
        e.preventDefault();
        salva();
      }}
    >
      <input
        autoFocus
        value={titulo}
        maxLength={200}
        onChange={(e) => setTitulo(e.target.value)}
        aria-label="Novo nome da conversa"
        className="w-full bg-transparent outline-none"
        style={{ minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-4)', borderRadius: 'var(--ck-radius-pill)', background: 'var(--ck-gv-bloco)', fontSize: 'var(--ck-text-md)', color: 'var(--ck-text-primary)' }}
      />
      {erro ? (
        <p role="alert" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-attention)' }}>
          {erro}
        </p>
      ) : null}
      <div className="flex" style={{ gap: 'var(--ck-space-2)' }}>
        <Pilula aoTocar={aoCancelar}>Cancelar</Pilula>
        <Pilula aoTocar={salva} ocupado={salvando}>
          {salvando ? 'Salvando…' : 'Salvar nome'}
        </Pilula>
      </div>
    </form>
  );
}

export function RodapeDaLeitura({
  conversa,
  estado,
  nome,
  interrompe,
  podeTrocar,
  porQueNao,
  falha,
  aoContinuar,
  aoEstrela,
  aoConcluida,
  aoRenomear,
  aoExcluir,
  aoConfirmar,
  aoLargar,
  aoFecharFalha,
}: {
  conversa: Conversa;
  estado: EstadoDaAcao;
  nome: string;
  /** O toque vai interromper um turno: o botão diz que interrompe. */
  interrompe: boolean;
  podeTrocar: boolean;
  porQueNao: string | null;
  /** Erro de ⭐, Concluída — o que não passa pela máquina de troca. */
  falha: string | null;
  aoContinuar: () => void;
  aoEstrela: () => void;
  aoConcluida: () => void;
  aoRenomear: (titulo: string) => Promise<void>;
  aoExcluir: () => void;
  aoConfirmar: () => void;
  aoLargar: () => void;
  aoFecharFalha: () => void;
}) {
  const [renomeando, setRenomeando] = useState(false);
  const [pulsos, setPulsos] = useState(0);
  const daqui = ondeMostra(estado) === conversa.id;

  const espera = daqui && (estado.fase === 'esperando' || estado.fase === 'conferindo') ? textoDaEspera(estado.troca, nome) : null;
  if (espera) {
    const etapa = estado.fase === 'esperando' ? estado.etapa : 'conferindo';
    return <BotaoDeTroca rotulo={espera} rotuloInterrompe={espera} interrompe={false} espera={espera} etapa={etapa} aoTocar={aoContinuar} />;
  }
  if (daqui && (estado.fase === 'confirmando-exclusao' || estado.fase === 'excluindo')) {
    return <ConfirmaExclusao indo={estado.fase === 'excluindo'} aoExcluir={aoConfirmar} aoCancelar={aoLargar} />;
  }
  if (daqui && estado.fase === 'falhou') return <AvisoDeFalha texto={estado.texto} aoFechar={aoLargar} />;
  if (falha) return <AvisoDeFalha texto={falha} aoFechar={aoFecharFalha} />;
  if (renomeando) {
    return (
      <Renomear
        inicial={conversa.titulo}
        aoCancelar={() => setRenomeando(false)}
        aoSalvar={async (titulo) => {
          await aoRenomear(titulo);
          setRenomeando(false);
        }}
      />
    );
  }

  const livre = podeTrocar && !conversa.bloqueada;
  return (
    <>
      <div className="flex" style={{ gap: 'var(--ck-space-1)' }}>
        <AcaoDiscreta
          rotulo={conversa.estrela ? 'Tirar dos especiais' : 'Marcar como especial'}
          pressionada={conversa.estrela}
          cor={conversa.estrela ? 'var(--ck-gv-ativo-texto)' : undefined}
          aoTocar={() => {
            setPulsos((p) => p + 1);
            aoEstrela();
          }}
        >
          <motion.span key={pulsos} className="flex" initial={pulsos > 0 ? { scale: 0.6 } : false} animate={{ scale: 1 }} transition={COM_MOLA}>
            <IconeEstrela tamanho={17} />
          </motion.span>
          {conversa.estrela ? 'Especial' : null}
        </AcaoDiscreta>
        <AcaoDiscreta rotulo={conversa.concluida ? 'Reabrir conversa' : 'Marcar como concluída'} aoTocar={aoConcluida}>
          {conversa.concluida ? 'Reabrir' : 'Concluída'}
        </AcaoDiscreta>
        <AcaoDiscreta rotulo="Renomear" aoTocar={() => setRenomeando(true)}>
          Renomear
        </AcaoDiscreta>
        {livre ? (
          <AcaoDiscreta rotulo="Excluir conversa" aoTocar={aoExcluir}>
            <IconeLixeira tamanho={17} />
          </AcaoDiscreta>
        ) : null}
      </div>
      {livre ? (
        <BotaoDeTroca rotulo={textoDaTroca('retomar', false)} rotuloInterrompe={textoDaTroca('retomar', true)} interrompe={interrompe} espera={null} aoTocar={aoContinuar} />
      ) : porQueNao && !conversa.bloqueada ? (
        <p className="text-center" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)', padding: 'var(--ck-space-1) 0' }}>
          {porQueNao}
        </p>
      ) : null}
    </>
  );
}
