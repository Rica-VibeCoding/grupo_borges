/**
 * O que a máquina tem aberto, em grupos na ordem Seus · Agentes ·
 * Chrome de agente · Protegido, cada um do que mais come ao que menos (`agrupa`).
 * Cartões no material do cartão da VPS; dentro, uma linha por item, em colunas.
 *
 * Todo grupo tem a pílula Mostrar/Esconder ao lado do nome e nasce fechado
 * (Rica, 05/11). O Protegido é o que a tela NÃO deixa fechar (sshd, tailscale,
 * som) e afunda um degrau abaixo da mesa (`.ck-vps-poco`).
 *
 * Antes da primeira leitura, a altura de uma lista curta fica reservada.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useState, type ReactNode } from 'react';

import { IconeCadeado } from '@/components/shell/icones';
import { formataTamanho } from '@/components/shell/recursos-da-vps';
import { agrupa, textoDaFalhaDosAbertos, type Abertos, type GrupoDeItens, type ItemAberto } from '@/lib/maquinas';

import { CabecalhoDasColunas, LinhaAberta, LinhaProtegida, PilulaDaMaquina } from './linha-aberta';
import type { Liberados, LeituraDosAbertos } from './painel-da-maquina';

const SECUNDARIO_XS = { fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' } as const;

export function ListaDeAbertos({
  maquina,
  leitura,
  liberados,
  aoFechar,
}: {
  maquina: string;
  leitura: LeituraDosAbertos;
  liberados: Liberados;
  aoFechar: (item: ItemAberto, mb: number) => void;
}) {
  return (
    <section aria-label="Aberto agora" className="flex flex-col" style={{ gap: 'var(--ck-space-2)', minHeight: '240px' }}>
      {leitura && 'falha' in leitura ? (
        <p style={{ ...SECUNDARIO_XS, padding: '0 var(--ck-space-3)' }}>
          {textoDaFalhaDosAbertos(leitura.falha, leitura.status)}
        </p>
      ) : null}
      {leitura && 'abertos' in leitura ? <Grupos maquina={maquina} leitura={leitura.abertos} liberados={liberados} aoFechar={aoFechar} /> : null}
    </section>
  );
}

function Grupos({
  maquina,
  leitura,
  liberados,
  aoFechar,
}: {
  maquina: string;
  leitura: Abertos;
  liberados: Liberados;
  aoFechar: (item: ItemAberto, mb: number) => void;
}) {
  // O recém-fechado segue na lista até o prazo dele, venha ou não na leitura.
  const agoraMs = Date.now();
  const vivos = Object.values(liberados).filter((l) => l.ate > agoraMs);
  const idsVivos = new Set(vivos.map((l) => l.item.id));
  const grupos = agrupa([...leitura.itens.filter((i) => !idsVivos.has(i.id)), ...vivos.map((l) => l.item)]);
  if (grupos.length === 0) {
    return <p style={{ ...SECUNDARIO_XS, padding: '0 var(--ck-space-3)' }}>Nada aberto.</p>;
  }
  const agora = Math.floor(Date.now() / 1000);
  return grupos.map((grupo) => (
    <CartaoDoGrupo key={grupo.grupo} grupo={grupo}>
      {grupo.grupo === 'protegido' ? (
        <>
          <CabecalhoDasColunas comAtividade={false} />
          <ul className="flex flex-col">
            {grupo.itens.map((item) => (
              <LinhaProtegida key={item.id} item={item} />
            ))}
          </ul>
        </>
      ) : (
        <>
          <CabecalhoDasColunas />
          <ul className="flex flex-col">
            {grupo.itens.map((item, i) => (
              <LinhaAberta
                key={item.id}
                maquina={maquina}
                item={item}
                observadoDesde={leitura.observado_desde}
                agora={agora}
                primeira={i === 0}
                liberouMb={idsVivos.has(item.id) ? liberados[item.id].mb : null}
                aoFechar={aoFechar}
              />
            ))}
          </ul>
        </>
      )}
    </CartaoDoGrupo>
  ));
}

function CartaoDoGrupo({ grupo, children }: { grupo: GrupoDeItens; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const protegido = grupo.grupo === 'protegido';
  const n = grupo.itens.length;
  const idDaLista = `maquina-grupo-${grupo.grupo}`;
  return (
    <section
      aria-label={grupo.nome}
      className={`ck-vps flex flex-col${protegido ? ' ck-vps-poco' : ''}`}
      style={{ padding: 'var(--ck-space-1) var(--ck-space-4)' }}
    >
      <div className="flex flex-wrap items-center" style={{ columnGap: 'var(--ck-space-3)' }}>
        <h3
          className="flex shrink-0 items-center"
          style={{
            gap: 'var(--ck-space-1)',
            fontSize: 'var(--ck-text-sm)',
            fontWeight: 600,
            color: protegido ? 'var(--ck-text-secondary)' : 'var(--ck-text-primary)',
          }}
        >
          {protegido ? <IconeCadeado tamanho={14} className="shrink-0" /> : null}
          {grupo.nome}
        </h3>
        <PilulaDaMaquina mostrar aria-expanded={aberto} aria-controls={idDaLista} aoTocar={() => setAberto((a) => !a)}>
          {aberto ? 'Esconder' : 'Mostrar'}
        </PilulaDaMaquina>
        <span className="ck-tabular ml-auto" style={SECUNDARIO_XS}>
          {n} {n === 1 ? 'aberto' : 'abertos'} · {formataTamanho(grupo.memoria_mb)}
        </span>
      </div>
      <div id={idDaLista} hidden={!aberto}>
        {children}
      </div>
    </section>
  );
}
