/**
 * O que a máquina tem aberto, em três grupos na ordem Seus ·
 * De agente · Protegido, cada um do que mais come ao que menos (`agrupa`).
 * Cartões no material do cartão da VPS; dentro, linhas na anatomia da tropa.
 *
 * O Protegido nasce aberto, com pílula para recolher: é o que a tela NÃO deixa
 * fechar (agentes, sshd, tailscale).
 *
 * Antes da primeira leitura, a altura de uma lista curta fica reservada.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { useState, type ReactNode } from 'react';

import { IconeCadeado } from '@/components/shell/icones';
import { formataTamanho } from '@/components/shell/recursos-da-vps';
import { agrupa, type Abertos, type GrupoDeItens, type ItemAberto } from '@/lib/maquinas';

import { LinhaAberta, PilulaDaMaquina } from './linha-aberta';
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
          Não consegui listar o que está aberto: {leitura.falha}. Tento de novo sozinho.
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
  return grupos.map((grupo) =>
    grupo.grupo === 'protegido' ? (
      <GrupoProtegido key="protegido" grupo={grupo} />
    ) : (
      <CartaoDoGrupo key={grupo.grupo} grupo={grupo}>
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
      </CartaoDoGrupo>
    ),
  );
}

function CartaoDoGrupo({
  grupo,
  direita,
  children,
}: {
  grupo: GrupoDeItens;
  direita?: ReactNode;
  children?: ReactNode;
}) {
  const n = grupo.itens.length;
  return (
    <section
      aria-label={grupo.nome}
      className="ck-vps flex flex-col"
      style={{ padding: 'var(--ck-space-3) var(--ck-space-4) var(--ck-space-1)' }}
    >
      <div className="flex items-baseline" style={{ gap: 'var(--ck-space-2)', minHeight: '24px' }}>
        <h3 style={{ fontSize: 'var(--ck-text-sm)', fontWeight: 600, color: 'var(--ck-text-primary)' }}>{grupo.nome}</h3>
        <span className="ck-tabular ml-auto" style={SECUNDARIO_XS}>
          {n} {n === 1 ? 'aberto' : 'abertos'} · {formataTamanho(grupo.memoria_mb)}
        </span>
      </div>
      {children}
      {direita}
    </section>
  );
}

function GrupoProtegido({ grupo }: { grupo: GrupoDeItens }) {
  const [aberto, setAberto] = useState(true);
  const n = grupo.itens.length;
  return (
    <CartaoDoGrupo
      grupo={grupo}
      direita={
        <div className="flex" style={{ paddingBottom: 'var(--ck-space-1)' }}>
          <PilulaDaMaquina
            aria-expanded={aberto}
            aria-controls="maquina-protegidos"
            aoTocar={() => setAberto((a) => !a)}
          >
            {aberto ? 'Esconder protegidos' : `Mostrar ${n} ${n === 1 ? 'protegido' : 'protegidos'}`}
          </PilulaDaMaquina>
        </div>
      }
    >
      {aberto ? (
        <ul id="maquina-protegidos" className="flex flex-col" style={{ padding: 'var(--ck-space-1) 0' }}>
          {grupo.itens.map((item) => (
            <li
              key={item.id}
              className="flex items-center"
              style={{ gap: 'var(--ck-space-2)', minHeight: '32px', fontSize: 'var(--ck-text-sm)' }}
            >
              <IconeCadeado tamanho={14} className="shrink-0" style={{ color: 'var(--ck-text-secondary)' }} />
              <span className="sr-only">Protegido:</span>
              <span className="min-w-0 truncate" style={{ color: 'var(--ck-text-primary)' }}>
                {item.rotulo}
              </span>
              <span className="ck-tabular ml-auto shrink-0" style={{ color: 'var(--ck-text-secondary)' }}>
                {formataTamanho(item.memoria_mb)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </CartaoDoGrupo>
  );
}
