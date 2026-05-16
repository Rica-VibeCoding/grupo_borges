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
