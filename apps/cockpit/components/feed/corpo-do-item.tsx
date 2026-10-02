'use client';

// Ponte RenderItem → renderers reais.
//
// Esta é a única camada que sabe traduzir o vocabulário do classificador para o
// vocabulário visual. `components/renderers/**` é de CONSUMO: se algo aqui
// precisar de um renderer diferente, o conserto é uma conversa, não uma edição
// lá dentro.
//
// A tese do cockpit v2 é que 82% do que passa por aqui é `tool_use` — então o
// caminho quente é `LinhaExecucao`, e ela nasce colapsada.

import { memo } from 'react';

import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { Execucao } from './execucao';
import { execucaoDoChip } from './execucao-do-item';
import { CartaoCompact } from './cartao-compact';
import { DelegacaoView } from './delegacoes.tsx';
import { desenhaFalaDeCanal } from './fala-de-canal.tsx';
import { Fala, LinhaSeca, Parte } from './formas-menores.tsx';
import type { ItemDoFeed } from './grupo-ferramentas.ts';
import { GrupoFerramentasView } from './grupo-ferramentas.tsx';
import { LinhaVivaView } from './linha-viva.tsx';
import { MarcoDaTrocaView, PedidoDoCockpitView, TrocaEmAndamentoView } from './marco-da-troca.tsx';
import { RodapeDaFala } from './rodape-da-fala.tsx';
import { leAnexoImagem, semEnvelopeDeColagem, urlDoAnexoImagem } from './anexo-imagem';
import { leAnexoVideo } from './anexo-video.ts';
import { BolhaAnexoOtimista, PREFIXO_ANEXO_OTIMISTA } from './bolha-anexo-otimista.tsx';
import { AnexoImagemView } from './cartao-anexo-imagem.tsx';
import { AnexoVideoView } from './cartao-anexo-video.tsx';
import { mesmasPropsDoItem } from './mesmo-item.ts';

type Props = {
  item: ItemDoFeed;
  lookup?: ToolResultLookup;
  agentSlug?: string;
  estaRodando?: boolean;
};

/* -------------------------------------------------------------------------- */
/* Item                                                                        */
/* -------------------------------------------------------------------------- */

