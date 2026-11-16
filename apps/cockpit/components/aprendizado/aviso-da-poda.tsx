'use client';

// O que fica no lugar de um aprendizado podado: o que aconteceu, dito sem
// mentir, e o Desfazer. Memória apagada já está no arquivo; skill é PEDIDO — a
// Faxina move em até 1 min, e só depois disso o Desfazer funciona (409 antes).

import Link from 'next/link';
import { useState } from 'react';

import { Botao } from '@/components/faxina/botao';
import { mensagemDeErro, nomeDoAgente, postDesfazer, tituloLegivel, type Poda } from '@/lib/aprendizado';

function frase(poda: Poda): string {
  if (poda.estado === 'apagada') return `Memória apagada. Saiu do índice e foi para o arquivo de ${nomeDoAgente(poda.agente)}.`;
  if (poda.estado === 'pedido') {
    return 'Arquivamento pedido à Faxina. Ela move a skill em até 1 min; o Desfazer funciona depois disso.';
  }
  return 'Volta pedida à Faxina. Ela devolve a skill em até 1 min.';
}

export function AvisoDaPoda({
  poda,
  aoMudar,
  aoEsquecer,
  focar = false,
}: {
  poda: Poda;
  /** Nasceu do toque em Apagar/Arquivar: o foco vem para o Desfazer. */
  focar?: boolean;
  /** A poda mudou de estado (skill: volta pedida). */
  aoMudar: (poda: Poda) => void;
  /** A poda acabou: memória restaurada ou aviso dispensado. */
  aoEsquecer: (poda: Poda) => void;
}) {
  const [emVoo, setEmVoo] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [agiu, setAgiu] = useState(false);

  async function desfazer() {
    if (emVoo) return;
    setEmVoo(true);
    setFalha(null);
    try {
      await postDesfazer(poda.operacao_id);
      setAgiu(true);
      if (poda.tipo === 'skill') aoMudar({ ...poda, estado: 'volta_pedida' });
      else aoEsquecer(poda);
    } catch (erro) {
      setFalha(mensagemDeErro(erro, 'desfazer', poda.tipo));
    } finally {
      setEmVoo(false);
    }
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--ck-space-2)' }}>
      <p style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-secondary)' }} className="break-words line-through">
        {tituloLegivel({ titulo: poda.titulo, tipo: poda.tipo })}
      </p>
      <p className="text-pretty" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>
        {frase(poda)}
      </p>
      {falha ? (
        <p role="alert" className="text-pretty" style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-state-fail)' }}>
          {falha}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center" style={{ gap: 'var(--ck-space-2)' }}>
        {poda.estado === 'volta_pedida' ? (
          <Botao fio rotulo="Fechar aviso" focar={agiu} onClick={() => aoEsquecer(poda)} />
        ) : (
          <Botao fio rotulo="Desfazer" contorno focar={focar} desabilitado={emVoo} onClick={() => void desfazer()} />
        )}
        {poda.tipo === 'skill' ? (
          <Link
            href="/faxina?aba=arquivado"
            prefetch={false}
            className="ck-link ck-foco-fio inline-flex items-center"
            style={{ minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-2)', borderRadius: 'var(--ck-radius-frame)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-link)' }}
          >
            Ver na Faxina
          </Link>
        ) : null}
      </div>
    </div>
  );
}
