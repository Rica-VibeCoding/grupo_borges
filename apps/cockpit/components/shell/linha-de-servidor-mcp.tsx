'use client';

/**
 * Uma linha da tela de MCPs: emblema, nome, origem e o interruptor. Saiu de
 * `mcp-painel.tsx` (02/10) inteira, com os comentários — lá ficam estado, rede
 * e a lista; aqui, o pixel de um servidor.
 */
import type { CSSProperties } from 'react';
import type { McpServer } from '@grupo_borges/cockpit-core/api';
import { avisoEfeitoColateral, rotuloDaOrigem } from './mcp-servidores';

/** Badge neutro com a inicial — mesma régua do `Retrato`: §4 fecha a paleta, e
 *  cor por servidor (ou logo de marca) seria inventar fora dela. */
function Emblema({ nome }: { nome: string }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center"
      style={{
        width: '28px',
        height: '28px',
        borderRadius: 'var(--ck-radius-chip)',
        background: 'var(--ck-surface-composer)',
        fontFamily: 'var(--ck-font-mono)',
        fontSize: 'var(--ck-text-xs)',
        color: 'var(--ck-text-secondary)',
      }}
    >
      {nome.charAt(0).toLocaleUpperCase('pt-BR')}
    </span>
  );
}

export function LinhaDeServidor({
  server,
  emVoo,
  onToggle,
}: {
  server: McpServer;
  emVoo: boolean;
  onToggle: () => void;
}) {
  const aviso = avisoEfeitoColateral(server);
  return (
    <li className="flex flex-col" style={{ padding: 'var(--ck-space-2) 0' }}>
      <div className="flex items-center" style={{ gap: 'var(--ck-space-3)' }}>
        <Emblema nome={server.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate" style={{ fontSize: 'var(--ck-text-base)', color: 'var(--ck-text-primary)' }}>
            {server.name}
          </p>
          <p
            className="truncate"
            style={{ fontSize: 'var(--ck-text-xs)', color: 'var(--ck-text-secondary)' }}
            title={server.command_redacted ?? server.description ?? undefined}
          >
            {rotuloDaOrigem(server.kind)} · {server.id}
          </p>
        </div>
        <Interruptor
          ligado={server.enabled}
          ocupado={emVoo}
          rotulo={`${server.enabled ? 'Desativar' : 'Ativar'} ${server.name}`}
          onClick={onToggle}
        />
      </div>
      {aviso ? (
        <p
          style={{
            margin: 'var(--ck-space-1) 0 0 calc(28px + var(--ck-space-3))',
            fontSize: 'var(--ck-text-xs)',
            color: 'var(--ck-state-attention)',
          }}
        >
          {aviso}
        </p>
      ) : null}
    </li>
  );
}

/**
 * O interruptor. Ligado é ELEVAÇÃO (o mesmo `.ck-lit`, fio de luz no topo, da
 * pastilha selecionada do `Segmentado`), não matiz — regra 6 do `tropa.tsx`,
 * "cor só onde há julgamento". Ativar um MCP não é bom nem ruim, é estado; o
 * verde de `--ck-state-ok` fica reservado pra "concluído", que é outra coisa.
 * A posição do polegar já carrega o significado sozinha (é a leitura universal
 * do controle); a elevação reforça sem inventar um uso novo pra cor funcional.
 */
function Interruptor({
  ligado,
  ocupado,
  rotulo,
  onClick,
}: {
  ligado: boolean;
  ocupado: boolean;
  rotulo: string;
  onClick: () => void;
}) {
  const trilho: CSSProperties = ligado
    ? { background: 'var(--ck-surface-raised)', boxShadow: 'inset 0 1px 0 0 var(--ck-edge-light)' }
    : { background: 'var(--ck-surface-composer)', boxShadow: `inset 0 0 0 1px var(--ck-edge-functional)` };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-busy={ocupado}
      aria-label={rotulo}
      disabled={ocupado}
      onClick={onClick}
      className="ck-veil relative shrink-0"
      style={{
        width: '36px',
        height: '20px',
        borderRadius: 'var(--ck-radius-pill)',
        opacity: ocupado ? 0.6 : 1,
        transition: 'background var(--ck-dur-fast) var(--ck-ease), opacity var(--ck-dur-fast) var(--ck-ease)',
        ...trilho,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: '3px',
          left: ligado ? '19px' : '3px',
          width: '14px',
          height: '14px',
          borderRadius: 'var(--ck-radius-pill)',
          background: ligado ? 'var(--ck-text-primary)' : 'var(--ck-text-tertiary)',
          transition: 'left var(--ck-dur-fast) var(--ck-ease), background var(--ck-dur-fast) var(--ck-ease)',
        }}
      />
    </button>
  );
}
