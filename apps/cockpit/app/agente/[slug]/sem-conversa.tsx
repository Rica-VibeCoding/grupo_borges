'use client';

// O vazio da conversa: o retrato do agente e a saudação pela hora.
// Saiu de `feed-da-conversa.tsx` (02/10), sem mudança.

import { useEffect, useState } from 'react';

import { Retrato } from '@/components/shell/retrato.tsx';

/** A coluna de leitura não vem mais de um wrapper na página (ela desceu pra
 *  dentro do Feed, pra barra de rolagem encostar na borda da tela) — o estado
 *  vazio se centra sozinho na mesma medida. `key={geracao}` + `ck-feed-enter`:
 *  após um Restart, a saudação nasce com fade em vez de piscada dura. Virou
 *  peça própria quando a Tara ganhou o segundo ramo: os dois precisam do MESMO
 *  vazio, e vazio duplicado é vazio que diverge.
 *
 *  16/08 — saudação estilo Claude (referência que o Rica mandou): o retrato do
 *  agente como marca + "Boa tarde, Rica" centralizados, no lugar do "Sem
 *  conversa ainda." no topo. A hora se resolve DEPOIS do mount (useEffect): o
 *  componente é pré-renderizado no servidor, e `getHours()` no corpo daria HTML
 *  do servidor ≠ do cliente — hydration mismatch. Primeiro paint é só o
 *  retrato; o texto entra no primeiro efeito. */
export function SemConversa({ geracao, agentSlug }: { geracao: number; agentSlug: string }) {
  const [saudacao, setSaudacao] = useState<string | null>(null);
  useEffect(() => {
    const hora = new Date().getHours();
    setSaudacao(hora < 5 || hora >= 18 ? 'Boa noite, Rica' : hora < 12 ? 'Bom dia, Rica' : 'Boa tarde, Rica');
  }, []);

  return (
    <div
      key={geracao}
      className="ck-feed-enter flex min-h-0 flex-1 flex-col items-center justify-center"
      style={{ gap: 'var(--ck-space-5)', padding: '0 var(--ck-space-4)' }}
    >
      <Retrato slug={agentSlug} nome={agentSlug} tamanho={56} />
      <p
        style={{
          margin: 0,
          minHeight: 'calc(var(--ck-text-hero) * var(--ck-leading-hero))',
          fontSize: 'var(--ck-text-hero)',
          lineHeight: 'var(--ck-leading-hero)',
          letterSpacing: 'var(--ck-track-hero)',
          color: 'var(--ck-text-secondary)',
          textAlign: 'center',
        }}
      >
        {saudacao}
      </p>
    </div>
  );
}
