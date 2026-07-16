'use client';

import { useCallback, useState } from 'react';
import { AgentInputError, postAgentInput, postAgentImage, postAgentVoice } from './api';
import { useToast } from './toast-context';

export type UseAgentSendResult = {
  sending: boolean;
  sendText: (text: string, options?: { fresh?: boolean }) => Promise<void>;
  sendImage: (file: File, caption?: string) => Promise<void>;
  sendVoice: (blob: Blob) => Promise<void>;
};

export function useAgentSend(slug: string, agentName: string): UseAgentSendResult {
  const { fire } = useToast();
  const [sending, setSending] = useState(false);

  // ---- shared helpers -------------------------------------------------------

  function fireSuccess() {
    fire({ kind: 'success', msg: `enviado pro ${agentName}` });
  }

  function firePaneWarn() {
    fire({ kind: 'warn', msg: 'envio não confirmado', sub: 'pane fora do CLI esperado' });
  }

  function fireSendError(err: unknown) {
    const detail = err instanceof AgentInputError ? err.detail : null;
    if (
      err instanceof AgentInputError &&
      err.status === 409 &&
      detail === 'agent_pane_unavailable'
    ) {
      fire({
        kind: 'warn',
        msg: 'agente fora do CLI esperado',
        sub: 'verifique se ele tá no Claude/Codex e não em shell auxiliar',
        ttlMs: 6000,
      });
    } else {
      fire({ kind: 'warn', msg: 'falha ao enviar', sub: detail ?? String(err) });
    }
  }

  // ---- sendText -------------------------------------------------------------

  const sendText = useCallback(
    async (text: string, options?: { fresh?: boolean }) => {
      if (!text.trim() || sending) return;
      setSending(true);
      try {
        const res = await postAgentInput(slug, text.trim(), options);
        if (res.tmux_delivered) {
          fireSuccess();
        } else {
          firePaneWarn();
        }
      } catch (err) {
        fireSendError(err);
        // Propaga pra quem chama poder marcar optimistic como 'error' (JP-18 R2).
        throw err;
      } finally {
        setSending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentName, slug, sending],
  );

  // ---- sendImage ------------------------------------------------------------
  // not_implemented: endpoint POST /api/agents/{slug}/image not yet available.
  // postAgentImage stub lives in api.ts and throws NotImplementedError.

  const sendImage = useCallback(
    async (file: File, caption?: string) => {
      if (sending) return;
      setSending(true);
      try {
        const res = await postAgentImage(slug, file, caption);
        if (res.tmux_delivered) {
          fireSuccess();
        } else {
          firePaneWarn();
        }
      } catch (err) {
        fireSendError(err);
      } finally {
        setSending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentName, slug, sending],
  );

  // ---- sendVoice ------------------------------------------------------------

  const sendVoice = useCallback(
    async (blob: Blob) => {
      if (sending) return;
      setSending(true);
      try {
        const res = await postAgentVoice(slug, blob);
        if (res.tmux_delivered) {
          fireSuccess();
        } else {
          firePaneWarn();
        }
      } catch (err) {
        fireSendError(err);
      } finally {
        setSending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentName, slug, sending],
  );

  return { sending, sendText, sendImage, sendVoice };
}
