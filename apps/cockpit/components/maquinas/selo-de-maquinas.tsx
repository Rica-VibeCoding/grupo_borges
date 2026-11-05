/**
 * O selo do atalho Abertos na raiz. O da Faxina sai do servidor ao abrir a
 * home; este é vivo, porque o que ele conta (Chrome parado há 30 min, RAM no
 * teto) muda com a raiz aberta. Lê o `resumo` compartilhado com o mini cartão
 * da tropa — uma requisição para os dois.
 *
 * Verde como o da Faxina; vermelho com a RAM acima do teto, mesmo sem parados
 * (aí escreve "!"). A cor nunca vai sozinha: o motivo vai no rótulo acessível.
 *
 * Dono: Daniel (pele).
 */
'use client';

import { Badge } from '@/components/ui/badge';
import { seloDaMaquina } from '@/lib/maquinas';

import { usaMaquinas, usaResumoDaMaquina } from './usa-resumo-da-maquina';

/** Um selo por máquina da lista (hoje uma só); cada um diz de qual é. */
export function SeloDeMaquinas() {
  return (usaMaquinas() ?? []).map((m) => <SeloDaMaquina key={m.id} id={m.id} nome={m.nome} />);
}

function SeloDaMaquina({ id, nome }: { id: string; nome: string }) {
  const selo = seloDaMaquina(usaResumoDaMaquina(id), nome);
  if (!selo.texto) return null;
  return (
    <Badge
      className="ck-tabular"
      role="img"
      aria-label={selo.descricao}
      title={selo.descricao}
      style={{
        background: selo.vermelho ? 'var(--ck-state-fail)' : 'var(--ck-atalho-fg)',
        color: 'var(--ck-surface-nav)',
      }}
    >
      {selo.texto}
    </Badge>
  );
}
