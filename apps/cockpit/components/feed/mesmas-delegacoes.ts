// O poll de `/api/delegacoes` responde a cada 3 s com um array NOVO — mesmo
// vazio, mesmo idêntico ao anterior. Entregue cru ao `useState`, cada resposta
// era um render da conversa inteira com o agente parado. O React só pula o
// render quando o valor novo é `Object.is` ao atual (react.dev/reference/react/
// useState, "If the new value you provide is identical to the current state
// … React will skip re-rendering"), então quem garante a identidade é daqui.
//
// Lógica pura, sem React: o `node --test` roda este módulo direto.

import type { Delegacao } from '../../app/api/delegacoes/delegacoes.ts';

function mesma(a: Delegacao, b: Delegacao): boolean {
  return (
    a.quem === b.quem &&
    a.delegador === b.delegador &&
    a.alvo === b.alvo &&
    a.inicio === b.inicio &&
    a.pid === b.pid
  );
}

/** A lista a guardar: a ATUAL, se a nova diz a mesma coisa campo a campo;
 *  a nova, se algo mudou. */
export function estabilizaDelegacoes(atual: Delegacao[], nova: Delegacao[]): Delegacao[] {
  if (atual.length !== nova.length) return nova;
  for (let i = 0; i < nova.length; i++) if (!mesma(atual[i], nova[i])) return nova;
  return atual;
}
