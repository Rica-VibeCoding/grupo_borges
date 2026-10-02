'use client';

// A fala que o Rica mandou por um canal de fora, no balão dele. Saiu do
// `case 'channel'` de `corpo-do-item.tsx` (02/10) como função de desenho, e não
// componente: chamada no mesmo ponto do `switch`, a árvore fica idêntica.

import { IconeMicrofone } from '@/components/shell/icones';

import { AnexoImagemView } from './cartao-anexo-imagem.tsx';
import { ehVoz, leEnvelopeDeCanal, procedencia } from './envelope-de-canal.ts';
import { Fala, LinhaSeca } from './formas-menores.tsx';
import type { ItemDoFeed } from './grupo-ferramentas.ts';

export function desenhaFalaDeCanal(item: Extract<ItemDoFeed, { kind: 'channel' }>, agentSlug?: string) {
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
      {/* Metadado discreto (28/09): microfone quando é voz + o canal pelo
          nome. Duração não vai: o envelope não a traz. */}
      <div
        className="flex items-center"
        style={{
          gap: 'var(--ck-space-1)',
          color: 'var(--ck-text-secondary)',
          fontSize: 'var(--ck-text-xs)',
        }}
      >
        {ehVoz(envelope) ? <IconeMicrofone tamanho={12} /> : null}
        {procedencia(envelope)}
      </div>
      {envelope.anexo && !ehVoz(envelope) ? (
        <div style={{ color: 'var(--ck-text-secondary)', fontSize: 'var(--ck-text-sm)' }}>
          {envelope.anexo.nome ?? envelope.anexo.tipo}
        </div>
      ) : null}
      {envelope.texto ? <Fala texto={envelope.texto} /> : null}
    </div>
  );
}
