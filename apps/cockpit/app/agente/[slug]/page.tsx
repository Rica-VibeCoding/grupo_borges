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

/**
 * O TÍTULO DA GAVETA — o caminho do workspace do agente, no formato que o Rica
 * escreveu: `Workspace - /home/clawd/repos/grupo_borges`. Ele subiu para cá em
 * 09/08, ocupando o lugar da overline "Comandos", quando os quatro campos da
 * ficha saíram ("já já temos eles" — modelo na statusline, sessão no chrome).
 *
 * **Trunca pelo COMEÇO**, ordem dele: o fim do caminho é o que identifica o
 * repositório. Não é `.truncate` (que corta o fim) — é `direction: rtl` no
 * contêiner, que joga transbordo e reticências para a esquerda.
 *
 * O `<bdi>` não é decoração: com `rtl` sozinho o algoritmo bidirecional trata a
 * `/` inicial como neutra e a manda para o fim — `/home/clawd/repos` sai
 * desenhado `home/clawd/repos/` (medido em 09/08, os três candidatos lado a
 * lado no browser). O `unicode-bidi: plaintext` resolve a direção pelo primeiro
 * caractere forte, o `h` latino, e o caminho volta a correr da esquerda para a
 * direita dentro de um contêiner que transborda pela esquerda.
 *
 * O DOM guarda o caminho inteiro — o corte é só visual, então leitor de tela e
 * cópia pegam tudo, e o `title` cobre o ponteiro no desktop.
 */
function TituloWorkspace({ caminho }: { caminho: string | null }) {
  if (!caminho) return null;
  return (
    <div
      className="flex min-w-0 items-baseline"
      style={{ gap: 'var(--ck-space-2)', padding: 'var(--ck-space-3) var(--ck-space-4)' }}
      title={caminho}
    >
      <span
        className="shrink-0"
        style={{ fontSize: 'var(--ck-text-sm)', color: 'var(--ck-text-secondary)' }}
      >
        Workspace -
      </span>
      <span
        className="min-w-0 overflow-hidden"
        style={{
          direction: 'rtl',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: 'var(--ck-font-mono)',
          fontSize: 'var(--ck-text-sm)',
          color: 'var(--ck-text-primary)',
        }}
      >
        <bdi style={{ unicodeBidi: 'plaintext' }}>{caminho}</bdi>
      </span>
    </div>
  );
}

/** Rótulo de seção — a mesma overline do cabeçalho, em um lugar só para a
 *  gaveta nova (09/08). */
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

/** A GAVETA — a segunda passada de 09/08, com o Rica revendo item por item o
 *  que a primeira tinha entregue. Quase tudo que eu ia ARRUMAR ele mandou
 *  TIRAR, e o resultado é uma gaveta que perdeu quase metade da altura:
 *
 *  - **O título é o workspace** (`TituloWorkspace` acima), no lugar exato onde
 *    estava a overline "Comandos".
 *  - **Permissões** e os três botões — o que restou das ações rápidas. **O
 *    esforço saiu**: *"já temos ele no input"*, e o input é o composer. Ver o
 *    cabeçalho do `bloco-de-acoes.tsx`.
 *  - **Cota usada**, irmã das ações e não parte delas (leitura, não comando).
 *  - **Statusline** — modelo · sessão · contexto numa linha só, a barra
 *    ocupando o campo inteiro. Com a ficha fora, ela é a ÚNICA fonte do modelo
 *    na gaveta; foi por isso que o fallback dela deixou de ser o valor cru do
 *    banco (ver o `statusline.tsx`). O teto de 30% continua sendo a cor — nada
 *    é desenhado por cima da barra.
 *  - **MCPs** na base — a porta para a tela do Vinicius (15ccf76).
 *
 *  O QUE SAIU, e por ordem dele: os quatro campos da ficha (*"já já temos
 *  eles"* — modelo na statusline, sessão no chrome, e o workspace subiu pro
 *  título); o slot "Comandos do painel", placeholder e tudo (*"quando ele
 *  passar a lista, a gente cria de novo"* — reservar espaço para uma lista que
 *  não existe é ocupar tela com promessa); e o rótulo "Detalhes", que virou
 *  "Painel". A URL `?painel=detalhes` NÃO mudou junto, de propósito: ela é
 *  deep-link publicado, e renomear valor de parâmetro por causa de rótulo
 *  visível quebra link que já circulou.
 *
 *  O `flex-auto` (base no conteúdo) NÃO o `flex-1` (base 0) continua sendo a
 *  régua da gaveta: o pai (`.ck-flutua`) tem altura vinda do CONTEÚDO, e item
 *  com base 0 contribui 0 pro tamanho intrínseco do pai no WebKit — era a
 *  gaveta com 0px de altura no iPhone do Rica (02/08). Quem carrega o
 *  `flex-auto` agora é o miolo (comandos + cota): a ficha era a área que
 *  rolava, e sem ela a gaveta ficaria sem NENHUM item elástico — no iPhone
 *  deitado, com o `max-height` mordendo, o conteúdo seria cortado sem rolagem
 *  em vez de rolar. O `min-h-0` é o que deixa esse item encolher. */
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
        <Rotulo>Painel</Rotulo>
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

      {/* O TÍTULO — o workspace, no lugar da overline "Comandos" (09/08). */}
      <div className="shrink-0">
        <TituloWorkspace caminho={agente.workspace_path} />
      </div>

      {/* OS COMANDOS E A COTA — o miolo, e o único item elástico da gaveta.
          Ele não rola no tamanho de hoje (o conteúdo cabe de sobra desde que o
          esforço e a ficha saíram); é a rede para o iPhone deitado, onde o
          `max-height` do `.ck-flutua` morde antes do conteúdo terminar. Sem
          nenhum `flex-auto` na coluna, ali o fim seria cortado em silêncio. */}
      <div className="flex min-h-0 flex-auto flex-col overflow-y-auto">
        <BlocoDeAcoes agentSlug={agente.slug} aberto={painelAberto} />
      </div>

      {/* STATUSLINE — o lugar central que o Rica pediu (09/08): telemetria
          viva (modelo · sessão · contexto) numa linha só. A barra ocupa o
          campo inteiro (`larguraDaBarra={null}`), e o teto de 30% continua
          sendo a cor e o `title` — nada é desenhado por cima (ordem de 09/08:
          "passou de 30% muda de cor"). */}
      <section
        aria-label="status do agente"
        className="flex shrink-0 flex-col border-t"
        style={{
          gap: 'var(--ck-space-2)',
          padding: 'var(--ck-space-4)',
          borderColor: 'var(--ck-edge-light)',
        }}
      >
        <Statusline agente={agente} agora={agora} larguraDaBarra={null} />
      </section>

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
