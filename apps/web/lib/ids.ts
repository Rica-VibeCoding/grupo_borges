// `crypto.randomUUID` está disponível em browsers modernos mas falta em alguns
// runtimes mais velhos / contextos não-secure. Fallback gera ID único o
// suficiente pro uso atual (idempotency keys, clientIds optimistic).

export function safeUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
