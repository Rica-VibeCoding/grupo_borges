'use client';

// Um aprendizado na linha do tempo. À esquerda, o trilho: o ícone diz o tipo
// (página = memória, duas páginas = compartilhada, chave = skill) e o fio liga
// os do mesmo dia. O toque abre o conteúdo inteiro; o detalhe (visualizador e
// confirmação) só é baixado nesse toque, por `next/dynamic`.

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

import { AvisoDaPoda } from '@/components/aprendizado/aviso-da-poda';
import { IconeLua, IconeMemoria, IconeMemoriaCompartilhada, IconeSkill } from '@/components/aprendizado/icones';
import { hora, nomeDoAgente, oQueAconteceu, tituloLegivel, type NoAprendizado, type Poda } from '@/lib/aprendizado';

const DetalheDoNo = dynamic(() => import('@/components/aprendizado/detalhe-do-no').then((m) => m.DetalheDoNo), {
  loading: () => (
    <p style={{ minHeight: 'var(--ck-touch-min)', fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}>
      Abrindo…
    </p>
  ),
});

const ICONE = { memoria: IconeMemoria, memoria_compartilhada: IconeMemoriaCompartilhada, skill: IconeSkill };

export function NoDaLinha({
  no,
  ultimoDoDia,
  poda,
  aoPodar,
  aoMudar,
  aoEsquecer,
}: {
  no: NoAprendizado;
  ultimoDoDia: boolean;
  poda: Poda | null;
  aoPodar: (poda: Poda) => void;
  aoMudar: (poda: Poda) => void;
  aoEsquecer: (noId: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const linha = useRef<HTMLButtonElement>(null);
  // Memória restaurada aqui mesmo: o aviso some e o foco volta para a linha.
  const tinhaPoda = useRef(poda !== null);
  useEffect(() => {
    if (tinhaPoda.current && poda === null) linha.current?.focus();
    tinhaPoda.current = poda !== null;
  }, [poda]);
  const Icone = ICONE[no.tipo];
  const sonho = no.origem === 'sonho';
  const idDoDetalhe = `detalhe-${no.id}`;

  return (
    <li className="flex" style={{ gap: 'var(--ck-space-3)', padding: '0 var(--ck-space-3)' }}>
      {/* O trilho: ícone no topo, fio até o próximo do mesmo dia. */}
      <div aria-hidden className="flex shrink-0 flex-col items-center" style={{ width: 32, paddingTop: 'var(--ck-space-3)' }}>
        <span
          className="flex items-center justify-center"
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--ck-radius-pill)',
            background: 'var(--ck-surface-composer)',
            border: '1px solid var(--ck-edge-hairline)',
            color: poda ? 'var(--ck-text-tertiary)' : 'var(--ck-text-secondary)',
          }}
        >
          <Icone tamanho={16} />
        </span>
        {ultimoDoDia ? null : <span className="flex-1" style={{ width: 1, marginTop: 4, background: 'var(--ck-edge-hairline)' }} />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col" style={{ paddingBottom: 'var(--ck-space-4)' }}>
        {poda ? (
          <div style={{ paddingTop: 'var(--ck-space-3)' }}>
            <AvisoDaPoda poda={poda} aoMudar={aoMudar} aoEsquecer={aoEsquecer} focar={aberto} />
          </div>
        ) : (
          <>
            <button
              ref={linha}
              type="button"
              onClick={() => setAberto((a) => !a)}
              aria-expanded={aberto}
              aria-controls={aberto ? idDoDetalhe : undefined}
              className="ck-veil ck-foco-fio flex w-full flex-col text-left"
              style={{
                gap: 'var(--ck-space-1)',
                // O véu sai só à esquerda, para o texto alinhar com o trilho; à
                // direita ele fecha na mesma linha do conteúdo aberto embaixo.
                padding: 'var(--ck-space-3) 0 var(--ck-space-3) var(--ck-space-2)',
                marginLeft: 'calc(-1 * var(--ck-space-2))',
                width: 'calc(100% + var(--ck-space-2))',
                borderRadius: 'var(--ck-radius-frame)',
              }}
            >
              <span className="flex w-full items-baseline" style={{ gap: 'var(--ck-space-3)' }}>
                <span
                  className="min-w-0 flex-1 break-words"
                  style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-primary)' }}
                >
                  {tituloLegivel(no)}
                </span>
                <span className="ck-tabular shrink-0" style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}>
                  {hora(no.data)}
                </span>
              </span>
              <span className="flex flex-wrap items-center" style={{ gap: 'var(--ck-space-2)', fontSize: 'var(--ck-text-sm)' }}>
                <span style={{ color: 'var(--ck-text-secondary)' }}>
                  <span style={{ color: 'var(--ck-text-primary)' }}>{nomeDoAgente(no.agente)}</span> {oQueAconteceu(no)}
                </span>
                {sonho ? (
                  <span
                    className="inline-flex items-center"
                    style={{
                      gap: 4,
                      padding: '0 var(--ck-space-2)',
                      borderRadius: 'var(--ck-radius-pill)',
                      border: '1px solid var(--ck-edge-functional)',
                      fontSize: 'var(--ck-text-xs)',
                      color: 'var(--ck-text-secondary)',
                    }}
                  >
                    <IconeLua tamanho={13} />
                    pelo Sonho
                  </span>
                ) : null}
              </span>
              {no.descricao ? (
                <span
                  className={aberto ? 'leading-body text-pretty' : 'leading-body line-clamp-2 text-pretty'}
                  style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}
                >
                  {no.descricao}
                </span>
              ) : null}
            </button>

            {aberto ? (
              <div id={idDoDetalhe}>
                <DetalheDoNo no={no} aoPodar={aoPodar} aoFechar={() => setAberto(false)} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
