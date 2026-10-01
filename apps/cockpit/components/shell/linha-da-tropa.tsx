/**
 * A linha da tropa — UMA anatomia para todo agente, de pé ou dormindo (01/10).
 *
 *   (foto)  Nome ............................ 12%
 *    aro    palavra do estado ............ ▬▬▭▭
 *           [só na selecionada: motor · relógio · pasta]
 *
 * - O ESTADO é o da pílula (`estado-da-pilula.ts`): o aro em volta da foto no
 *   tom `--ck-tom-*` e a palavra embaixo do nome — "trabalhando", "na linha",
 *   "esperando você", "desligado". A mesma régua da gaveta e da voz: o que a
 *   tropa diz é o que a pílula diz. O aro é parado; só a cor troca, devagar.
 * - O CONTEXTO é a barra fina da gaveta, curta, com o número em cima — para
 *   todos, inclusive quem dorme (é o número que decide o /compact na volta).
 * - Motor, relógio e pasta aparecem só na linha SELECIONADA, do mesmo jeito
 *   para qualquer agente — nunca como privilégio de um.
 * - O pulso de 24h saiu da lista: ninguém lia, e o detalhado mora na gaveta.
 *
 * Cor e aro moram no `globals.css` (§T, `.ck-tl-*`). Dono: Daniel (pele).
 */
'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import {
  formatDuration,
  parseModelFromPane,
  resolveContextPct,
} from '@grupo_borges/cockpit-core/cockpit-types';
import {
  AlcaDeArraste,
  ESTILO_LINK_QUE_NAO_ROUBA_O_GESTO,
  TracoDeSoltura,
  usaArrastoDaLinha,
} from './arrasto-da-tropa';
import { BarraDeContexto, LARGURA_NA_COLUNA, LARGURA_NA_LISTA } from './barra-de-contexto';
import { estadoDaPilula } from './estado-da-pilula';
import { Contexto, ESTILO_DO_NUMERO, Pasta, pastaCurta } from './miudezas-da-linha';
import { Retrato } from './retrato';
import { cliqueSimples } from './superficie-otimista';
import { usaCenaDaVoz } from './usa-estado-da-pilula';

/** Quem sabe navegar sem esperar o servidor. `undefined` fora do provider da
 *  tropa (e sem JavaScript): aí os itens são `<Link>` de verdade, como sempre
 *  foram. */
export type EscolheAgente = (slug: string, href: string) => void;

/** Só intercepta clique primário sem modificador — ctrl/cmd/shift continua
 *  abrindo noutra aba pelo navegador. */
function escolheNoToque(slug: string, href: string, aoEscolher?: EscolheAgente) {
  if (!aoEscolher) return undefined;
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (!cliqueSimples(e)) return;
    e.preventDefault();
    aoEscolher(slug, href);
  };
}

/** O detalhe da linha selecionada: motor, relógio da sessão e a pasta quando
 *  ele trabalha fora de casa. Nada disso existe? A linha não ganha altura. */
function Detalhe({ agente, agora }: { agente: Agent; agora: number }) {
  const modelo = agente.status === 'offline' ? null : parseModelFromPane(agente.pane_excerpt);
  const iniciou = agente.status === 'offline' ? null : agente.pane_session_started_at;
  const relogio = iniciou !== null ? formatDuration(Math.max(0, agora - iniciou), false) : null;
  const pasta = pastaCurta(agente.workspace_path, agente.slug);
  if (!modelo && !relogio && !pasta) return null;
  return (
    <span className="ck-tl-detalhe ck-tabular flex min-w-0 flex-wrap items-baseline">
      {modelo ? <span className="truncate">{modelo}</span> : null}
      {relogio ? <span title="tempo de sessão">{relogio}</span> : null}
      {pasta ? <Pasta pasta={pasta} caminho={agente.workspace_path} /> : null}
    </span>
  );
}

export function LinhaDaTropa({
  agente,
  selecionado,
  agora,
  compacta,
  aoEscolher,
  aoMover,
}: {
  agente: Agent;
  selecionado: boolean;
  agora: number;
  compacta: boolean;
  aoEscolher?: EscolheAgente;
  aoMover: (direcao: -1 | 1) => void;
}) {
  const { tom, rotulo } = estadoDaPilula(agente.status, usaCenaDaVoz(agente.slug));
  const href = `/agente/${agente.slug}`;
  const { liRef, arrastando, borda } = usaArrastoDaLinha(agente.slug);
  const pct = resolveContextPct(agente);
  const dormindo = agente.status === 'offline';
  const larguraDaBarra = compacta ? LARGURA_NA_COLUNA : LARGURA_NA_LISTA;

  return (
    <li ref={liRef} className="relative flex items-center" style={{ opacity: arrastando ? 0.4 : undefined }}>
      <TracoDeSoltura borda={borda} />
      <Link
        href={href}
        onClick={escolheNoToque(agente.slug, href, aoEscolher)}
        draggable={false}
        className="ck-veil ck-aba ck-tl-linha relative flex min-w-0 flex-1 items-center"
        data-selecionado={selecionado ? 'true' : 'false'}
        data-tom={tom}
        aria-current={selecionado ? 'page' : undefined}
        style={{ ...ESTILO_LINK_QUE_NAO_ROUBA_O_GESTO, gap: 'var(--ck-space-3)' }}
      >
        <span className="ck-tl-foto flex shrink-0 self-start" aria-hidden>
          <Retrato slug={agente.slug} nome={agente.name} tamanho={compacta ? 36 : 40} redondo />
        </span>

        <span className="flex min-w-0 flex-1 flex-col" style={{ gap: '1px' }}>
          <span className="flex min-w-0 items-baseline" style={{ gap: 'var(--ck-space-2)' }}>
            <span className="ck-tl-nome min-w-0 flex-1 truncate tracking-title">{agente.name}</span>
            <span className="ck-tabular flex shrink-0" style={ESTILO_DO_NUMERO}>
              <Contexto agente={agente} agora={dormindo ? null : agora} />
            </span>
          </span>

          <span className="flex min-w-0 items-center" style={{ gap: 'var(--ck-space-2)' }}>
            {/* A palavra é a mesma da pílula; a vírgula invisível separa nome
                e estado no nome acessível do link. */}
            <span className="ck-tl-estado min-w-0 flex-1 truncate">
              <span className="sr-only">, </span>
              {rotulo}
            </span>
            {pct === null ? (
              <span aria-hidden className="shrink-0" style={{ width: larguraDaBarra }} />
            ) : (
              <BarraDeContexto pct={pct} largura={larguraDaBarra} />
            )}
          </span>

          {selecionado ? <Detalhe agente={agente} agora={agora} /> : null}
        </span>
      </Link>
      <AlcaDeArraste nomeDoAgente={agente.name} aoMover={aoMover} />
    </li>
  );
}
