import { notFound } from 'next/navigation';
import Link from 'next/link';
import { fetchFleet } from '@grupo_borges/cockpit-core/api';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { BarraDeTelas } from '@/components/shell/barra-de-telas';
import { BlocoDeAcoes } from '@/components/shell/bloco-de-acoes';
import { Composer } from '@/components/shell/composer';
import { PainelMcp } from '@/components/shell/mcp-painel';
import { contratoSeparaPedido, leMotor } from '@/components/shell/motor';
import { Regua } from '@/components/shell/regua';
import { Statusline } from '@/components/shell/statusline';
import { GavetaPainel, LinkFechaPainel } from '@/components/shell/superficie-otimista';
import { FeedDaConversa } from './feed-da-conversa';
import { PalcoDaConversa } from './palco-da-conversa';

export const dynamic = 'force-dynamic';

/** Linha do painel. Rótulo em sans (voz do produto), valor em mono (voz da
 *  máquina) — a divisão do contrato §4 aplicada no menor lugar possível. */
function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex flex-col" style={{ gap: '2px' }}>
      <span
        style={{
          fontSize: 'var(--ck-text-xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--ck-track-overline)',
          color: 'var(--ck-text-secondary)',
        }}
      >
        {rotulo}
      </span>
      <span
        className="truncate"
        style={{
          fontFamily: 'var(--ck-font-mono)',
          fontSize: 'var(--ck-text-sm)',
          color: 'var(--ck-text-primary)',
        }}
        title={valor}
      >
        {valor}
      </span>
    </div>
  );
}

/** Rótulo de seção — a mesma overline dos `Campo` e do cabeçalho, em um lugar
 *  só para a gaveta nova (09/08). */
function Rotulo({ children }: { children: string }) {
  return (
    <span
      className="ck-tabular"
      style={{
        fontSize: 'var(--ck-text-xs)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--ck-track-overline)',
        color: 'var(--ck-text-secondary)',
      }}
    >
      {children}
    </span>
  );
}

/** A GAVETA — reescrita em 09/08 pelo que o Rica cravou, e não mais para
 *  texto corrido:
 *
 *  - **Comandos** em primeiro lugar (a gaveta "é essencialmente para
 *    comandos"): as ações rápidas, que ele chama de "ideia central do
 *    painel", e o slot da lista de comandos que ele vai passar depois
 *    ("te passo depois os comandos que temos que usar no painel de fato").
 *    Nada é inventado aqui — o slot está pronto para a lista entrar sem
 *    redesenho, e sem comando falso ocupando o lugar.
 *  - **Statusline** no centro — o "lugar central para statusline e contexto":
 *    modelo · sessão · contexto numa linha só, com a barra ocupando o campo
 *    inteiro. O teto de 30% continua sendo a cor (nada é desenhado por cima),
 *    e a observação sai no `title` da barra.
 *  - **Ficha** — os quatro campos que ele listou: modelo / executor / sessão
 *    tmux / workspace. Caiu o Papel e caiu a frase do contexto ("42% · teto
 *    30% · dados antigos · lido 3h"), que era o texto corrido reprovado.
 *  - **MCPs** na base — a porta para a tela do Vinicius (15ccf76), que até
 *    aqui existia commitada sem consumidor.
 *
 *  O `flex-auto` (base no conteúdo) NÃO o `flex-1` (base 0) continua sendo a
 *  régua da gaveta: o pai (`.ck-flutua`) tem altura vinda do CONTEÚDO, e item
 *  com base 0 contribui 0 pro tamanho intrínseco do pai no WebKit — era a
 *  gaveta com 0px de altura no iPhone do Rica (02/08). O `min-h-0` deixa o
 *  item encolher quando o `max-height` do pai morde, que é o que faz a área de
 *  baixo rolar em vez de estourar. */
