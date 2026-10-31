'use client';

/**
 * Uma linha da tela de MCPs, numa linha só (Rica, 31/10: "tudo na primeira
 * linha"): nome, origem em `secondary` truncando (o id técnico fica no `title`) e o `Interruptor` da gaveta
 * (`gaveta/pecas.tsx`) à direita. Mesma anatomia da `LinhaDeConversa`: sem
 * emblema, sem aviso por linha, alvo de 44px.
 */
import type { McpServer } from '@grupo_borges/cockpit-core/api';
import { Interruptor } from '../gaveta/pecas';
import { rotuloDaOrigem } from './mcp-servidores';

export function LinhaDeServidor({
  server,
  emVoo,
  onToggle,
}: {
  server: McpServer;
  emVoo: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className="flex items-center"
      style={{ gap: 'var(--ck-space-3)', minHeight: 'var(--ck-touch-min)', padding: '0 var(--ck-space-2) 0 var(--ck-space-4)' }}
    >
      <div className="flex min-w-0 flex-1 items-baseline" style={{ gap: 'var(--ck-space-2)' }}>
        <span className="min-w-0 truncate" style={{ fontSize: 'var(--ck-text-base)', fontWeight: 500, color: 'var(--ck-text-primary)' }}>
          {server.name}
        </span>
        <span
          className="min-w-0 flex-1 truncate"
          style={{ flexBasis: 0, fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
          title={server.command_redacted ?? server.description ?? server.id}
        >
          {rotuloDaOrigem(server.kind)}
        </span>
      </div>
      <Interruptor
        ligado={server.enabled}
        rotulo={server.enabled ? 'Ativo' : 'Desligado'}
        descricao={`${server.enabled ? 'Desativar' : 'Ativar'} ${server.name}`}
        ocupado={emVoo}
        desabilitado={emVoo}
        aoAlternar={onToggle}
      />
    </li>
  );
}
