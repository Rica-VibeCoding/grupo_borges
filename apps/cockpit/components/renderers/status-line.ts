// Lógica do `status-line.tsx` — normaliza as 4 famílias G4 (linha de status)
// para um modelo único. Mora fora do `.tsx` de propósito: a suíte roda
// `node --test` sem transpilação de JSX, então o que precisa de prova não
// pode morar dentro de componente.
//
// Núcleo comum: `success` (boolean) + texto curto (`message` ou
// `commandName` — mutuamente exclusivos nas 4 fixtures reais). `pin` e
// `resumedAgentId` são aditivos de destino, nem sempre presentes. O
// componente recebe o `tool_use_result` cru por props.
//
// NOME NÃO COLIDE com `components/shell/statusline.tsx` (sem hífen) — aquela
// é a barra de contexto do agente (telemetria de sessão), esta é o corpo de
// um resultado de tool. Coisas diferentes, aviso do Pavan no dispatch.

export type PinDeDestino = {
  id: string;
  name: string;
  ref: string;
};

export type LinhaDeStatusNormalizada = {
  sucesso: boolean;
  texto: string;
  pin?: PinDeDestino;
  resumedAgentId?: string;
};

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function ehStringPreenchida(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0;
}

function normalizarPin(valor: unknown): PinDeDestino | null {
  if (!ehObjeto(valor)) return null;
  if (
    !ehStringPreenchida(valor.id) ||
    !ehStringPreenchida(valor.name) ||
    !ehStringPreenchida(valor.ref)
  ) {
    return null;
  }
  return { id: valor.id, name: valor.name, ref: valor.ref };
}

/** Aceita o `tool_use_result` cru das 4 famílias G4. Devolve null quando não
 *  é linha de status, para o chamador cair no corpo genérico. */
export function normalizarLinhaDeStatus(valor: unknown): LinhaDeStatusNormalizada | null {
  if (!ehObjeto(valor)) return null;
  if (typeof valor.success !== 'boolean') return null;

  const texto = ehStringPreenchida(valor.message)
    ? valor.message
    : ehStringPreenchida(valor.commandName)
      ? valor.commandName
      : null;
  if (texto === null) return null;

  const pin = normalizarPin(valor.pin);
  const resumedAgentId = ehStringPreenchida(valor.resumedAgentId)
    ? valor.resumedAgentId
    : undefined;

  return {
    sucesso: valor.success,
    texto,
    ...(pin ? { pin } : {}),
    ...(resumedAgentId ? { resumedAgentId } : {}),
  };
}
