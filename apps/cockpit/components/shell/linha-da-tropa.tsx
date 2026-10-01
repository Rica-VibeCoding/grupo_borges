/**
 * A linha da tropa — UMA anatomia para todo agente, de pé ou dormindo, em duas
 * linhas no máximo (v9, 01/10, ajustada pelo Rica no preview):
 *
 *   (foto)  Nome ............................ 12%
 *    aro    Opus 5.5 ........................ 3 h
 *
 * - O ESTADO mora no aro em volta da foto, no tom `--ck-tom-*` da pílula
 *   (`estado-da-pilula.ts`); desligado também esmaece foto e nome. Sem palavra
 *   na linha — o Rica cortou por redundância; ela fica no nome acessível.
 * - Linha 2: o modelo. Direita: o contexto em cima e, embaixo, há quanto tempo
 *   ele fez algo (`ultima-atividade.ts`). Nada aparece a mais ao selecionar.
 * - Selecionado é PÍLULA: o vidro escuro da `PilulaDoAgente`, sem desfoque
 *   (§9.2: nada de `backdrop-filter` em lista).
 *
 * Cor e aro moram no `globals.css` (§T, `.ck-tl-*`). Dono: Daniel (pele).
 */
'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { parseModelFromPane } from '@grupo_borges/cockpit-core/cockpit-types';
import {
  AlcaDeArraste,
  ESTILO_LINK_QUE_NAO_ROUBA_O_GESTO,
  TracoDeSoltura,
  usaArrastoDaLinha,
} from './arrasto-da-tropa';
import { estadoDaPilula } from './estado-da-pilula';
import { Contexto, ESTILO_DO_NUMERO } from './miudezas-da-linha';
import { Retrato } from './retrato';
import { cliqueSimples } from './superficie-otimista';
import { formataUltimaAtividade } from './ultima-atividade';
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
  const dormindo = agente.status === 'offline';
  const modelo = parseModelFromPane(agente.pane_excerpt);
  const atividade = formataUltimaAtividade(agente.last_seen, agora);

  return (
    <li ref={liRef} className="relative flex items-center" style={{ opacity: arrastando ? 0.4 : undefined }}>
      <TracoDeSoltura borda={borda} />
      <Link
        href={href}
        onClick={escolheNoToque(agente.slug, href, aoEscolher)}
        draggable={false}
        className="ck-tl-linha relative flex min-w-0 flex-1 items-center"
        data-selecionado={selecionado ? 'true' : 'false'}
        data-tom={tom}
        aria-current={selecionado ? 'page' : undefined}
        style={{ ...ESTILO_LINK_QUE_NAO_ROUBA_O_GESTO, gap: 'var(--ck-space-3)' }}
      >
        <span className="ck-tl-foto flex shrink-0" aria-hidden>
          <Retrato slug={agente.slug} nome={agente.name} tamanho={compacta ? 34 : 38} redondo />
        </span>

        {/* Duas colunas, não duas linhas: sem modelo conhecido (sessão sem
            statusline), o nome centra na altura da foto em vez de boiar no
            topo de uma linha com buraco embaixo. */}
        <span className="flex min-w-0 flex-1 flex-col justify-center leading-hero" style={{ gap: '2px' }}>
          <span className="ck-tl-nome min-w-0 truncate tracking-title">
            {agente.name}
            <span className="sr-only">, {rotulo}</span>
          </span>
          {modelo ? <span className="ck-tl-segunda min-w-0 truncate">{modelo}</span> : null}
        </span>

        <span className="ck-tabular flex shrink-0 flex-col items-end leading-hero" style={{ gap: '2px' }}>
          <span className="flex" style={ESTILO_DO_NUMERO}>
            <Contexto agente={agente} agora={dormindo ? null : agora} />
          </span>
          <span className="ck-tl-segunda" title="última atividade do agente">
            <span className="sr-only">última atividade: </span>
            {atividade}
          </span>
        </span>
      </Link>
      <AlcaDeArraste nomeDoAgente={agente.name} aoMover={aoMover} />
    </li>
  );
}