function CorpoDoItem({ item, lookup, agentSlug, estaRodando = false }: Props) {
  switch (item.kind) {
    case 'compact-summary':
      // O resumo do /compact NÃO é fala do Rica — é evento da máquina e tem
      // cartão próprio, fechado por padrão. Antes deste caso o texto caía em
      // `user` e o feed cuspia dezenas de linhas como mensagem digitada.
      return (
        <CartaoCompact
          texto={item.text}
          uuid={item.payload.uuid}
          {...(item.compactMeta ? { compactMeta: item.compactMeta } : {})}
          {...(agentSlug ? { agentSlug } : {})}
        />
      );

    case 'user': {
      // O envelope chega picado em duas mensagens desde que o CC passou a
      // anexar a imagem sozinho: uma traz a legenda, a outra o caminho. Cada
      // metade desenha o que tem — foto com legenda quando as duas vieram
      // juntas (fila, envelope inteiro), foto sozinha e legenda sozinha
      // quando não. O que não tem nenhuma das duas já saiu no filtro.
      //
      // A bolha otimista de anexo vem antes de tudo: o texto dela é só a
      // legenda, e o arquivo mora no store (`bolha-anexo-otimista.tsx`).
      const uuid = item.payload.uuid;
      if (agentSlug && uuid?.startsWith(PREFIXO_ANEXO_OTIMISTA)) {
        return <BolhaAnexoOtimista agentSlug={agentSlug} uuid={uuid} />;
      }
      const anexo = leAnexoImagem(item.text);
      if (anexo?.filename && agentSlug) {
        return (
          <AnexoImagemView
            anexo={{
              filename: anexo.filename,
              legenda: anexo.legenda ? semEnvelopeDeColagem(anexo.legenda) : anexo.legenda,
            }}
            agentSlug={agentSlug}
          />
        );
      }
      if (anexo && !anexo.legenda) return null;
      // O vídeo chega inteiro, numa mensagem só (`anexo-video.ts`). Antes daqui
      // ele caía no balão de texto, com caminho absoluto e recado de ffmpeg.
      const video = agentSlug ? leAnexoVideo(semEnvelopeDeColagem(item.text)) : null;
      if (video && agentSlug) {
        return (
          <AnexoVideoView
            url={urlDoAnexoImagem(agentSlug, video.filename)}
            legenda={video.legenda}
          />
        );
      }
      // Balão — ordem do Rica, 30/07: "o meu vai em balão, o de vcs fica
      // solto". `w-fit` segura a caixa no tamanho do texto dentro do
      // flex-column do feed; sem ele ela estica (`align-items: stretch` é o
      // padrão do eixo cruzado) e o balão vira uma faixa cheia.
      //
      // `self-end` desde 02/08, testando o v2: *"o input que eu mando fica do
      // lado esquerdo junto com o output, o certo seria do lado direito"*. A
      // ordem de 30/07 tinha decidido balão contra solto, não o lado — com os
      // dois à esquerda, a fala dele e a da máquina começavam na mesma margem e
      // só o fundo separava. O lado é o que distingue quem falou antes de ler.
      return (
        <div
          // Desenho novo (16/08, referências Claude/ChatGPT do Rica): a bolha
          // veste `--ck-radius-caixa` — o token criado pra "superfície que
          // RECEBE fala" (globals.css:289) — e padding horizontal maior. O
          // `frame` (8px) continua pra conteúdo que MOSTRA saída.
          //
          // Teto RELATIVO desde 17/08 (leva 2, pergunta do Rica): a convenção
          // documentada (shadcn Bubble: ≤80% do container) é a bolha do
          // usuário mais estreita que a coluna do assistente — e aqui os dois
          // tinham o MESMO teto de 640px, o que no iPhone deixava a fala dele
          // pegar a tela quase toda. `w-fit` continua encolhendo ao texto.
          className="w-fit max-w-[80%] self-end rounded-[var(--ck-radius-caixa)]"
          style={{ background: 'var(--ck-surface-raised)', padding: 'var(--ck-space-3) var(--ck-space-4)' }}
          // A ponta de chegada do voo do envio (`lib/voo-do-envio.ts`): só a
          // bolha otimista se marca, porque só ela nasce do toque no campo.
          data-eco={item.payload.uuid?.startsWith('cc-otimista-') ? item.payload.uuid : undefined}
        >
          {item.enfileirada ? (
            // O composer já avisa "entrou na fila" (usa-envio.ts:113); esta é
            // a metade do feed concordando com ele. Cai sozinha quando o eco
            // chega, então é estado do turno — não carimbo de histórico.
            <div style={{ color: 'var(--ck-text-secondary)', fontSize: 'var(--ck-text-xs)' }}>
              na fila
            </div>
          ) : null}
          <Fala texto={semEnvelopeDeColagem(anexo?.legenda ?? item.text)} />
        </div>
      );
    }
    case 'user-internal':
      return <Fala texto={item.text} tom="discreto" />;
    case 'meta-decision':
      return <Fala texto={item.text} tom="discreto" />;

    case 'assistant': {
      // A fala do agente ganha a bolha de voz embaixo do texto — o texto fica
      // (decisão do Rica, 11/08). Só quando há texto: resposta que é só
      // execução de ferramenta não tem o que falar.
      const falado = item.parts
        .map((parte) => (parte.type === 'text' ? parte.text : ''))
        .join('\n')
        .trim();
      const ultimoTexto = item.parts.reduce(
        (ultimo, parte, indice) =>
          parte.type === 'text' && /\S/.test(parte.text) ? indice : ultimo,
        -1,
      );
      return (
        <>
          {item.parts.map((parte, indice) => (
            <Parte
              key={indice}
              parte={parte}
              lookup={lookup}
              cursorNoFim={estaRodando && indice === ultimoTexto}
            />
          ))}
          <RodapeDaFala texto={falado} payload={item.payload} agentSlug={agentSlug} />
        </>
      );
    }

    case 'chip':
      return item.classifierKind === 'tool' ? (
        <Execucao entrada={execucaoDoChip(item, lookup)} />
      ) : (
        <LinhaSeca rotulo={item.chip.label} corpo={item.chip.summary || item.expandBody} />
      );

    case 'grupo-ferramentas':
      return <GrupoFerramentasView grupo={item} lookup={lookup} />;

    case 'linha-viva':
      return <LinhaVivaView desdeMs={item.desdeMs} />;

    case 'delegacao':
      return <DelegacaoView quem={item.quem} alvo={item.alvo} desdeMs={item.desdeMs} />;

    case 'pedido-do-cockpit':
      return (
        <PedidoDoCockpitView
          pedido={item}
          renderiza={(membro) => <CorpoDoItem item={membro} lookup={lookup} {...(agentSlug ? { agentSlug } : {})} />}
        />
      );

    case 'marco-da-troca':
      return <MarcoDaTrocaView troca={item.troca} />;

    case 'troca-em-andamento':
      return <TrocaEmAndamentoView troca={item.troca} {...(agentSlug ? { agentSlug } : {})} />;

    case 'synthetic':
      // `stt` não é evento de sistema: é o Rica falando, e chegou por voz em vez
      // de teclado. Estava caindo no mesmo desenho dos wakeups — linha cinza,
      // truncada, rótulo técnico — e ele leu isso como defeito no teste de 02/08
      // (*"o texto ficou embaixo"*). Wakeup é máquina se anunciando e continua
      // discreto; a fala dele ganha o mesmo balão do texto digitado, porque é a
      // mesma pessoa dizendo a mesma coisa por outra porta. O 🎙 já vem no
      // `raw_text` e é o que distingue as duas portas — não precisa de rótulo.
      return item.syntheticKind === 'stt' ? (
        <div
          // Desenho novo (16/08, referências Claude/ChatGPT do Rica): a bolha
          // veste `--ck-radius-caixa` — o token criado pra "superfície que
          // RECEBE fala" (globals.css:289) — e padding horizontal maior. O
          // `frame` (8px) continua pra conteúdo que MOSTRA saída.
          //
          // Teto RELATIVO desde 17/08 (leva 2, pergunta do Rica): a convenção
          // documentada (shadcn Bubble: ≤80% do container) é a bolha do
          // usuário mais estreita que a coluna do assistente — e aqui os dois
          // tinham o MESMO teto de 640px, o que no iPhone deixava a fala dele
          // pegar a tela quase toda. `w-fit` continua encolhendo ao texto.
          className="w-fit max-w-[80%] self-end rounded-[var(--ck-radius-caixa)]"
          style={{ background: 'var(--ck-surface-raised)', padding: 'var(--ck-space-3) var(--ck-space-4)' }}
        >
          <Fala texto={item.rawText} />
        </div>
      ) : (
        <LinhaSeca rotulo={item.syntheticKind} corpo={item.rawText} />
      );
    case 'channel':
      // A mensagem que ele mandou por um canal de fora — `fala-de-canal.tsx`.
      return desenhaFalaDeCanal(item, agentSlug);

    case 'sidechain-group':
      return (
        <LinhaSeca
          rotulo="& subagente"
          corpo={`${item.count} ${item.count === 1 ? 'passo' : 'passos'}`}
        />
      );
    case 'sidechain-cluster':
      return (
        <LinhaSeca
          rotulo="& subagentes"
          corpo={`${item.subagentCount} em paralelo`}
        />
      );

    case 'ask-user':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ck-space-1)' }}>
          <LinhaSeca rotulo="pergunta" corpo={item.entry.status} />
          {item.entry.questions.map((questao, indice) => (
            <Fala key={indice} texto={typeof questao === 'string' ? questao : JSON.stringify(questao)} />
          ))}
        </div>
      );
  }
}

const CorpoDoItemMemo = memo(CorpoDoItem, mesmasPropsDoItem);
export { CorpoDoItemMemo as CorpoDoItem };
