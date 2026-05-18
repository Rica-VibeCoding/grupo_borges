// Tipos canônicos do contrato SSE /api/agents/{slug}/messages/stream — JP-11 Fase 2.
// Fonte: /tmp/jp11-fase2-contrato.md (cravado por Pavan após spike).

export type MessageKind = 'user' | 'assistant' | 'attachment' | 'summary' | 'system';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | ContentPart[];
      is_error?: boolean;
    };

// Named event `subagent_status` emitido pelo backend (jsonl_watcher + agents.py).
// `seq` é interno e removido por `_public_subagent_status` antes de virar SSE.
export type SubagentStatusKind = 'starting' | 'active' | 'completed' | 'stalled';

export type SubagentStatusEntry = {
  parent_uuid: string;
  status: SubagentStatusKind;
  started_at_ms: number;
  last_seen_ms?: number;
  duration_ms?: number;
  visibility?: boolean;
};

// JP-18 R2: bolha local enquanto o user-message não volta pelo SSE. Vive só
// no client; reconciliada quando MessagePayload role='user' com mesmo text
// chega via stream. `clientId` é UUID front-side; `ts` é Date.now() do submit.
export type OptimisticEntry = {
  clientId: string;
  text: string;
  ts: number;
  status: 'pending' | 'sent' | 'error';
};

export type MessagePayload = {
  id: number;
  kind: MessageKind;
  uuid: string;
  parent_uuid: string | null;
  session_id: string | null;
  is_sidechain: boolean;
  user_type: 'external' | 'internal';
  timestamp: string;
  created_at: number;
  // Pode vir null em kinds como `attachment` / `summary` / `system` que não
  // carregam payload de chat (mesmo schema canônico do contrato).
  message: {
    role: 'user' | 'assistant';
    id?: string;
    model?: string;
    stop_reason?: 'tool_use' | 'end_turn' | null;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
    content: string | ContentPart[];
  } | null;
};
