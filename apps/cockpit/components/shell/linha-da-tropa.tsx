/**
 * As linhas da tropa — o cartão de quem está de pé e a linha rasa de quem dorme.
 *
 * Saíram de `tropa.tsx` na oitava versão (28/09): o arquivo tinha 676 linhas e
 * fazia duas coisas — a LISTA (ordem, arrasto, gravação) e a LINHA (o desenho
 * de um agente). O porquê de cada decisão visual está no comentário do topo de
 * `tropa.tsx`; aqui mora só o que cada peça desenha.
 *
 * A grade das duas linhas é a mesma, e é o que faz a coluna ler como coluna:
 *
 *   [retrato 40/34]  Nome ......................... 16%
 *                    Opus 5.5   00:16 ........ ▁▃▅▂▁
 *                    pasta/fora/de/casa
 *
 *   [retrato 28   ]  Nome ......................... 12%
 *
 * O percentual é sempre a última coluna da PRIMEIRA linha, vivo ou dormindo —
 * uma vertical só, na altura do nome. O pulso de 24h mora na segunda linha, no
 * fluxo, na mesma borda direita: não existe coordenada em que ele encoste no
 * número.
 *
 * Dono: Daniel (pele). As medidas vêm do esqueleto.
 */
'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { formatDuration, parseModelFromPane } from '@grupo_borges/cockpit-core/cockpit-types';
import {
  AlcaDeArraste,
  ESTILO_LINK_QUE_NAO_ROUBA_O_GESTO,
  TracoDeSoltura,
  usaArrastoDaLinha,
} from './arrasto-da-tropa';
import { estadoDe } from './estado';
import { Contexto, ESTILO_DO_NUMERO, Pasta, pastaCurta, Pulso } from './miudezas-da-linha';
import { Retrato } from './retrato';
import { TrocaCruzada } from './troca-cruzada';
import { cliqueSimples } from './superficie-otimista';

/** Quem sabe navegar sem esperar o servidor. `undefined` fora do provider da
 *  tropa (e sem JavaScript): aí os itens são `<Link>` de verdade, como sempre
 *  foram. */
export type EscolheAgente = (slug: string, href: string) => void;

/** O `onClick` dos dois formatos de item. Só intercepta clique primário sem
 *  modificador — ctrl/cmd/shift continua abrindo noutra aba pelo navegador. */
function escolheNoToque(slug: string, href: string, aoEscolher?: EscolheAgente) {
  if (!aoEscolher) return undefined;
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (!cliqueSimples(e)) return;
    e.preventDefault();
    aoEscolher(slug, href);
  };
}