function Painel({
  agente,
  fecharHref,
  painelAberto,
  agora,
}: {
  agente: Agent;
  fecharHref: string;
  /** Fallback da URL. O `BlocoDeAcoes` prefere o valor otimista quando está
   *  dentro do `PainelProvider` — é o que faz a re-busca do `/painel` começar
   *  no frame do clique, não 2s depois. */
  painelAberto: boolean;
  agora: number;
}) {
  return (
    <div className="flex min-h-0 flex-auto flex-col">
      <div
        className="flex shrink-0 items-center justify-between border-b"
        style={{
          gap: 'var(--ck-space-2)',
          padding: 'var(--ck-space-3) var(--ck-space-4)',
          // `edge-light`, não `edge-hairline`: a referência de textura que o
          // Rica mandou tem o fio entre duas áreas escuras MAIS CLARO que as
          // duas (#323232 sobre #202020/#181818). O hairline (#424242) é mais
          // duro que isso; branco a 7% sobre esta superfície dá (49,49,49) —
          // o valor que ele mediu, e a assinatura da §A: luz, não sombra.
          borderColor: 'var(--ck-edge-light)',
        }}
      >
        <Rotulo>Detalhes</Rotulo>
        {/* Fechar é navegar — e desde 30/07 também é otimista: o
            `LinkFechaPainel` vira o painel no mesmo frame e a URL alcança
            atrás; sem JS é o Link de sempre. */}
        <LinkFechaPainel
          href={fecharHref}
          rotulo="detalhes"
          className="ck-veil flex items-center justify-center"
          style={{
            minWidth: 'var(--ck-touch-min)',
            minHeight: 'var(--ck-touch-min)',
            marginRight: 'calc(var(--ck-space-3) * -1)',
            borderRadius: 'var(--ck-radius-chip)',
            fontSize: 'var(--ck-text-lg)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          ×
        </LinkFechaPainel>
      </div>

      {/* AS AÇÕES RÁPIDAS (§17) — no topo, e FORA da área que rola. O Rica as
          chama de "ideia central do painel", e desde que a gaveta passou a
          ancorar no topo e crescer pra baixo, ficar aqui significa ficar
          sempre à vista: cresça o conteúdo quanto crescer, quem rola são os
          campos de referência, não os controles. */}
      <section aria-label="Comandos" className="flex shrink-0 flex-col">
        <div style={{ padding: 'var(--ck-space-3) var(--ck-space-4)' }}>
          <Rotulo>Comandos</Rotulo>
        </div>
        <BlocoDeAcoes agentSlug={agente.slug} aberto={painelAberto} />

        {/* O SLOT DA LISTA DE COMANDOS DO PAINEL — 09/08. O Rica passa a lista
            depois; aqui entra sem redesenho. Vazio de propósito: inventar um
            comando que ele não pediu seria a mentira de UI da §9. */}
        <div
          className="flex flex-col"
          style={{
            gap: 'var(--ck-space-2)',
            padding: 'var(--ck-space-3) var(--ck-space-4)',
            borderBottom: '1px solid var(--ck-edge-light)',
          }}
        >
          <Rotulo>Comandos do painel</Rotulo>
          <p style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-tertiary)' }}>
            a lista de comandos do painel ainda não chegou
          </p>
        </div>
      </section>

      {/* STATUSLINE — o lugar central que o Rica pediu (09/08): telemetria
          viva (modelo · sessão · contexto) numa linha só. A barra ocupa o
          campo inteiro (`larguraDaBarra={null}`), e o teto de 30% continua
          sendo a cor e o `title` — nada é desenhado por cima (ordem de 09/08:
          "passou de 30% muda de cor"). */}
      <section
        aria-label="status do agente"
        className="flex shrink-0 flex-col border-b"
        style={{
          gap: 'var(--ck-space-2)',
          padding: 'var(--ck-space-4)',
          borderColor: 'var(--ck-edge-light)',
        }}
      >
        <Statusline agente={agente} agora={agora} larguraDaBarra={null} />
      </section>

      {/* A FICHA — os quatro campos que o Rica cravou. Rola por dentro; os
          controles e o status ficam fixos (a ordem da §17). O contexto não
          tem campo próprio aqui: ele mora na statusline, que é o lugar central
          — e a frase "· teto 30% · dados antigos · lido 3h" foi retirada a
          pedido dele. */}
      <div
        className="flex min-h-0 flex-auto flex-col overflow-y-auto"
        style={{ gap: 'var(--ck-space-4)', padding: 'var(--ck-space-4)' }}
      >
        <Campo rotulo="Modelo" valor={agente.state_model ?? agente.model_default} />
        <Campo rotulo="Executor" valor={agente.state_cli ?? agente.cli_default} />
        <Campo rotulo="Sessão tmux" valor={agente.tmux_session} />
        <Campo rotulo="Workspace" valor={agente.workspace_path} />
      </div>

      {/* ENTRADA DA TELA DE MCPs — a tela do Vinicius (15ccf76) estava
          commitada e órfã; esta linha é a porta. Link de verdade (rota, não
          estado): `?painel=mcps` abre direto por deep-link. */}
      <Link
        href={`${fecharHref}?painel=mcps`}
        className="ck-veil flex shrink-0 items-center justify-between border-t"
        style={{
          gap: 'var(--ck-space-2)',
          padding: 'var(--ck-space-3) var(--ck-space-4)',
          minHeight: 'var(--ck-touch-min)',
          borderColor: 'var(--ck-edge-hairline)',
        }}
      >
        <span style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-primary)' }}>MCPs</span>
        <span aria-hidden style={{ color: 'var(--ck-text-secondary)', fontSize: 'var(--ck-text-lg)', lineHeight: 1 }}>
          ›
        </span>
      </Link>
    </div>
  );
}

