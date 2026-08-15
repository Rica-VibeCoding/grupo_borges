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

import { useState } from 'react';

import type { ContentPart } from '@grupo_borges/cockpit-core/messages-types';
import type { ToolResultLookup } from '@grupo_borges/cockpit-core/render-items';

import { AssistantMarkdown } from '@/components/renderers/markdown';
import { Thinking } from '@/components/renderers/thinking';

import { BolhaVoz } from './bolha-voz.tsx';
import { Execucao } from './execucao';
import {
  execucaoDaParte,
  execucaoDoChip,
} from './execucao-do-item';
import { CartaoCompact } from './cartao-compact';
import { DelegacaoView } from './delegacoes.tsx';
import type { ItemDoFeed } from './grupo-ferramentas.ts';
import { GrupoFerramentasView } from './grupo-ferramentas.tsx';
import { LinhaVivaView } from './linha-viva.tsx';
import { leAnexoImagem } from './anexo-imagem';
import { AnexoImagemView } from './cartao-anexo-imagem.tsx';
import { leEnvelopeDeCanal, procedencia } from './envelope-de-canal.ts';
import { resumoDeUmaLinha, temMaisParaMostrar } from './linha-seca.ts';

type Props = {
  item: ItemDoFeed;
  lookup?: ToolResultLookup;
  agentSlug?: string;
  estaRodando?: boolean;
};

/* -------------------------------------------------------------------------- */
/* Formas menores — uma linha, sem moldura                                    */
/* -------------------------------------------------------------------------- */

/** Texto literal do humano: nunca passa por markdown. O que o Rica digitou é o
 *  que aparece, inclusive quando ele digita crase. */
function Fala({ texto, tom }: { texto: string; tom?: 'discreto' }) {
  return (
    <p
      style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        color: tom === 'discreto' ? 'var(--ck-text-tertiary)' : 'var(--ck-text-primary)',
        fontSize: tom === 'discreto' ? 'var(--ck-text-sm)' : 'var(--ck-text-md)',
      }}
    >
      {texto}
    </p>
  );
}

/** Linha de sistema, sem a caixinha — ordem do Rica, 02/08: "sem borda, sem
 *  fundo, sem badge". O rótulo é overline (12px, uppercase, tracking largo):
 *  lê-se como legenda, não como chip. Corpo em secondary — tertiary em texto
 *  de corpo é reprovação direta do contrato (3.55:1).
 *
 *  Uma linha continua sendo o desenho certo, mas ela deixou de ser MUDA sobre
 *  o que esconde: medido no chat do Rica em 15/08, viewport de iPhone, 23px
 *  visíveis de 555px reais — 4% do texto. Ele leu o conjunto como "tudo sai
 *  truncado". Quando há mais atrás das reticências, a linha inteira vira alvo
 *  e abre no lugar; corpo curto ("60 passos") não ganha controle nenhum. */
