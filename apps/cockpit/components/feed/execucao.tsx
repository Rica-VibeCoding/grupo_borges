'use client';

// A execução individual, com o corpo rico resolvido.
//
// Saiu de `corpo-do-item.tsx` em 02/08 quando o grupo de ferramentas passou a
// precisar da MESMA peça para cada membro expandido — dois call-sites, um
// componente. A escolha da entrada continua em `execucao-do-item.ts`; aqui só
// se desenha o que foi escolhido.

// Extensão `.tsx` explícita nos renderers de propósito: cada renderer tem um
// `.ts` irmão de mesmo nome (a lógica testada), e a resolução sem extensão
// acha o `.ts` primeiro. O componente só sai pelo caminho completo.
import { AgentResult } from '@/components/renderers/agent-result.tsx';
import { FetchResult } from '@/components/renderers/fetch-result.tsx';
import { FileContent } from '@/components/renderers/file-content.tsx';
import { LinhaExecucao } from '@/components/renderers/linha-execucao';
import { PublishedPage } from '@/components/renderers/published-page.tsx';
import { ResultList } from '@/components/renderers/result-list.tsx';
import { ShellOutput } from '@/components/renderers/shell-output.tsx';
import { StatusLine } from '@/components/renderers/status-line.tsx';

import { familiaDoRich, type EntradaDaExecucao } from './execucao-do-item';

export function Execucao({ entrada }: { entrada: EntradaDaExecucao }) {
  // O `rich` é o tool_use_result cru. A família foi escolhida (e provada contra
  // fixture real) no `familiaDoRich`; sem família, `corpoRico` fica undefined e
  // a LinhaExecucao cai no `Saida` genérico de sempre — caminho intacto.
  const familia = familiaDoRich(entrada.rich);
  const corpoRico =
    familia === 'fetch' ? (
      <FetchResult valor={entrada.rich} />
    ) : familia === 'lista' ? (
      <ResultList valor={entrada.rich} />
    ) : familia === 'agente' ? (
      <AgentResult valor={entrada.rich} />
    ) : familia === 'arquivo' ? (
      <FileContent valor={entrada.rich} />
    ) : familia === 'status' ? (
      <StatusLine valor={entrada.rich} />
    ) : familia === 'pagina-publicada' ? (
      <PublishedPage valor={entrada.rich} />
    ) : familia === 'shell' ? (
      <ShellOutput valor={entrada.rich} />
    ) : undefined;

  return (
    <LinhaExecucao
      toolName={entrada.toolName}
      args={entrada.args}
      result={entrada.result}
      isError={entrada.isError}
      estado={entrada.estado}
      corpoRico={corpoRico}
    />
  );
}