export function CartaoVivo({
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
  const estado = estadoDe(agente.status);
  const pasta = pastaCurta(agente.workspace_path, agente.slug);
  const href = `/agente/${agente.slug}`;
  const { liRef, arrastando, borda } = usaArrastoDaLinha(agente.slug);

  const modelo = parseModelFromPane(agente.pane_excerpt);
  const iniciou = agente.pane_session_started_at;
  // O relógio da sessão sai na coluna de 260px, como sempre saiu: dos três é o
  // dado menos acionável, e sem ele o modelo para de ser cortado.
  const relogio =
    iniciou !== null && !compacta ? formatDuration(Math.max(0, agora - iniciou), false) : null;
  const aguarda = agente.status === 'aguardando';

  // A segunda linha tem UM trabalho por vez. Aguardando: a frase que chama, e
  // só ela. Senão: modelo e relógio. Sem nenhum dos dois (Canário, Fluyt), a
  // pasta sobe e ocupa o lugar — era o buraco na 2ª linha da v7.
  const temTelemetria = aguarda || modelo !== null || relogio !== null;
  const pastaSobe = !temTelemetria && pasta !== null;

  return (
    <li
      ref={liRef}
      className="relative flex items-center"
      style={{ opacity: arrastando ? 0.4 : undefined }}
    >
      <TracoDeSoltura borda={borda} />
      <Link
        href={href}
        onClick={escolheNoToque(agente.slug, href, aoEscolher)}
        draggable={false}
        className="ck-veil ck-aba relative flex min-w-0 flex-1 items-center"
        data-selecionado={selecionado ? 'true' : 'false'}
        data-linha="viva"
        aria-current={selecionado ? 'page' : undefined}
        style={{
          ...ESTILO_LINK_QUE_NAO_ROUBA_O_GESTO,
          gap: 'var(--ck-space-3)',
          minHeight: 'var(--ck-touch-min)',
          paddingBlock: 'var(--ck-space-2)',
          borderLeft: `2px solid ${selecionado ? 'var(--ck-text-primary)' : 'transparent'}`,
        }}
      >
        {/* O estado mora no anel. `title` pra quem passa o mouse; o `sr-only`
            abaixo entra no nome acessível do link, que é o que o leitor de
            tela anuncia — cor nunca é portadora única. */}
        <span
          className="ck-anel flex shrink-0 self-center"
          data-estado={agente.status}
          title={estado.rotulo}
        >
          <Retrato slug={agente.slug} nome={agente.name} tamanho={compacta ? 34 : 40} />
        </span>

        <span className="flex min-w-0 flex-1 flex-col" style={{ gap: '2px' }}>
          <span className="flex min-w-0 items-baseline" style={{ gap: 'var(--ck-space-2)' }}>
            <span
              className="min-w-0 flex-1 truncate tracking-title"
              style={{
                fontSize: compacta ? 'var(--ck-text-sm)' : 'var(--ck-text-base)',
                fontWeight: 500,
                color: 'var(--ck-text-primary)',
              }}
            >
              {agente.name}
            </span>
            {/* Aguardando já diz a frase na 2ª linha, em texto visível: o
                `sr-only` repetiria "aguarda você" duas vezes no leitor de tela. */}
            {aguarda ? null : <span className="sr-only">, {estado.rotulo}</span>}
            <span className="ck-tabular flex shrink-0" style={ESTILO_DO_NUMERO}>
              <Contexto agente={agente} agora={agora} />
            </span>
          </span>

          <span
            className="ck-tabular flex min-w-0 items-center"
            style={{
              gap: 'var(--ck-space-2)',
              fontSize: 'var(--ck-text-xs)',
              color: 'var(--ck-text-secondary)',
              minHeight: '16px',
            }}
          >
            <span className="flex min-w-0 flex-1 items-baseline" style={{ gap: 'var(--ck-space-2)' }}>
              {/* A troca de estado cruza em fade, só de opacidade
                  (`troca-cruzada.tsx`). A chave é o ESTADO, não o texto: o
                  relógio muda a cada tique e não é troca nenhuma. Sem
                  telemetria ela nem monta: vazia, ainda levaria o `gap` e
                  empurraria a pasta que sobe. */}
              {temTelemetria ? (
              <TrocaCruzada
                chave={aguarda ? 'aguarda' : 'telemetria'}
                className="flex min-w-0 items-baseline"
                style={{ gap: 'var(--ck-space-2)' }}
              >
                {aguarda ? (
                  <span className="truncate" style={{ color: 'var(--ck-state-attention)' }}>
                    aguarda você
                  </span>
                ) : (
                  <>
                    {modelo ? <span className="min-w-0 truncate">{modelo}</span> : null}
                    {relogio ? (
                      <span className="shrink-0" title="tempo de sessão">
                        {relogio}
                      </span>
                    ) : null}
                  </>
                )}
              </TrocaCruzada>
              ) : null}
              {pastaSobe ? <Pasta pasta={pasta} caminho={agente.workspace_path} /> : null}
            </span>
            <Pulso buckets={agente.sparkline} />
          </span>

          {pasta && !pastaSobe ? <Pasta pasta={pasta} caminho={agente.workspace_path} /> : null}
        </span>
      </Link>
      <AlcaDeArraste nomeDoAgente={agente.name} aoMover={aoMover} />
    </li>
  );
}

export function LinhaDormindo({
  agente,
  selecionado,
  compacta,
  aoEscolher,
  aoMover,
}: {
  agente: Agent;
  selecionado: boolean;
  compacta: boolean;
  aoEscolher?: EscolheAgente;
  aoMover: (direcao: -1 | 1) => void;
}) {
  const href = `/agente/${agente.slug}`;
  const { liRef, arrastando, borda } = usaArrastoDaLinha(agente.slug);
  return (
    <li
      ref={liRef}
      className="relative flex items-center"
      style={{ opacity: arrastando ? 0.4 : undefined }}
    >
      <TracoDeSoltura borda={borda} />
      <Link
        href={href}
        onClick={escolheNoToque(agente.slug, href, aoEscolher)}
        draggable={false}
        className="ck-veil ck-aba flex min-w-0 flex-1 items-center"
        data-selecionado={selecionado ? 'true' : 'false'}
        data-linha="dormindo"
        aria-current={selecionado ? 'page' : undefined}
        style={{
          ...ESTILO_LINK_QUE_NAO_ROUBA_O_GESTO,
          gap: 'var(--ck-space-3)',
          minHeight: 'var(--ck-touch-min)',
          paddingBlock: 'var(--ck-space-1)',
          borderLeft: `2px solid ${selecionado ? 'var(--ck-text-primary)' : 'transparent'}`,
        }}
      >
        {/* A coluna do retrato reserva a largura do de quem está de pé e
            centraliza o menor: sem ela o nome descia em ziguezague. */}
        <span
          className="flex shrink-0 items-center justify-center self-center"
          style={{ flexBasis: compacta ? '34px' : '40px' }}
        >
          <Retrato slug={agente.slug} nome={agente.name} tamanho={28} opacidade={0.55} />
        </span>

        {/* Sem o chip "off" (28/09): a linha rasa, a foto esmaecida e a
            ausência de anel já dizem "desligado" — o chip repetia isso sete
            vezes. A palavra continua para quem não vê a tela. */}
        <span
          className="min-w-0 flex-1 truncate"
          style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}
        >
          {agente.name}
          <span className="sr-only">, desligado</span>
        </span>

        {/* Ordem do Rica (03/08): quem dorme mostra NOME + CONTEXTO — o número
            que decide o /compact na volta. Sem pasta, sem "há 20h", e agora
            sem o trilho da barra: vazio a 0% é tinta sem informação, e o teto
            continua julgado no número, em âmbar quando passa. */}
        <span className="ck-tabular flex shrink-0" style={ESTILO_DO_NUMERO}>
          <Contexto agente={agente} agora={null} />
        </span>
      </Link>
      <AlcaDeArraste nomeDoAgente={agente.name} aoMover={aoMover} />
    </li>
  );
}