function LinhaSeca({ rotulo, corpo }: { rotulo: string; corpo?: string }) {
  const [aberta, setAberta] = useState(false);
  const podeAbrir = temMaisParaMostrar(corpo);

  const miolo = (
    <>
      <span
        style={{
          flexShrink: 0,
          fontSize: 'var(--ck-text-xs)',
          letterSpacing: 'var(--ck-track-overline)',
          textTransform: 'uppercase',
        }}
      >
        {rotulo}
      </span>
      {corpo ? (
        <span
          style={{
            fontSize: 'var(--ck-text-sm)',
            minWidth: 0,
            flex: 1,
            ...(aberta
              ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
              : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          }}
        >
          {aberta ? corpo : resumoDeUmaLinha(corpo)}
        </span>
      ) : null}
    </>
  );

  const forma = {
    display: 'flex',
    gap: 'var(--ck-space-2)',
    alignItems: aberta ? 'flex-start' : 'baseline',
    minWidth: 0,
    width: '100%',
    textAlign: 'left' as const,
    color: 'var(--ck-text-secondary)',
  };

  if (!podeAbrir) return <div style={forma}>{miolo}</div>;

  return (
    <button
      type="button"
      onClick={() => setAberta((estava) => !estava)}
      aria-expanded={aberta}
      aria-label={aberta ? `Fechar ${rotulo}` : `Abrir ${rotulo} por inteiro`}
      style={{ ...forma, minHeight: 'var(--ck-touch-min)', alignItems: aberta ? 'flex-start' : 'center' }}
    >
      {miolo}
    </button>
  );
}

function Parte({
  parte,
  lookup,
  cursorNoFim = false,
}: {
  parte: ContentPart;
  lookup?: ToolResultLookup;
  cursorNoFim?: boolean;
}) {
  switch (parte.type) {
    case 'text':
      // Texto vazio não vira parágrafo fantasma com moldura.
      return parte.text.length > 0 ? (
        <AssistantMarkdown cursorNoFim={cursorNoFim}>{parte.text}</AssistantMarkdown>
      ) : null;
    case 'thinking':
      return <Thinking content={parte.thinking} />;
    case 'tool_use':
      return <Execucao entrada={execucaoDaParte(parte, lookup)} />;
    case 'tool_result':
      // O classificador dobra `tool_result` dentro do lookup, então chegar aqui
      // significa resultado órfão — mostrar seco vale mais que sumir.
      return (
        <LinhaSeca
          rotulo={parte.is_error === true ? 'resultado órfão · erro' : 'resultado órfão'}
          corpo={typeof parte.content === 'string' ? parte.content : undefined}
        />
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Item                                                                        */
/* -------------------------------------------------------------------------- */

export function CorpoDoItem({ item, lookup, agentSlug, estaRodando = false }: Props) {
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
      const anexo = leAnexoImagem(item.text);
      if (anexo?.filename && agentSlug) {
        return (
          <AnexoImagemView
            anexo={{ filename: anexo.filename, legenda: anexo.legenda }}
            agentSlug={agentSlug}
          />
        );
      }
      if (anexo && !anexo.legenda) return null;
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
          className="w-fit max-w-[var(--ck-read-mid)] self-end rounded-[var(--ck-radius-frame)]"
          style={{ background: 'var(--ck-surface-raised)', padding: 'var(--ck-space-3)' }}
        >
          {item.enfileirada ? (
            // O composer já avisa "entrou na fila" (usa-envio.ts:113); esta é
            // a metade do feed concordando com ele. Cai sozinha quando o eco
            // chega, então é estado do turno — não carimbo de histórico.
            <div style={{ color: 'var(--ck-text-tertiary)', fontSize: 'var(--ck-text-xs)' }}>
              na fila
            </div>
          ) : null}
          <Fala texto={anexo?.legenda ?? item.text} />
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
          {falado.length > 0 && agentSlug ? (
            <BolhaVoz texto={falado} agentSlug={agentSlug} />
          ) : null}
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
          className="w-fit max-w-[var(--ck-read-mid)] self-end rounded-[var(--ck-radius-frame)]"
          style={{ background: 'var(--ck-surface-raised)', padding: 'var(--ck-space-3)' }}
        >
          <Fala texto={item.rawText} />
        </div>
      ) : (
        <LinhaSeca rotulo={item.syntheticKind} corpo={item.rawText} />
      );
    case 'channel': {
      // Mensagem que ele mandou de fora é ELE falando — mesma bolha do texto
      // digitado aqui, ordem de 30/07 ("o meu vai em balão") e a de 15/08
      // ("tenho que pensar que estou no mesmo app"). Antes desta linha o feed
      // desenhava o XML inteiro numa linha cortada, e ele leu como "quebrado".
      // A procedência vira legenda discreta; o anexo, quando o envelope
      // declara, sai como metadado — sem player, porque a rota de mídia deste
      // caminho não existe no v2 e prometer um vídeo que não toca é pior.
      const envelope = leEnvelopeDeCanal(item.raw);
      if (!envelope) return <LinhaSeca rotulo="canal" corpo={item.raw} />;
      // Foto que ele mandou de fora: mesmo cartão do anexo daqui — imagem em
      // cima, o que ele escreveu embaixo. É a forma que ele aprovou em 15/08,
      // olhando o chat da Tara. `(photo)` é o corpo que o plugin escreve
      // quando a mensagem é só a imagem: legenda dele, não é.
      if (envelope.anexo?.caminho && envelope.anexo.tipo === 'image' && agentSlug) {
        const legenda = envelope.texto === '(photo)' ? null : envelope.texto || null;
        return (
          <AnexoImagemView
            anexo={{ filename: envelope.anexo.caminho, legenda }}
            agentSlug={agentSlug}
            procedencia={procedencia(envelope)}
          />
        );
      }
      return (
        <div
          className="w-fit max-w-[var(--ck-read-mid)] self-end rounded-[var(--ck-radius-frame)]"
          style={{ background: 'var(--ck-surface-raised)', padding: 'var(--ck-space-3)' }}
        >
          <div
            style={{
              color: 'var(--ck-text-secondary)',
              fontSize: 'var(--ck-text-xs)',
              letterSpacing: 'var(--ck-track-overline)',
              textTransform: 'uppercase',
            }}
          >
            {procedencia(envelope)}
          </div>
          {envelope.anexo ? (
            <div style={{ color: 'var(--ck-text-secondary)', fontSize: 'var(--ck-text-sm)' }}>
              {envelope.anexo.nome ?? envelope.anexo.tipo}
            </div>
          ) : null}
          {envelope.texto ? <Fala texto={envelope.texto} /> : null}
        </div>
      );
    }

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
