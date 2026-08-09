import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  avisoEfeitoColateral,
  combinaBusca,
  rotuloDaOrigem,
  servidoresMcp,
} from './mcp-servidores.ts';
import type { McpServer } from '@grupo_borges/cockpit-core/api';

function servidor(parcial: Partial<McpServer>): McpServer {
  return { kind: 'mcp_json', id: 'x', name: 'x', enabled: true, ...parcial };
}

describe('servidoresMcp — filtra e ordena', () => {
  it('exclui skill-only e subagente, mesmo quando a lista mistura tudo', () => {
    const lista = [
      servidor({ kind: 'plugin', id: 'skill-creator', name: 'skill-creator', provides: ['skill'] }),
      servidor({ kind: 'agent_user', id: 'code-review', name: 'code-review', provides: ['subagent'] }),
      servidor({ kind: 'mcp_json', id: 'supabase-ze', name: 'supabase-ze' }),
    ];
    const resultado = servidoresMcp(lista);
    assert.deepEqual(resultado.map((s) => s.id), ['supabase-ze']);
  });

  it('ordena por nome, não pela ordem que o back devolveu', () => {
    const lista = [
      servidor({ id: 'z', name: 'zapier' }),
      servidor({ id: 'a', name: 'airtable' }),
      servidor({ id: 'm', name: 'mongo' }),
    ];
    assert.deepEqual(
      servidoresMcp(lista).map((s) => s.name),
      ['airtable', 'mongo', 'zapier'],
    );
  });
});

describe('combinaBusca', () => {
  const supabase = servidor({ id: 'supabase-ze', name: 'supabase-ze' });

  it('termo vazio combina com tudo', () => {
    assert.equal(combinaBusca(supabase, ''), true);
    assert.equal(combinaBusca(supabase, '   '), true);
  });

  it('substring no nome ou no id, sem diferenciar maiúscula', () => {
    assert.equal(combinaBusca(supabase, 'SUPA'), true);
    assert.equal(combinaBusca(supabase, 'ze'), true);
    assert.equal(combinaBusca(supabase, 'telegram'), false);
  });

  it('acha pelo id quando o nome não bate', () => {
    const remoto = servidor({ id: 'claude.ai Gmail', name: 'claude.ai Gmail' });
    assert.equal(combinaBusca(remoto, 'gmail'), true);
  });
});

describe('rotuloDaOrigem — pt-BR, uma palavra por kind', () => {
  it('cobre os cinco kinds do backend', () => {
    assert.equal(rotuloDaOrigem('plugin'), 'plugin');
    assert.equal(rotuloDaOrigem('mcp_json'), 'workspace');
    assert.equal(rotuloDaOrigem('remote'), 'claude.ai');
    assert.equal(rotuloDaOrigem('user_scope'), 'usuário');
    assert.equal(rotuloDaOrigem('agent_user'), 'subagente');
  });
});

describe('avisoEfeitoColateral', () => {
  it('sem aviso quando não é plugin', () => {
    assert.equal(avisoEfeitoColateral(servidor({ kind: 'mcp_json', provides: ['mcp'] })), null);
  });

  it('sem aviso quando o plugin só expõe mcp', () => {
    assert.equal(avisoEfeitoColateral(servidor({ kind: 'plugin', provides: ['mcp'] })), null);
  });

  it('avisa quando o plugin expõe mcp E outra coisa — o caso real do vercel-plugin', () => {
    const aviso = avisoEfeitoColateral(
      servidor({ kind: 'plugin', provides: ['skill', 'mcp', 'subagent', 'hook'] }),
    );
    assert.ok(aviso);
    assert.ok(aviso.includes('skill'));
    assert.ok(aviso.includes('subagent'));
    assert.ok(aviso.includes('hook'));
  });

  it('sem aviso quando provides é null', () => {
    assert.equal(avisoEfeitoColateral(servidor({ kind: 'plugin', provides: null })), null);
  });
});