/** A TELA DE MCPs dentro da gaveta — o mesmo cabeçalho de chrome, com um
 *  caminho de volta para os detalhes no lugar do rótulo. O `PainelMcp`
 *  preenche o campo com `flex-auto` (ver o cabeçalho daquele arquivo). */
function VistaMcp({ agentSlug, fecharHref }: { agentSlug: string; fecharHref: string }) {
  return (
    <div className="flex min-h-0 flex-auto flex-col">
      <div
        className="flex shrink-0 items-center justify-between border-b"
        style={{
          gap: 'var(--ck-space-2)',
          padding: 'var(--ck-space-3) var(--ck-space-4)',
          borderColor: 'var(--ck-edge-light)',
        }}
      >
        <Link
          href={`${fecharHref}?painel=detalhes`}
          aria-label="Voltar para os detalhes do agente"
          className="ck-veil flex items-center justify-center"
          style={{
            minWidth: 'var(--ck-touch-min)',
            minHeight: 'var(--ck-touch-min)',
            marginLeft: 'calc(var(--ck-space-3) * -1)',
            borderRadius: 'var(--ck-radius-chip)',
            fontSize: 'var(--ck-text-lg)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          ←
        </Link>
        <Rotulo>MCPs</Rotulo>
        <LinkFechaPainel
          href={fecharHref}
          rotulo="detalhes do agente"
          className="ck-veil flex items-center justify-center"
          style={{
            minWidth: 'var(--ck-touch-min)',
            minHeight: 'var(--ck-touch-min)',
            marginRight: 'calc(var(--ck-space-3) * -1)',
            borderRadius: 'var(--ck-radius-chip)',
            fontSize: 'var(--ck-text-lg)',
            color: 'var(--ck-text-secondary)',
          }}
        >
          ×
        </LinkFechaPainel>
      </div>

      <div className="flex min-h-0 flex-auto flex-col">
        <PainelMcp agentSlug={agentSlug} />
      </div>
    </div>
  );
}

// Rota, não estado: é isto que faz deep-link do Telegram, refresh e botão voltar
// do Android funcionarem. Em Next 16 `params` e `searchParams` são Promise.
export default async function AgentePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const fleet = await fetchFleet();
  const agente = fleet.agents.find((a) => a.slug === slug);

  if (!agente) notFound();

  const fecharHref = `/agente/${slug}`;
  const motor = leMotor({ modeloSessao: agente.state_model, modeloPadrao: agente.model_default });
  // Relógio do servidor, na mesma régua da rota `/`: `force-dynamic`
  // re-renderiza a cada navegação, então a duração de sessão da statusline vem
  // fresca ao abrir a gaveta.
  const agora = Math.floor(Date.now() / 1000);
  // Qual visão a gaveta desenha. `painel=mcps` = a tela de MCPs; qualquer outro
  // valor (ou ausência) = os detalhes. O valor mora na URL, como a decisão nº 1
  // do `app-shell.tsx` pede — deep-link direto na tela de MCPs funciona.
  const modoPainel = sp.painel === 'mcps' ? 'mcps' : 'detalhes';

  return (
    <>
      {/* Chrome do topo — nav overlay à esquerda, pill de telas centralizado,
          painel à direita. §12.3/§13: dois controles na mesma faixa. */}
      <BarraDeTelas
        telas={[{ rotulo: 'Chat', ativa: true }]}
        // Os dois destinos separados: o `BotaoNav` alterna pelo estado
        // otimista, não pelo que a URL já refletiu.
        abrirNavHref={`${fecharHref}?nav=aberto`}
        fecharNavHref={fecharHref}
        navAberta={false}
        hrefAbrirPainel={`${fecharHref}?painel=detalhes`}
        hrefFecharPainel={fecharHref}
        painelAberto={false}
      />

      {/* Aqui morava o cabeçalho de identidade — retrato, nome e estado — e a
          linha que o separava do feed. Saiu por ordem do Rica (30/07): o agente
          já aparece selecionado e destacado na tropa à esquerda, e desde a MESA
          E A FOLHA (§14) a aba do item selecionado ENCOSTA nesta folha. Repetir
          o nome no topo do chat era dizer duas vezes, com a linha divisória
          cobrando altura de tela no celular para separar o feed de nada.

          Nenhum substituto entra agora, e isso é literal: *"se sentir falta de
          uma identidade dentro do chat eu aviso, mas não seria o que está"*.
          Inventar uma marca d'água ou um nome discreto aqui seria trocar o que
          ele mandou tirar por uma versão menor da mesma coisa. */}

      {/* O FEED DE VERDADE. Até 02/08 esta rota mostrava só o último recado do
          assistente + o pedaço cru do pane, e o `<FeedDaConversa>` vivia numa
          rota `/preview` paralela pra não arriscar a tela que o Rica olha ao
          vivo. Ele mandou sair da versão de teste no mesmo dia: a preview
          morreu e o feed é o corpo desta rota. `last_assistant_message`,
          `pane_excerpt` e o estado vazio saíram junto — quem cuida dos três
          agora é o próprio feed, que lê o stream inteiro em vez do retrato.

          Sem a camisa `mx-auto max-w` aqui — 03/08. A coluna de leitura desceu
          pra dentro do `Feed`, porque a barra de rolagem saiu da borda da
          coluna e foi pra borda da TELA (ordem do Rica, como na referência do
          ChatGPT): quem segura o `max-width` agora é o conteúdo dentro do
          trilho, não um wrapper fora dele.

          08/08: o feed e o composer deixaram de ser irmãos numa coluna flex. O
          `<PalcoDaConversa>` sobrepõe os dois para que o feed corra POR BAIXO
          do composer — sem isso não há o que desfocar, e o desfoque é o pedido.
          O `containerType`, o fundo e o respiro do fim moraram aqui e foram
          para lá; ler o cabeçalho daquele arquivo antes de mexer nesta região. */}
      <PalcoDaConversa
        composer={
          // Sem `esforcoValor`/`esforcoPermitido`/`onEnviar`: o Composer busca o
          // painel e envia sozinho — ver o cabeçalho do próprio componente.
          <Composer
            agentSlug={agente.slug}
            agentName={agente.name}
            motor={motor}
            esforcoCobrePedido={contratoSeparaPedido(agente)}
          />
        }
      >
        <FeedDaConversa agentSlug={agente.slug} />
      </PalcoDaConversa>

      {/* Régua de medição — só com `?diag=1` na URL. Ver o cabeçalho de
          `app/api/regua/route.ts`: existe porque o Safari do iPhone é o único
          motor que eu não consigo rodar aqui. */}
      {sp.diag === '1' ? <Regua /> : null}

      {/* O shell agora vive no layout persistente. A gaveta continua na folha
          porque seus campos dependem do agente da página; como é `fixed`, ela
          conserva a mesma superfície visual fora do fluxo do palco. */}
      <GavetaPainel
        fecharHref={fecharHref}
        rotulo="detalhes do agente"
        aberto={false}
      >
        {modoPainel === 'mcps' ? (
          <VistaMcp agentSlug={agente.slug} fecharHref={fecharHref} />
        ) : (
          <Painel agente={agente} fecharHref={fecharHref} painelAberto={false} agora={agora} />
        )}
      </GavetaPainel>
    </>
  );
}
