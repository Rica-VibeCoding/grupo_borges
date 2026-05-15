'use client';

import type { Agent } from '../lib/cockpit-types';

/**
 * Aba CHAT do AgentModal — DS-2.
 *
 * Skeleton inicial; impl real (statusline modal + pane stream + input +
 * model selector + confirm dialog) entra no próximo commit. Mantido aqui
 * pra que o wire-up no `agent-modal.tsx` valide em isolado.
 */
export function ChatPanel({
  agent: _agent,
  serverNow: _serverNow,
}: {
  agent: Agent;
  serverNow: number;
}) {
  return (
    <p className="muted" style={{ padding: '12px 0' }}>
      chat em construção…
    </p>
  );
}
