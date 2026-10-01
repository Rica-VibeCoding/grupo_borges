import { notFound } from 'next/navigation';
import { fetchAgent } from '@grupo_borges/cockpit-core/api';
import type { Agent } from '@grupo_borges/cockpit-core/cockpit-types';
import { GavetaNova } from '@/components/gaveta/gaveta-nova';
import { PagerDoAgente } from '@/components/conversa/pager-do-agente';
import { BarraDeTelas } from '@/components/shell/barra-de-telas';
import { Composer } from '@/components/shell/composer';
import { PainelMcp } from '@/components/shell/mcp-painel';
import { contratoSeparaPedido, leMotor } from '@/components/shell/motor';
import { Regua } from '@/components/shell/regua';
import { GavetaPainel, LinkFechaPainel } from '@/components/shell/superficie-otimista';
import { LinkDaGaveta, VistaDaGaveta } from '@/components/shell/vista-da-gaveta';
import { FeedDaConversa } from './feed-da-conversa';
import { PalcoDaConversa } from './palco-da-conversa';

export const dynamic = 'force-dynamic';

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
        <LinkDaGaveta
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
        </LinkDaGaveta>
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
  const agente = await fetchAgent(slug);

  if (!agente) notFound();

  const fecharHref = `/agente/${slug}`;
  // O esforço entra JUNTO com o modelo, na mesma renderização do servidor. Sem
  // ele o rótulo nasce só com o nome e o nível chega no segundo pedido, o
  // `/painel` — 1,8s, medido em 12/08. O nome andava para a esquerda
  // quando o nível aparecia, e é esse pulo que o Rica filmou na troca de
  // agente. Os dois campos são mutuamente exclusivos (um por família).
  const motor = leMotor({
    modeloSessao: agente.state_model,
    modeloPadrao: agente.model_default,
    esforco: agente.codex_reasoning_effort,
  });
  // Relógio do servidor, na mesma régua da rota `/`: `force-dynamic`
  // re-renderiza a cada navegação ao agente (abrir a gaveta não navega mais
  // desde 28/09 — a gaveta fica montada). Daqui pra frente quem faz o ponteiro ANDAR é o
  // `StatuslineAoVivo`, que usa este valor como âncora e conta o resto pelo
  // cronômetro do browser — nunca pela hora dele.
  const agora = Math.floor(Date.now() / 1000);
  // Qual visão a gaveta desenha NÃO se decide aqui desde 28/09: o `?painel=` é
  // lido no cliente (`VistaDaGaveta`), e nada neste servidor lê `?painel`/`?nav`
  // — é isso que deixa abrir e fechar a gaveta e a tropa sem ida ao servidor.

  return (
    <>
      {/* O chat e a voz na mesma tela (fase 3, pager): o chat é o painel da esquerda, a voz o
          da direita, e o dedo passa de um ao outro pela rolagem nativa, sem trocar de rota.
          `/conversa/{slug}` chega aqui com `?tela=voz` e abre na voz. A direita no chat abre
          a tropa. */}
      <PagerDoAgente slug={agente.slug} nome={agente.name} inicial={sp.tela === 'voz' ? 'voz' : 'chat'}>
      {/* Chrome do topo — nav overlay, cápsula do agente (retrato, nome, estado)
          à esquerda e pílula de tokens à direita. A cápsula abre o painel. */}
      <BarraDeTelas
        agente={{ slug: agente.slug, nome: agente.name }}
        // Os dois destinos separados: o `BotaoNav` alterna pelo estado
        // otimista, não pelo que a URL já refletiu.
        abrirNavHref={`${fecharHref}?nav=aberto`}
        fecharNavHref={fecharHref}
        navAberta={false}
        hrefAbrirPainel={`${fecharHref}?painel=detalhes`}
      />

      {/* Aqui morava o cabeçalho de identidade — retrato, nome e estado — e a
          linha que o separava do feed. Saiu por ordem do Rica (30/07): o agente
          já aparece selecionado e destacado na tropa à esquerda, e desde a MESA
          E A FOLHA (estética §8) a aba do item selecionado ENCOSTA nesta folha. Repetir
          o nome no topo do chat era dizer duas vezes, com a linha divisória
          cobrando altura de tela no celular para separar o feed de nada.

          Nenhum substituto entra agora, e isso é literal: *"se sentir falta de
          uma identidade dentro do chat eu aviso, mas não seria o que está"*.
          Inventar uma marca d'água ou um nome discreto aqui seria trocar o que
          ele mandou tirar por uma versão menor da mesma coisa.

          Ele avisou em 16/08, e a identidade voltou onde ele pediu: dentro da
          `BarraDeTelas` acima, como cápsula (na ponta direita desde 27/09). Aqui continua não
          entrando nada — o que ele reprovou era a faixa, não a foto. */}

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
      </PagerDoAgente>

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
        {/* As duas visões vão prontas; quem escolhe é o cliente, pela URL
            (`VistaDaGaveta`) — abrir, fechar e trocar de visão não voltam ao
            servidor. */}
        <VistaDaGaveta
          mcps={<VistaMcp agentSlug={agente.slug} fecharHref={fecharHref} />}
          detalhes={<GavetaNova agente={agente} fecharHref={fecharHref} agora={agora} />}
        />
      </GavetaPainel>
    </>
  );
}
